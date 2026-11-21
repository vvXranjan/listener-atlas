import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzePreview, transitionScore, transitionTip, tempoGap, keyScore } from './audioAnalysis.js';
import { playMix, stopMix, useMix } from './mixPlayer.js';
import { togglePreview, usePlaying } from './player.js';
import { canQueue, queueSong, isLoggedIn, logout, login } from './spotify.js';

const SET_KEY = 'mixlab-set-v1';
const idOf = (s) => `${s.title}|${s.artist}`.toLowerCase();
const firstArtist = (a) => a.split(/,|&| with | feat\.? /i)[0].trim();
const spotifySearch = (s) =>
  `https://open.spotify.com/search/${encodeURIComponent(`${s.title.replace(/\s*[([].*?[)\]]/g, '')} ${firstArtist(s.artist)}`)}`;

function loadSet() {
  try {
    return JSON.parse(localStorage.getItem(SET_KEY) || '[]');
  } catch {
    return [];
  }
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.headers.get('content-type')?.includes('json')) throw new Error('Data server not running the new code. Restart npm run dev.');
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// Mix Lab: the best next songs for a smooth transition, plus your own set.
export default function MixLab({ track, onArtist, onClose }) {
  const [start, setStart] = useState(null); // the song playing now, with a preview
  const [set, setSet] = useState(loadSet);
  const [recs, setRecs] = useState({}); // anchor id -> recommend result
  const [an, setAn] = useState({}); // preview url -> analysis | 'busy' | 'fail'
  const anRef = useRef({});
  const [more, setMore] = useState(false);
  const [queued, setQueued] = useState({}); // id -> 'busy' | 'ok' | error
  const [queueAll, setQueueAll] = useState(null);
  const mix = useMix();
  const playing = usePlaying();

  // keep the set between visits
  useEffect(() => {
    try {
      localStorage.setItem(SET_KEY, JSON.stringify(set));
    } catch {
      /* storage blocked */
    }
  }, [set]);

  useEffect(() => () => stopMix(), []);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // the now-playing song needs a preview for the audio analysis
  useEffect(() => {
    if (!track) return setStart(null);
    const base = {
      title: track.name,
      artist: track.artists.map((a) => a.name).join(', '),
      cover: track.cover,
      now: true,
    };
    setStart(base);
    const qs = new URLSearchParams({ title: base.title, artist: track.artists[0].name });
    getJson(`/api/preview?${qs}`)
      .then((p) => setStart({ ...base, preview: p.preview, cover: base.cover || p.coverHq }))
      .catch(() => {});
  }, [track?.id, track?.name]);

  const analyse = useCallback((url) => {
    if (!url || anRef.current[url]) return;
    anRef.current[url] = 'busy';
    setAn((m) => ({ ...m, [url]: 'busy' }));
    analyzePreview(url)
      .then((r) => r || 'fail')
      .catch(() => 'fail')
      .then((r) => {
        anRef.current[url] = r;
        setAn((m) => ({ ...m, [url]: r }));
      });
  }, []);
  const withAudio = useCallback(
    (s) => {
      const a = s?.preview ? an[s.preview] : null;
      return a && typeof a === 'object' ? { ...s, ...a, analysed: true } : { ...s, analysing: a === 'busy', failed: a === 'fail' };
    },
    [an]
  );

  // the mix so far: now playing, then your set. Suggestions follow the last song.
  const chain = useMemo(() => (start ? [start, ...set] : set), [start, set]);
  const anchor = chain[chain.length - 1] || null;
  const anchorId = anchor ? idOf(anchor) : null;
  const rec = anchorId ? recs[anchorId] : null;

  useEffect(() => {
    if (!anchor || recs[anchorId]) return;
    setRecs((r) => ({ ...r, [anchorId]: { loading: true } }));
    const qs = new URLSearchParams({ title: anchor.title, artists: anchor.artist.split(/,|&/).map((x) => x.trim()).filter(Boolean).join('|') });
    getJson(`/api/recommend?${qs}`)
      .then((j) => setRecs((r) => ({ ...r, [anchorId]: j })))
      .catch((e) => setRecs((r) => ({ ...r, [anchorId]: { error: e.message } })));
  }, [anchorId]);

  // analyse the anchor and the candidates (one at a time, cached)
  useEffect(() => {
    analyse(anchor?.preview);
    (rec?.pool || []).forEach((p) => analyse(p.preview));
  }, [anchor?.preview, rec?.pool, analyse]);
  useEffect(() => {
    chain.forEach((s) => analyse(s.preview));
  }, [chain, analyse]);

  const from = withAudio(anchor);
  const inChain = new Set(chain.map(idOf));
  const ranked = (rec?.pool || [])
    .filter((p) => !inChain.has(idOf(p)))
    .map((p) => {
      const to = withAudio(p);
      return { ...to, score: transitionScore(from, to), tip: to.analysed && from.analysed ? transitionTip(from, to) : null };
    })
    .sort((a, b) => b.score - a.score || b.match - a.match);
  const pending = (rec?.pool || []).filter((p) => p.preview && (!an[p.preview] || an[p.preview] === 'busy')).length;
  const shown = more ? ranked : ranked.slice(0, 4);

  const addToSet = (s) =>
    setSet((cur) =>
      cur.some((x) => idOf(x) === idOf(s))
        ? cur
        : [...cur, { title: s.title, artist: s.artist, cover: s.cover, preview: s.preview, appleUrl: s.appleUrl || null }]
    );
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

  const loggedIn = isLoggedIn();
  const queueReady = loggedIn && canQueue();

  const QueueBtn = ({ s }) => {
    const q = queued[idOf(s)];
    if (!queueReady) {
      return (
        <a className="btn-ghost sm" href={spotifySearch(s)} target="_blank" rel="noreferrer">
          Find on Spotify
        </a>
      );
    }
    return (
      <button className="btn-ghost sm" disabled={q === 'busy' || q === 'ok'} onClick={() => queue(s)}>
        {q === 'ok' ? '✓ Queued' : q === 'busy' ? 'Adding…' : '+ Queue'}
      </button>
    );
  };

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer mixlab" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Close">
          ×
        </button>

        <header className="ml-head">
          <div className="ml-kicker">
            <span className="spark">✦</span> MIX LAB
          </div>
          <h2>What should play next?</h2>
          <div className="muted">
            Songs real listeners play together, ranked by how smoothly they blend: tempo, key and energy.
          </div>
        </header>

        <div className="d-body">
          {!anchor && (
            <div className="ml-empty">
              Play something on Spotify, or search a song below to start your mix.
            </div>
          )}

          {anchor && (
            <section className="ml-deck">
              <div className="ml-label">{set.length ? 'Best next after the last song in your set' : 'Now playing'}</div>
              <div className="ml-deck-row">
                <button className="un-cover" disabled={!from.preview} onClick={() => togglePreview(from.preview)}>
                  {from.cover ? <img src={from.cover} alt="" /> : <div className="ph" />}
                  {from.preview && <span className="tr-play">{playing === from.preview ? '❚❚' : '▶'}</span>}
                </button>
                <div className="un-body">
                  <div className="un-title">{from.title}</div>
                  <div className="tr-artist">{from.artist}</div>
                  <Chips a={from} noPreview={!from.preview} />
                </div>
              </div>
            </section>
          )}

          {anchor && (
            <section>
              <h3 className="ml-h">
                Best next songs
                {pending > 0 && rec?.pool && <span className="ml-busy">Listening to {pending} previews…</span>}
              </h3>
              {rec?.loading && (
                <div className="un-loading">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="un-skel" />
                  ))}
                </div>
              )}
              {rec?.error && <div className="status err">{rec.error}</div>}
              {rec?.note && !ranked.length && <div className="muted">{rec.note} Add your own songs below.</div>}

              <ol className="un-list ml-list">
                {shown.map((p, i) => {
                  const id = idOf(p);
                  const mixing = mix?.id === id;
                  return (
                    <li key={id} className={mixing || playing === p.preview ? 'on' : ''}>
                      <span className="un-rank">{i + 1}</span>
                      <button className="un-cover" disabled={!p.preview} onClick={() => togglePreview(p.preview)} title="Play 30s preview">
                        {p.cover ? <img src={p.cover} alt="" /> : <div className="ph" />}
                        {p.preview && <span className="tr-play">{playing === p.preview ? '❚❚' : '▶'}</span>}
                      </button>
                      <div className="un-body">
                        <div className="ml-top">
                          <div className="ml-titles">
                            <div className="un-title">{p.title}</div>
                            <button className="tr-artist" onClick={() => onArtist({ name: firstArtist(p.artist) })}>
                              {p.artist}
                            </button>
                          </div>
                          <Score value={p.score} live={p.analysed && from.analysed} />
                        </div>
                        <Chips a={p} rel={from} noPreview={!p.preview} />
                        <div className="un-why">{p.tip ? <b className="ml-tip">{p.tip} </b> : null}{p.why}</div>
                        {mixing && <MixBar mix={mix} />}
                        <div className="un-actions">
                          <button
                            className="btn-green sm"
                            disabled={!p.preview || !from.preview}
                            title={!from.preview ? 'No preview for the current song' : 'Hear song A fade into song B'}
                            onClick={() => (mixing ? stopMix() : playMix(id, from, p))}
                          >
                            {mixing ? '■ Stop' : '▶ Hear the transition'}
                          </button>
                          <button className="btn-ghost sm" onClick={() => addToSet(p)}>
                            + Add to set
                          </button>
                          <QueueBtn s={p} />
                        </div>
                        {queued[id] && !['ok', 'busy'].includes(queued[id]) && <div className="status err">{queued[id]}</div>}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {ranked.length > 4 && (
                <button className="link-btn" onClick={() => setMore(!more)}>
                  {more ? 'Show top 4 only' : `Show ${ranked.length - 4} more`} ›
                </button>
              )}
              {rec?.candidates > 0 && (
                <div className="foot">
                  From {rec.candidates} songs ListenBrainz listeners play with this one
                  {rec.sources?.includes('artists') ? ' or by similar artists' : ''}. Tempo, key and energy are measured from the
                  30-second previews, so treat them as close estimates.
                </div>
              )}
            </section>
          )}

          <section className="ml-set">
            <h3 className="ml-h">
              Your set <span className="ml-count">{set.length}</span>
              {set.length > 0 && (
                <button className="link-btn ml-clear" onClick={() => setSet([])}>
                  Clear
                </button>
              )}
            </h3>
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
                      <li className={s.now ? 'now' : ''}>
                        {s.cover ? <img src={s.cover} alt="" /> : <div className="ph" />}
                        <div className="un-body">
                          <div className="un-title">
                            {s.now && <span className="ml-now">NOW</span>}
                            {s.title}
                          </div>
                          <div className="tr-artist">{s.artist}</div>
                          <Chips a={cur} small noPreview={!s.preview} />
                          {queued[idOf(s)] && !['ok', 'busy'].includes(queued[idOf(s)]) && (
                            <div className="status err">{queued[idOf(s)]}</div>
                          )}
                        </div>
                        {!s.now && (
                          <div className="ml-ctrl">
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

            {set.length > 0 && (
              <div className="ml-setbar">
                {queueReady ? (
                  <button className="btn-green" onClick={queueWholeSet}>
                    Queue all in Spotify
                  </button>
                ) : loggedIn ? (
                  <button
                    className="btn-green"
                    onClick={async () => {
                      logout();
                      await login();
                    }}
                  >
                    Reconnect Spotify to queue
                  </button>
                ) : (
                  <span className="muted">Connect Spotify to send this set to your queue.</span>
                )}
                {queueAll && <span className="ml-qstatus">{queueAll}</span>}
              </div>
            )}

            <SongSearch onAdd={addToSet} inSet={inChain} />
          </section>
        </div>
      </aside>
    </div>
  );
}

function Chips({ a, rel, small, noPreview }) {
  if (noPreview) return <div className="ml-chips"><span className="ml-chip dim">No preview to measure</span></div>;
  if (a.failed) return <div className="ml-chips"><span className="ml-chip dim">Couldn't measure this preview</span></div>;
  if (!a.analysed) {
    return (
      <div className="ml-chips">
        <span className="ml-chip dim pulse">Measuring tempo &amp; key…</span>
      </div>
    );
  }
  const gap = rel?.analysed ? tempoGap(rel.bpm, a.bpm) : null;
  const ks = rel?.analysed ? keyScore(rel.key?.camelot, a.key?.camelot) : null;
  return (
    <div className={`ml-chips ${small ? 'sm' : ''}`}>
      {a.bpm && (
        <span className={`ml-chip ${gap != null ? (gap <= 3 ? 'good' : gap <= 8 ? 'ok' : 'bad') : ''}`} title="Tempo (beats per minute)">
          {Math.round(a.bpm)} BPM
        </span>
      )}
      {a.key && (
        <span className={`ml-chip ${ks != null ? (ks >= 0.85 ? 'good' : ks >= 0.5 ? 'ok' : 'bad') : ''}`} title={`Key: ${a.key.name} (Camelot ${a.key.camelot})`}>
          {a.key.camelot} · {a.key.name}
        </span>
      )}
      {a.energy != null && (
        <span className="ml-chip" title="Energy (loudness)">
          ⚡ <span className="ml-energy"><span style={{ width: `${a.energy}%` }} /></span>
        </span>
      )}
    </div>
  );
}

function Score({ value, live }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <div className={`ml-score ${live ? '' : 'est'}`} title={live ? 'Transition score' : 'Listening data only, audio still being measured'}>
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} className="bg" />
        <circle cx="20" cy="20" r={r} className="fg" strokeDasharray={`${(value / 100) * c} ${c}`} />
      </svg>
      <b>{value}</b>
      <span>blend</span>
    </div>
  );
}

