import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bestOrder, flowScore } from './audioAnalysis.js';
import { startAutoDj, stopAutoDj, mixNow, mixToSong, resumeSet, useAutoDj } from './autoDj.js';
import { stopMix } from './mixPlayer.js';
import { stopPreview } from './player.js';
import { mixOnSpotify, playListOnSpotify } from './spotifyPlayer.js';
import { canQueue, queueSong, isLoggedIn, logout, login } from './spotify.js';
import { getSet, saveSet, onSetChange, getPlayed, onPlayedChange, clearPlayed, getPrefs, setPref, onPrefsChange } from './setStore.js';
import { bestNextFor, useSpotifyQueue, UP_NEXT } from './setSync.js';
import { idOf, firstArtist, getJson, useAnalyses, Chips, Link, SongSearch } from './mixParts.jsx';
import ArtistLink from './ArtistLink.jsx';

// "Your set": your own list of songs, how well they flow, best order and Auto-DJ.
// Lives inside Mix Lab, or pops out as a floating window.
export default function SetPanel({ start, onLibrary, onFloat, floating = false }) {
  const [set, setSetState] = useState(getSet);
  const setSet = useCallback((fn) => saveSet(typeof fn === 'function' ? fn(getSet()) : fn), []);
  const [suggest, setSuggest] = useState(null); // { order, score, was } from "Best order"
  const [djOpts, setDjOpts] = useState({ fade: 7000, skipIntro: false });
  const dj = useAutoDj();
  const [queued, setQueued] = useState({});
  const [queueAll, setQueueAll] = useState(null);
  const [live, setLive] = useState({});
  const previewTried = useRef(new Set());
  const { analyse, withAudio } = useAnalyses();

  const [played, setPlayed] = useState(getPlayed);
  const [prefs, setPrefsState] = useState(getPrefs);
  const [showPlayed, setShowPlayed] = useState(false);
  const [ideas, setIdeas] = useState(null); // suggested songs to reach 3 up next
  useEffect(() => onSetChange(setSetState), []);
  useEffect(() => onPlayedChange(setPlayed), []);
  useEffect(() => onPrefsChange(setPrefsState), []);

  // songs added from Spotify have no preview yet: look one up so we can measure them
  useEffect(() => {
    set.forEach((s) => {
      const id = idOf(s);
      if (s.preview || previewTried.current.has(id)) return;
      previewTried.current.add(id);
      const qs = new URLSearchParams({ title: s.title, artist: firstArtist(s.artist) });
      getJson(`/api/preview?${qs}`)
        .then((p) => p.preview && setSet((cur) => cur.map((x) => (idOf(x) === id ? { ...x, preview: p.preview, cover: x.cover || p.coverHq } : x))))
        .catch(() => {});
    });
  }, [set]);

  const chain = useMemo(() => (start ? [start, ...set] : set), [start, set]);
  const inChain = new Set(chain.map(idOf));
  useEffect(() => {
    chain.forEach((s, i) => analyse(s.preview, 30 + i));
  }, [chain, analyse]);

  // fewer than 3 songs coming up? suggest the best matches after the last one
  const anchor = chain[chain.length - 1] || null;
  const need = Math.max(0, UP_NEXT - set.length);
  useEffect(() => {
    if (!need || !anchor || prefs.autoFill) return setIdeas(null);
    let alive = true;
    setIdeas({ loading: true });
    bestNextFor(anchor, need).then((list) => alive && setIdeas({ list }));
    return () => {
      alive = false;
    };
  }, [anchor && idOf(anchor), need, prefs.autoFill, played.length]);

  const addToSet = (s) =>
    setSet((cur) =>
      cur.some((x) => idOf(x) === idOf(s))
        ? cur
        : [...cur, { title: s.title, artist: s.artist, cover: s.cover, preview: s.preview || null, appleUrl: s.appleUrl || null, uri: s.uri || null }]
    );

  // which Auto-DJ step a set song is (matched by title)
  const isDjCurrent = (s) => dj.on && dj.current && idOf(dj.current) === idOf(s);

  // click a song: play it now (with a fade); during Auto-DJ, jump the mix to it
  async function playNow(s, setIdx) {
    if (dj.on) return mixToSong(s); // Auto-DJ running: jump the mix to this song
    return mixLive(s);
  }

  const move = (i, d) =>
    setSet((cur) => {
      const n = [...cur];
      const j = i + d;
      if (j < 0 || j >= n.length) return cur;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const remove = (i) => setSet((cur) => cur.filter((_, k) => k !== i));

  async function queue(s) {
    const id = idOf(s);
    setQueued((q) => ({ ...q, [id]: 'busy' }));
    try {
      await queueSong(s.title, firstArtist(s.artist));
      setQueued((q) => ({ ...q, [id]: 'ok' }));
      return true;
    } catch (e) {
      setQueued((q) => ({ ...q, [id]: e.message }));
      return false;
    }
  }
  async function queueWholeSet() {
    let done = 0;
    for (const s of set) {
      setQueueAll(`Adding ${done + 1} of ${set.length}…`);
      if (queued[idOf(s)] !== 'ok') {
        const ok = await queue(s);
        if (!ok) {
          setQueueAll(`Stopped at "${s.title}". See the error below it.`);
          return;
        }
      }
      done += 1;
    }
    setQueueAll(`✓ ${done} songs added to your Spotify queue, in order.`);
  }

  // the real thing: fade your Spotify into this song
  async function mixLive(s) {
    const id = idOf(s);
    stopMix();
    stopPreview();
    try {
      const name = await mixOnSpotify(s.title, s.artist, (step) => setLive((l) => ({ ...l, [id]: step })), s.uri);
      setLive((l) => ({ ...l, [id]: `✓ Now playing ${name} on your Spotify` }));
    } catch (e) {
      setLive((l) => ({ ...l, [id]: `⚠ ${e.message}` }));
    }
  }
  async function playSetNow() {
    stopMix();
    stopPreview();
    try {
      const n = await playListOnSpotify(set, (step) => setQueueAll(step));
      setQueueAll(`✓ Playing your set on Spotify (${n} songs).`);
    } catch (e) {
      setQueueAll(`⚠ ${e.message}`);
    }
  }

  // ---- set tools: flow score, best order, Auto-DJ
  const setA = set.map(withAudio);
  const startA = start ? withAudio(start) : null;
  const flow = flowScore(startA, setA);
  const unmeasured = setA.filter((s) => !s.analysed).length;
  function findBestOrder() {
    const r = bestOrder(startA, setA);
    const same = r.order.every((x, i) => idOf(x) === idOf(setA[i]));
    setSuggest(same ? { same: true } : { order: r.order, score: r.score, was: flow });
  }
  function applyOrder() {
    const ids = suggest.order.map(idOf);
    setSet((cur) => ids.map((id) => cur.find((x) => idOf(x) === id)).filter(Boolean));
    setSuggest(null);
  }
  function startDj() {
    stopMix();
    stopPreview();
    startAutoDj({ fadeOutMs: djOpts.fade, fadeInMs: Math.round(djOpts.fade * 0.6), skipIntroMs: djOpts.skipIntro ? 15000 : 0 });
  }


  const loggedIn = isLoggedIn();
  const queueReady = loggedIn && canQueue();
  const spq = useSpotifyQueue(queueReady);

  return (
          <section className={`ml-set ${floating ? 'floating' : ''}`}>
            {!floating && (
            <h3 className="ml-h">
              Your set <span className="ml-count">{set.length}</span>
              {onFloat && (
                <button className="link-btn ml-lib" onClick={onFloat} title="Pop out as a floating window">
                  ⧉ Float
                </button>
              )}
              {onLibrary && isLoggedIn() && (
                <button className="link-btn ml-lib" onClick={onLibrary}>
                  ♥ From my library
                </button>
              )}
              {set.length > 0 && (
                <button className="link-btn ml-clear" onClick={() => setSet([])}>
                  Clear
                </button>
              )}
            </h3>
            )}
            {floating && (
              <div className="ml-float-tools">
                {onLibrary && isLoggedIn() && (
                  <button className="link-btn" onClick={onLibrary}>
                    ♥ From my library
                  </button>
                )}
                {set.length > 0 && (
                  <button className="link-btn ml-clear" onClick={() => setSet([])}>
                    Clear
                  </button>
                )}
              </div>
            )}
            {isLoggedIn() && onLibrary && (
              <div className="ml-addfrom">
                <span className="muted">Add from your Spotify:</span>
                <button className="gx-fxbtn" onClick={() => onLibrary('liked')}>♥ Liked</button>
                <button className="gx-fxbtn" onClick={() => onLibrary('playlists')}>☰ Playlists</button>
                <button className="gx-fxbtn" onClick={() => onLibrary('recent')}>↺ Recent</button>
                <button className="gx-fxbtn" onClick={() => onLibrary('top')}>★ Top</button>
              </div>
            )}
            {played.length > 0 && (
              <div className="ml-played">
                <button className="link-btn" onClick={() => setShowPlayed(!showPlayed)}>
                  {showPlayed ? '▾' : '▸'} Played ({played.length})
                </button>
                {showPlayed && (
                  <>
                    <ol>
                      {played.map((p) => (
                        <li key={`${idOf(p)}|${p.playedAt || ''}`}>
                          {p.cover ? <img src={p.cover} alt="" /> : <div className="ph" />}
                          <span className="un-title">{p.title}</span>
                          <span className="tr-artist">
                            <ArtistLink name={p.artist} />
                          </span>
                          <button className="gx-fxbtn" title="Add back to the set" onClick={() => addToSet(p)}>
                            ↺
                          </button>
                        </li>
                      ))}
                    </ol>
                    <button className="link-btn ml-clear" onClick={clearPlayed}>
                      Clear history
                    </button>
                  </>
                )}
              </div>
            )}
            {!set.length && <div className="muted">Add picks or any song you like. Each new song gets its own best-next ideas.</div>}

            {chain.length > 0 && set.length > 0 && (
              <ol className="ml-chain">
                {chain.map((s, i) => {
                  const cur = withAudio(s);
                  const prev = i ? withAudio(chain[i - 1]) : null;
                  const setIdx = start ? i - 1 : i;
                  return (
                    <React.Fragment key={idOf(s) + i}>
                      {prev && <Link from={prev} to={cur} />}
                      <li
                        className={`${s.now ? 'now' : ''} ${!s.now ? 'clickable' : ''} ${isDjCurrent(s) ? 'playing' : ''}`}
                        onClick={() => !s.now && playNow(s, setIdx)}
                        title={s.now ? 'Playing now' : dj.on ? 'Mix into this song now' : 'Play this now on your Spotify (with a fade)'}
                      >
                        <div className="ml-cover">
                          {s.cover ? <img src={s.cover} alt="" /> : <div className="ph" />}
                          {!s.now && <span className="tr-play">▶</span>}
                        </div>
                        <div className="un-body">
                          <div className="un-title">
                            {s.now && <span className="ml-now">NOW</span>}
                            {!s.now && setIdx < UP_NEXT && <span className="ml-upnext">NEXT {setIdx + 1}</span>}
                            {s.queued && <span className="ml-auto queued" title="You queued this in Spotify (phone, Mac…) while Auto-DJ ran">📱 you queued</span>}
                            {s.auto && !s.queued && (
                              <span className="ml-auto" title={s.habit || 'Added automatically: best match after the previous song'}>
                                {s.habit ? '🔁 habit' : 'auto'}
                              </span>
                            )}
                            {s.title}
                          </div>
                          <div className="tr-artist">
                            <ArtistLink name={s.artist} />
                          </div>
                          <Chips a={cur} small noPreview={!s.preview} />
                          {live[idOf(s)] && <div className={`ml-livestep ${live[idOf(s)].startsWith('⚠') ? 'err' : ''}`}>{live[idOf(s)]}</div>}
                          {queued[idOf(s)] && !['ok', 'busy'].includes(queued[idOf(s)]) && (
                            <div className="status err">{queued[idOf(s)]}</div>
                          )}
                        </div>
                        {!s.now && (
                          <div className="ml-ctrl" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => move(setIdx, -1)} disabled={setIdx === 0} aria-label="Move up">
                              ↑
                            </button>
                            <button onClick={() => move(setIdx, 1)} disabled={setIdx === set.length - 1} aria-label="Move down">
                              ↓
                            </button>
                            <button onClick={() => remove(setIdx)} aria-label="Remove">
                              ×
                            </button>
                          </div>
                        )}
                      </li>
                    </React.Fragment>
                  );
                })}
              </ol>
            )}

            {need > 0 && anchor && !prefs.autoFill && (
              <div className="ml-ideas">
                <div className="ml-label">
                  {set.length ? `Only ${set.length} coming up.` : 'Nothing coming up.'} Best matches to keep {UP_NEXT} up next:
                </div>
                {ideas?.loading && <div className="un-skel ml-idea-skel" />}
                {ideas?.list?.length === 0 && <div className="muted">No suggestions yet. Add songs from your library or search below.</div>}
                {ideas?.list?.map((x) => (
                  <div key={idOf(x)} className="ml-idea">
                    {x.cover ? <img src={x.cover} alt="" /> : <div className="ph" />}
                    <div className="un-body">
                      <div className="un-title">{x.title}</div>
                      <div className="tr-artist">
                        <ArtistLink name={x.artist} /> · {x.habit ? `🔁 ${x.habit}` : `${x.match}% match`}
                      </div>
                    </div>
                    <button className="btn-ghost sm" onClick={() => addToSet(x)}>
                      + Add
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="ml-prefs">
              <label className="np-follow">
                <input type="checkbox" checked={prefs.dropPlayed} onChange={(e) => setPref('dropPlayed', e.target.checked)} />
                Remove songs once they play
              </label>
              <label className="np-follow">
                <input type="checkbox" checked={prefs.autoFill} onChange={(e) => setPref('autoFill', e.target.checked)} />
                Auto-fill to {UP_NEXT} up next with the best matches
              </label>
              <label className="np-follow" title="When the set runs out, Auto-DJ adds the best next song itself (your habits first)">
                <input type="checkbox" checked={prefs.radio !== false} onChange={(e) => setPref('radio', e.target.checked)} />
                Radio: keep going after the set (your habits first, no repeats within an hour)
              </label>
              {queueReady && (
                <label className="np-follow">
                  <input type="checkbox" checked={prefs.syncQueue} onChange={(e) => setPref('syncQueue', e.target.checked)} />
                  Keep Spotify's queue in sync (adds the next set song to your Spotify queue)
                </label>
              )}
            </div>
            {queueReady && spq?.queue?.length > 0 && (
              <div className="ml-spq">
                <span className="ml-label">On Spotify next</span>
                {spq.queue.slice(0, 3).map((t, i) => (
                  <span key={t.uri + i} className={set.some((x) => idOf(x) === idOf(t)) ? 'mine' : ''} title={t.artist}>
                    {i + 1}. {t.title}
                  </span>
                ))}
              </div>
            )}

            {set.length > 1 && (
              <div className="ml-tools">
                <div className="ml-flow">
                  <span className="ml-label">Set flow</span>
                  <b className={flow >= 70 ? 'good' : flow >= 55 ? 'ok' : 'bad'}>{flow ?? '··'}</b>
                  {unmeasured > 0 && <span className="muted">measuring {unmeasured}…</span>}
                </div>
                <button className="btn-ghost sm ml-live" disabled={unmeasured > 0} onClick={findBestOrder} title="Try every order and pick the smoothest">
                  ✨ Best order
                </button>
              </div>
            )}
            {suggest?.same && <div className="ml-livestep">✓ Your order is already the smoothest.</div>}
            {suggest?.order && (
              <div className="ml-suggest">
                <div>
                  <b>Smoother order:</b> flow {suggest.was} → <span className="good">{suggest.score}</span>
                </div>
                <ol>
                  {suggest.order.map((x) => (
                    <li key={idOf(x)}>{x.title}</li>
                  ))}
                </ol>
                <div className="un-actions">
                  <button className="btn-green sm" onClick={applyOrder}>
                    Use this order
                  </button>
                  <button className="btn-ghost sm" onClick={() => setSuggest(null)}>
                    Keep mine
                  </button>
                </div>
              </div>
            )}

            {set.length > 0 && (
              <div className="ml-dj">
                {queueReady ? (
                  dj.on ? (
                    <div className="ml-dj-live">
                      <div className="ml-dj-head">
                        <span className={`ml-dj-dot ${dj.paused ? 'paused' : ''}`} /> {dj.paused ? 'AUTO-DJ PAUSED' : 'AUTO-DJ ON'}
                        {dj.secondsLeft != null && !dj.mixing && <span className="ml-dj-left">{Math.floor(dj.secondsLeft / 60)}:{String(dj.secondsLeft % 60).padStart(2, '0')} left</span>}
                      </div>
                      <div className="ml-dj-status">{dj.status}</div>
                      <div className="ml-dj-steps">
                        {dj.current && <span className="on">▶ {dj.current.title}</span>}
                        {dj.next ? <span>next: {dj.next.title}</span> : <span className="done">no next song: add one</span>}
                        {dj.queuedByYou > 0 && <span title="Songs you queued from your phone or another device while Auto-DJ ran">📱 {dj.queuedByYou} queued by you</span>}
                        {dj.skipped > 0 && <span title="Old songs in your Spotify queue that Auto-DJ skipped to stay on your set">skipped {dj.skipped} old from queue</span>}
                      </div>
                      <div className="un-actions">
                        {dj.paused ? (
                          <button className="btn-green sm" disabled={dj.mixing || !set.length} onClick={resumeSet}>
                            ▶ Resume set
                          </button>
                        ) : (
                          <button className="btn-green sm" disabled={dj.mixing || !dj.next} onClick={mixNow}>
                            ⇄ Mix to next now
                          </button>
                        )}
                        <button className="btn-ghost sm" onClick={() => stopAutoDj('Auto-DJ stopped.')}>
                          ■ Stop
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="ml-setbar">
                        <button className="btn-green" onClick={startDj}>
                          🎧 Auto-DJ my set
                        </button>
                        <button className="btn-ghost" onClick={playSetNow}>
                          ▶ Just play
                        </button>
                        <button className="btn-ghost" onClick={queueWholeSet}>
                          Queue all
                        </button>
                      </div>
                      <div className="ml-dj-opts">
                        <span className="muted">Transition:</span>
                        {[
                          [4000, 'Quick 4s'],
                          [7000, 'Smooth 7s'],
                          [11000, 'Long 11s'],
                        ].map(([ms, l]) => (
                          <button key={ms} className={`gx-fxbtn ${djOpts.fade === ms ? 'on' : ''}`} onClick={() => setDjOpts((o) => ({ ...o, fade: ms }))}>
                            {l}
                          </button>
                        ))}
                        <label className="np-follow">
                          <input type="checkbox" checked={djOpts.skipIntro} onChange={(e) => setDjOpts((o) => ({ ...o, skipIntro: e.target.checked }))} />
                          Skip intros (start 15s in)
                        </label>
                      </div>
                      <div className="muted ml-dj-note">
                        Auto-DJ lets the current song play, then near the end fades it out and fades the next one in. Smoothest with "⇣ Play here".
                      </div>
                    </>
                  )
                ) : loggedIn ? (
                  <button
                    className="btn-green"
                    onClick={async () => {
                      logout();
                      await login();
                    }}
                  >
                    Reconnect Spotify to play your set
                  </button>
                ) : (
                  <span className="muted">Connect Spotify to play this set.</span>
                )}
                {(dj.error || (!dj.on && dj.status)) && <div className={`ml-livestep ${dj.error ? 'err' : ''}`}>{dj.error || dj.status}</div>}
                {queueAll && !dj.on && <span className="ml-qstatus">{queueAll}</span>}
              </div>
            )}

            <SongSearch onAdd={addToSet} inSet={inChain} />
          </section>
  );
}
