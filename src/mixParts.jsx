import React, { useCallback, useEffect, useRef, useState } from 'react';
import { analyzePreview, transitionScore, transitionTip, tempoGap, keyScore } from './audioAnalysis.js';
import { togglePreview, usePlaying } from './player.js';
import { isLoggedIn, searchSpotify } from './spotify.js';
import { songId } from './setStore.js';
import ArtistLink from './ArtistLink.jsx';

// Bits shared by Mix Lab and the "Your set" panel

export const idOf = songId;
export const firstArtist = (a) => a.split(/,|&| with | feat\.? /i)[0].trim();
export const spotifySearch = (s) =>
  `https://open.spotify.com/search/${encodeURIComponent(`${s.title.replace(/\s*[([].*?[)\]]/g, '')} ${firstArtist(s.artist)}`)}`;

export async function getJson(url) {
  const r = await fetch(url);
  if (!r.headers.get('content-type')?.includes('json')) throw new Error('Data server not running the new code. Restart npm run dev.');
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// The song playing on your Spotify, plus a 30s preview so it can be measured
export function useNowItem(track) {
  const [item, setItem] = useState(null);
  useEffect(() => {
    if (!track) return setItem(null);
    const base = { title: track.name, artist: track.artists.map((a) => a.name).join(', '), cover: track.cover, now: true };
    setItem(base);
    let alive = true;
    const qs = new URLSearchParams({ title: base.title, artist: track.artists[0].name });
    getJson(`/api/preview?${qs}`)
      .then((p) => alive && setItem({ ...base, preview: p.preview, cover: base.cover || p.coverHq }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [track?.id, track?.name]);
  return item;
}

// Tempo / key / energy for songs, measured in the background and cached
export function useAnalyses() {
  const [an, setAn] = useState({});
  const ref = useRef({});
  const analyse = useCallback((url, priority) => {
    if (!url) return;
    if (ref.current[url]) {
      if (ref.current[url] === 'busy') analyzePreview(url, priority); // bump it up the queue
      return;
    }
    ref.current[url] = 'busy';
    setAn((m) => ({ ...m, [url]: 'busy' }));
    analyzePreview(url, priority)
      .then((r) => r || 'fail')
      .catch(() => 'fail')
      .then((r) => {
        ref.current[url] = r;
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
  return { an, analyse, withAudio };
}

export function Chips({ a, rel, small, noPreview }) {
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

export function Score({ value, live }) {
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

export function Link({ from, to }) {
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

export function MixBar({ mix }) {
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

export function SongSearch({ onAdd, inSet }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const playing = usePlaying();
  useEffect(() => {
    if (q.trim().length < 2) return setRes(null);
    const t = setTimeout(() => {
      setRes({ loading: true });
      // Spotify's search ranks far better; Apple's is the fallback
      const term = q.trim();
      (isLoggedIn() ? searchSpotify(term).catch(() => getJson(`/api/song-search?q=${encodeURIComponent(term)}`)) : getJson(`/api/song-search?q=${encodeURIComponent(term)}`))
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
          {res.list.slice(0, 6).map((s, i) => {
            const added = inSet.has(idOf(s));
            return (
              <li key={`${s.uri || idOf(s)}|${i}`}>
                <button className="un-cover sm" disabled={!s.preview} onClick={() => togglePreview(s.preview)} title={s.preview ? 'Play 30s preview' : ''}>
                  {s.cover ? <img src={s.cover} alt="" /> : <div className="ph" />}
                  {s.preview && <span className="tr-play">{playing === s.preview ? '❚❚' : '▶'}</span>}
                </button>
                <div className="un-body">
                  <div className="un-title">{s.title}</div>
                  <div className="tr-artist">
                    <ArtistLink name={s.artist} />
                  </div>
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