function Link({ from, to }) {
  const ready = from.analysed && to.analysed;
  const score = transitionScore(from, { ...to, match: to.match ?? 60 });
  return (
    <li className="ml-link">
      <span className={`ml-link-score ${!ready ? 'dim' : score >= 75 ? 'good' : score >= 55 ? 'ok' : 'bad'}`}>
        {ready ? `${score}` : '··'}
      </span>
      <span className="ml-link-tip">{ready ? transitionTip(from, to) : 'Measuring…'}</span>
    </li>
  );
}

function MixBar({ mix }) {
  const label = mix.phase === 'loading' ? 'Loading…' : mix.phase === 'a' ? 'Song A' : mix.phase === 'fade' ? 'Crossfading' : 'Song B';
  return (
    <div className="ml-mixbar">
      <div className="ml-mixtrack">
        <span style={{ width: `${(mix.progress || 0) * 100}%` }} />
        <i style={{ left: `${(7 / 21) * 100}%`, width: `${(6 / 21) * 100}%` }} />
      </div>
      <span>
        {label}
        {mix.rate && Math.abs(mix.rate - 1) > 0.005 ? ` · tempo matched ${mix.rate > 1 ? '+' : ''}${Math.round((mix.rate - 1) * 100)}%` : ''}
      </span>
    </div>
  );
}

