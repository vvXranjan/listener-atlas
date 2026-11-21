import React, { useEffect, useMemo, useRef, useState } from 'react';
import { transitionScore, transitionTip } from './audioAnalysis.js';
import { playMix, stopMix, useMix } from './mixPlayer.js';
import { togglePreview, usePlaying, stopPreview } from './player.js';
import { mixOnSpotify } from './spotifyPlayer.js';
import { canQueue, queueSong, isLoggedIn, logout, login, canLibrary, likedSongs } from './spotify.js';
import { getSet, onSetChange, addToSet as addSong } from './setStore.js';
import SetPanel from './SetPanel.jsx';
import { useHabits, setHabitWeight, usualNext, habitTimes, blendedMatch } from './habits.js';
import { idOf, firstArtist, spotifySearch, getJson, useNowItem, useAnalyses, Chips, Score, MixBar } from './mixParts.jsx';
import ArtistLink from './ArtistLink.jsx';

// Mix Lab: the best next songs for a smooth transition, plus your own set.
export default function MixLab({ track, onArtist, onClose, onLibrary, onFloat, floatingSet, onDock }) {
  const start = useNowItem(track); // the song playing now, with a preview
  const [set, setSetState] = useState(getSet);
  const [lib, setLib] = useState(null); // songs from your Liked Songs to try as next picks
  const hab = useHabits(); // your listening habits (cloud-synced)
  const [habitItems, setHabitItems] = useState([]); // songs you usually play after the current one
  const previewCache = useRef(new Map());
  const [recs, setRecs] = useState({}); // anchor id -> recommend result
  const { an, analyse, withAudio } = useAnalyses();
  const [more, setMore] = useState(false);
  const [queued, setQueued] = useState({}); // id -> 'busy' | 'ok' | error
  const [live, setLive] = useState({}); // id -> step text while mixing on Spotify
  const mix = useMix();
  const playing = usePlaying();

  // the set is shared with the Library popup and saved in this browser
  useEffect(() => onSetChange(setSetState), []);

  // try your own Liked Songs as next picks (great when open data is thin)
  async function loadLibrary() {
    setLib({ loading: true, step: 'Reading your Liked Songs…' });
    try {
      const { items } = await likedSongs(0);
      const inSet = new Set(chain.map(idOf));
      const pick = items.filter((t) => !inSet.has(idOf(t))).slice(0, 16);
      const out = [];
      let done = 0;
      // look up previews two at a time (Apple limits how fast we can ask)
      const work = [...pick];
      await Promise.all(
        [0, 1].map(async () => {
          while (work.length) {
            const t = work.shift();
            const qs = new URLSearchParams({ title: t.title, artist: firstArtist(t.artist) });
            const p = await getJson(`/api/preview?${qs}`).catch(() => null);
            done += 1;
            setLib({ loading: true, step: `Finding previews… ${done}/${pick.length}` });
            if (p?.preview) {
              out.push({
                ...t,
                cover: t.cover || p.coverHq,
                preview: p.preview,
                match: 50,
                source: 'library',
                why: 'From your Liked Songs.',
                spotifySearch: t.url || spotifySearch(t),
              });
            }
          }
        })
      );
      setLib({ items: out });
    } catch (e) {
      setLib({ error: e.message });
    }
  }

  useEffect(() => () => stopMix(), []);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // the mix so far: now playing, then your set. Suggestions follow the last song.
  const chain = useMemo(() => (start ? [start, ...set] : set), [start, set]);
  const anchor = chain[chain.length - 1] || null;
  const anchorId = anchor ? idOf(anchor) : null;
  const rec = anchorId ? recs[anchorId] : null;

  // songs you usually play after this one: add them as candidates (with a preview to measure)
  useEffect(() => {
    if (!anchor) return setHabitItems([]);
    let alive = true;
    const list = usualNext(anchor, 6);
    if (!list.length) return setHabitItems([]);
    Promise.all(
      list.map(async (h) => {
        const k = idOf(h);
        if (!previewCache.current.has(k)) {
          const qs = new URLSearchParams({ title: h.title, artist: firstArtist(h.artist) });
          previewCache.current.set(k, getJson(`/api/preview?${qs}`).catch(() => null));
        }
        const p = await previewCache.current.get(k);
        return { ...h, cover: p?.coverHq || null, preview: p?.preview || null, appleUrl: p?.appleUrl || null, match: 0, source: 'habit', why: '' };
      })
    ).then((items) => alive && setHabitItems(items));
    return () => {
      alive = false;
    };
  }, [anchorId, hab.doc?.updatedAt]);

  useEffect(() => {
    if (!anchor || recs[anchorId]) return;
    setRecs((r) => ({ ...r, [anchorId]: { loading: true } }));
    const qs = new URLSearchParams({ title: anchor.title, artists: anchor.artist.split(/,|&/).map((x) => x.trim()).filter(Boolean).join('|') });
    getJson(`/api/recommend?${qs}`)
      .then((j) => setRecs((r) => ({ ...r, [anchorId]: j })))
      .catch((e) => setRecs((r) => ({ ...r, [anchorId]: { error: e.message } })));
  }, [anchorId]);

  // measure the current song first, then the best-matching candidates (cached after once)
  useEffect(() => {
    analyse(anchor?.preview, 0);
    [...(rec?.pool || [])].sort((a, b) => b.match - a.match).forEach((p, i) => analyse(p.preview, 1 + i));
    (lib?.items || []).forEach((p, i) => analyse(p.preview, 20 + i));
    habitItems.forEach((p, i) => analyse(p.preview, 5 + i)); // your habits: measure early
  }, [anchor?.preview, rec?.pool, lib?.items, habitItems, analyse]);

  const from = withAudio(anchor);
  const inChain = new Set(chain.map(idOf));
  // every candidate: community picks, your liked songs, and songs you usually play next
  const candidates = [];
  const seenIds = new Set();
  for (const p of [...(rec?.pool || []), ...(lib?.items || []), ...habitItems]) {
    const id = idOf(p);
    if (seenIds.has(id) || inChain.has(id)) continue;
    seenIds.add(id);
    candidates.push(p);
  }
  const ranked = candidates
    .map((p) => {
      // "data" part of the blend = your habit + community, mixed by the 25/50/75 switch
      const n = anchor ? habitTimes(anchor, p) : 0;
      const blend = anchor ? Math.round(blendedMatch(anchor, p, p.match || 0, hab.weight) * 100) : p.match;
      const to = { ...withAudio(p), match: blend };
      const habitNote = n ? `🔁 You play this after "${anchor.title}" (${n}×).` : null;
      return {
        ...to,
        habitN: n,
        why: habitNote ? `${habitNote} ${p.why || ''}`.trim() : p.why,
        score: transitionScore(from, to),
        tip: to.analysed && from.analysed ? transitionTip(from, to) : null,
      };
    })
    .sort((a, b) => b.score - a.score || b.match - a.match);
  const pending = candidates.filter((p) => p.preview && (!an[p.preview] || an[p.preview] === 'busy')).length;
  const shown = more ? ranked : ranked.slice(0, 4);

  const addToSet = (s) => addSong(s);
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

        <header className="ml-head ml-head-top">
          <div className="ml-kicker">
            <span className="spark">✦</span> MIX LAB
          </div>
        </header>

        {/* Your set + Auto-DJ first, then suggestions */}
        <div className="d-body ml-top-set">
          {floatingSet ? (
            <section className="ml-set">
              <h3 className="ml-h">
                Your set <span className="ml-count">{set.length}</span>
              </h3>
              <div className="muted">
                Your set is in its own floating window.{' '}
                <button className="link-btn" onClick={onDock}>
                  Put it back here
                </button>
              </div>
            </section>
          ) : (
            <SetPanel start={start} onLibrary={onLibrary} onFloat={onFloat} />
          )}
        </div>

        <header className="ml-head ml-head-next">
          <h2>What should play next?</h2>
          <div className="muted">
            Songs real listeners play together, ranked by how smoothly they blend: tempo, key and energy.
          </div>
          <div className="ml-hint">
            ▶ Hear the transition = quick preview here (your Spotify pauses). ⇄ Mix into it = fades your real Spotify into the song.
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
                  <div className="tr-artist">
                    <ArtistLink name={from.artist} />
                  </div>
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
              {isLoggedIn() && (
                <div className="ml-habits">
                  <span className="ml-label" title="How much your own listening habits count vs what the community plays together">
                    Your habits
                  </span>
                  <div className="seg gx-seg">
                    {[0.25, 0.5, 0.75].map((w) => (
                      <button key={w} className={hab.weight === w ? 'on' : ''} onClick={() => setHabitWeight(w)}>
                        {Math.round(w * 100)}%
                      </button>
                    ))}
                  </div>
                  <span className="muted ml-habits-note">
                    {hab.weight === 0.25 ? 'more discovery' : hab.weight === 0.75 ? 'mostly your patterns' : 'balanced'} ·{' '}
                    {Object.keys(hab.doc?.songs || {}).length
                      ? `learned from ${Object.values(hab.doc.songs).reduce((a, s) => a + s.n, 0)} plays${hab.mode === 'cloud' ? ' · ☁ synced' : hab.mode === 'local' ? ' · this browser' : ''}`
                      : hab.syncing
                        ? 'learning your habits…'
                        : 'no habits learned yet'}
                  </span>
                </div>
              )}
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
                    <li key={`${id}|${i}`} className={mixing || playing === p.preview ? 'on' : ''}>
                      <span className="un-rank">{i + 1}</span>
                      <button className="un-cover" disabled={!p.preview} onClick={() => togglePreview(p.preview)} title="Play 30s preview">
                        {p.cover ? <img src={p.cover} alt="" /> : <div className="ph" />}
                        {p.preview && <span className="tr-play">{playing === p.preview ? '❚❚' : '▶'}</span>}
                      </button>
                      <div className="un-body">
                        <div className="ml-top">
                          <div className="ml-titles">
                            <div className="un-title">{p.title}</div>
                            <div className="tr-artist">
                              <ArtistLink name={p.artist} />
                            </div>
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
                          {queueReady && (
                            <button className="btn-ghost sm ml-live" onClick={() => mixLive(p)} title="Fade your Spotify into this song">
                              ⇄ Mix into it on Spotify
                            </button>
                          )}
                          <button className="btn-ghost sm" onClick={() => addToSet(p)}>
                            + Add to set
                          </button>
                          <QueueBtn s={p} />
                        </div>
                        {live[id] && <div className={`ml-livestep ${live[id].startsWith('⚠') ? 'err' : ''}`}>{live[id]}</div>}
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
              {isLoggedIn() && !lib?.items && (
                <div className="ml-libcta">
                  {canLibrary() ? (
                    <button className="btn-ghost sm ml-live" disabled={lib?.loading} onClick={loadLibrary}>
                      {lib?.loading ? lib.step : '♥ Find best next in my Liked Songs'}
                    </button>
                  ) : (
                    <button
                      className="btn-ghost sm"
                      onClick={async () => {
                        logout();
                        await login();
                      }}
                    >
                      Reconnect Spotify to use your Liked Songs
                    </button>
                  )}
                  {lib?.error && <div className="status err">{lib.error}</div>}
                </div>
              )}
              {lib?.items && (
                <div className="ml-livestep">
                  ♥ Added {lib.items.length} of your Liked Songs to the ranking (tagged "From your Liked Songs").
                </div>
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

        </div>
      </aside>
    </div>
  );
}