function SongSearch({ onAdd, inSet }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const playing = usePlaying();
  useEffect(() => {
    if (q.trim().length < 2) return setRes(null);
    const t = setTimeout(() => {
      setRes({ loading: true });
      getJson(`/api/song-search?q=${encodeURIComponent(q.trim())}`)
        .then((list) => setRes({ list }))
        .catch((e) => setRes({ error: e.message }));
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="ml-search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add any song: search title or artist…" />
      {res?.loading && <div className="muted">Searching…</div>}
      {res?.error && <div className="status err">{res.error}</div>}
      {res?.list?.length === 0 && <div className="muted">No songs found.</div>}
      {res?.list?.length > 0 && (
        <ul>
          {res.list.slice(0, 6).map((s) => {
            const added = inSet.has(idOf(s));
            return (
              <li key={idOf(s) + s.album}>
                <button className="un-cover sm" disabled={!s.preview} onClick={() => togglePreview(s.preview)}>
                  {s.cover ? <img src={s.cover} alt="" /> : <div className="ph" />}
                  {s.preview && <span className="tr-play">{playing === s.preview ? '❚❚' : '▶'}</span>}
                </button>
                <div className="un-body">
                  <div className="un-title">{s.title}</div>
                  <div className="tr-artist">{s.artist}</div>
                </div>
                <button className="btn-ghost sm" disabled={added} onClick={() => onAdd(s)}>
                  {added ? '✓ Added' : '+ Add'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
