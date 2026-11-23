import React, { useEffect, useMemo, useRef, useState } from 'react';
import { analyzePreview } from './audioAnalysis.js';
import { EFFECTS, playFx, stopFx, toggleFx, useFx } from './soundFx.js';
import { canQueue, isLoggedIn, queueSong } from './spotify.js';
import { mixOnSpotify } from './spotifyPlayer.js';
import ArtistLink from './ArtistLink.jsx';
import { GenreChip } from './GenreView.jsx';
import { openAlbums } from './AlbumsView.jsx';

// Artist Galaxy: the artist in the center, their songs on the inner orbit
// (grouped by mood), similar artists on the outer orbit (grouped by genre).

const MOODS = ['Hype', 'Dark', 'Dreamy', 'Melodic', 'Chill'];
const MOOD_COLOR = { Hype: '#1ed760', Dark: '#9b8cff', Dreamy: '#5ee7ff', Melodic: '#7dffb6', Chill: '#d4ff6b' };
const MOOD_HINT = {
  Hype: 'Loud, hard-hitting, fast or bouncy',
  Dark: 'Minor key, murky, heavy low end',
  Dreamy: 'Spacey, reverb-washed, floating',
  Melodic: 'Bright, tuneful, smooth',
  Chill: 'Calm, soft, laid back',
};
const SOUND_HINT = {
  'Heavy 808s': 'Lots of energy below 120 Hz',
  'Spacey reverb': 'Sound keeps ringing between hits',
  'Hard drums': 'Hits stand far above the rest of the mix',
  Bright: 'Lots of high-end shimmer',
  Murky: 'Dark, muffled top end',
  'Half-time bounce': 'Felt at half speed (around 70 BPM)',
};
const LAYOUT = {
  both: { song: [105, 250], songLabel: 272, artist: [320, 445], artistLabel: 474 },
  songs: { song: [120, 400], songLabel: 438 },
  artists: { artist: [130, 420], artistLabel: 452 },
};
const C = 500;
const TAU = Math.PI * 2;
const firstArtist = (a) => a.split(/,|&| with | feat\.? /i)[0].trim();
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

// Slices of the circle: busy groups get more room, empty ones a little
export function arcs(sectors, items, keyOf) {
  const counts = sectors.map((s) => items.filter((it) => keyOf(it) === s).length);
  const total = counts.reduce((a, c) => a + 1 + c, 0) || 1;
  let a = -Math.PI / 2;
  const out = new Map();
  sectors.forEach((s, i) => {
    const w = ((1 + counts[i]) / total) * TAU;
    out.set(s, { start: a, width: w, mid: a + w / 2 });
    a += w;
  });
  return out;
}

function place(items, sectors, keyOf, rOf, [r0, r1], slices) {
  const groups = new Map(sectors.map((s) => [s, []]));
  const free = [];
  for (const it of items) (groups.get(keyOf(it)) || free).push(it);
  const pos = new Map();
  groups.forEach((list, s) => {
    const { start, width } = slices.get(s);
    // how many fit side by side at the middle of this slice (about 56 units apart)
    const fit = Math.max(1, Math.floor((width * ((r0 + r1) / 2)) / 56));
    if (list.length <= fit) {
      list.forEach((it, j) => {
        const a = start + width * 0.08 + ((j + 0.5) / list.length) * width * 0.84;
        const r = r0 + rOf(it) * (r1 - r0);
        pos.set(it, { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r });
      });
      return;
    }
    // crowded: rows from the inside out, most played on the inner row, rows staggered
    const sorted = [...list].sort((x, y) => rOf(x) - rOf(y));
    const rows = Math.ceil(sorted.length / fit);
    const perRow = Math.ceil(sorted.length / rows);
    sorted.forEach((it, j) => {
      const row = Math.floor(j / perRow);
      const k = j % perRow;
      const inRow = Math.min(perRow, sorted.length - row * perRow);
      const shift = row % 2 ? 0.5 / inRow : 0;
      const a = start + width * 0.06 + (((k + 0.5) / inRow + shift) % 1) * width * 0.88;
      const r = r0 + ((row + 0.5) / rows) * (r1 - r0);
      pos.set(it, { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r });
    });
  });
  // songs still being measured wait on an evenly spaced ring
  free.forEach((it, j) => {
    const a = -Math.PI / 2 + (j / Math.max(1, free.length)) * TAU + (hash(it.title || it.name) % 10) / 40;
    const r = r0 + rOf(it) * (r1 - r0) * 0.7;
    pos.set(it, { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r, pending: true });
  });
  return pos;
}

export default function ArtistGalaxy({ name: startName, onClose, onMixLab }) {
  const [history, setHistory] = useState([startName]);
  const name = history[history.length - 1];
  const [data, setData] = useState(null);
  const [an, setAn] = useState({});
  const [view, setView] = useState('both');
  const [sel, setSel] = useState(null); // { type, item }
  const [hover, setHover] = useState(null);
  const [moodFilter, setMoodFilter] = useState(null);
  const [soundFilter, setSoundFilter] = useState(null);
  const [queued, setQueued] = useState({});
  const fx = useFx();
  const alive = useRef(true);

  // ---- 3D camera: the galaxy is a tilted disc that slowly turns; drag to spin / tilt
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [cam, setCam] = useState({ spin: 0, tilt: 56, flat: false });
  const [autoSpin, setAutoSpin] = useState(!reduced);
  const camRef = useRef(cam);
  camRef.current = cam;
  const drag = useRef(null); // { x, y, spin, tilt, moved }
  const holdSpin = !!hover || !!sel || cam.flat || !autoSpin;
  useEffect(() => {
    if (holdSpin) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = (t) => {
      const dt = Math.min(100, t - last);
      last = t;
      acc += dt;
      // ~30 updates a second is plenty for a slow spin
      if (acc >= 33 && !drag.current && !document.hidden) {
        const deg = (acc / 1000) * 4; // one turn in ~90 s
        acc = 0;
        setCam((c) => ({ ...c, spin: (c.spin + deg) % 360 }));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [holdSpin]);
  const onPointerDown = (e) => {
    if (cam.flat) return;
    drag.current = { x: e.clientX, y: e.clientY, spin: cam.spin, tilt: cam.tilt, moved: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    setCam((c) => ({ ...c, spin: (d.spin - dx * 0.35 + 360) % 360, tilt: Math.max(30, Math.min(74, d.tilt - dy * 0.25)) }));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      dragged.current = true;
      setTimeout(() => (dragged.current = false), 0);
    }
  };
  const dragged = useRef(false); // swallow the click that ends a drag
  const tap = (fn) => (e) => {
    e.stopPropagation();
    if (!dragged.current) fn(e);
  };
  // flat-plane point (0..1000) -> screen point with depth
  const proj = useMemo(() => {
    const sp = (cam.flat ? 0 : cam.spin) * (Math.PI / 180);
    const a = (cam.flat ? 0 : cam.tilt) * (Math.PI / 180);
    const f = 1500;
    const cs = Math.cos(sp);
    const sn = Math.sin(sp);
    return (x, y) => {
      const dx = x - C;
      const dy = y - C;
      const u = dx * cs - dy * sn;
      const v = dx * sn + dy * cs;
      const Z = v * Math.sin(a);
      const sc = f / (f - Z);
      return { x: C + u * sc, y: C + v * Math.cos(a) * sc, s: sc, z: Z };
    };
  }, [cam]);
  const ringPath = (r) => {
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * TAU;
      const q = proj(C + Math.cos(t) * r, C + Math.sin(t) * r);
      d += `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    }
    return d;
  };
  const viewHalf = cam.flat ? 500 : Math.round(480 * Math.cos((cam.tilt * Math.PI) / 180) * 1.2 + 90);

  useEffect(() => () => {
    alive.current = false;
    stopFx();
  }, []);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    setData(null);
    setSel(null);
    setMoodFilter(null);
    setSoundFilter(null);
    fetch(`/api/galaxy?name=${encodeURIComponent(name)}`)
      .then(async (r) => {
        if (!r.headers.get('content-type')?.includes('json')) throw new Error('Data server not running the new code. Restart npm run dev.');
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        return j;
      })
      .then((j) => {
        if (!alive.current) return;
        setData(j);
        // measure every song's sound, one by one (cached after the first time)
        j.songs.forEach((s, i) => {
          if (!s.preview) return;
          analyzePreview(s.preview, 10 + i)
            .then((res) => alive.current && setAn((m) => ({ ...m, [s.preview]: res || 'fail' })))
            .catch(() => alive.current && setAn((m) => ({ ...m, [s.preview]: 'fail' })));
        });
      })
      .catch((e) => alive.current && setData({ error: e.message }));
  }, [name]);

  const songs = useMemo(
    () => (data?.songs || []).map((s) => ({ ...s, a: typeof an[s.preview] === 'object' ? an[s.preview] : null })),
    [data, an]
  );
  const artists = data?.artists || [];
  const sectors = data?.sectors || [];
  const L = LAYOUT[view];
  const moodOf = (s) => s.a?.vibe?.mood;
  const songSlices = useMemo(() => arcs(MOODS, songs, moodOf), [songs]);
  const artistSlices = useMemo(() => arcs(sectors, artists, (a) => a.sector), [artists, sectors]);
  const songPos = useMemo(
    () => (L.song ? place(songs, MOODS, moodOf, (s) => 1 - s.popularity, L.song, songSlices) : new Map()),
    [songs, view, songSlices]
  );
  const artistPos = useMemo(
    () => (L.artist ? place(artists, sectors, (a) => a.sector, (a) => 1 - a.similarity, L.artist, artistSlices) : new Map()),
    [artists, sectors, view, artistSlices]
  );
  const labelledArtists = useMemo(
    () => new Set([...artists].sort((a, b) => b.similarity - a.similarity).slice(0, 8).map((a) => a.name)),
    [artists]
  );
  // only label the biggest songs, so names don't pile up
  const labelled = useMemo(
    () => new Set([...songs].sort((a, b) => b.popularity - a.popularity).slice(0, 5).map((s) => s.title)),
    [songs]
  );

  const measured = songs.filter((s) => s.a).length;
  const measurable = songs.filter((s) => s.preview && an[s.preview] !== 'fail').length;
  const soundTags = [...new Set(songs.flatMap((s) => s.a?.vibe?.sound || []))];
  const moodCounts = MOODS.map((m) => [m, songs.filter((s) => s.a?.vibe?.mood === m).length]);
  const songMatch = (s) =>
    (!moodFilter || s.a?.vibe?.moods?.includes(moodFilter)) && (!soundFilter || s.a?.vibe?.sound?.includes(soundFilter));
  const filtering = moodFilter || soundFilter;

  const openArtist = (n) => setHistory((h) => [...h, n]);
  const back = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));

  async function playArtistTop(a) {
    if (!a.topSong) return;
    const id = `artist|${a.name}`;
    if (a.preview) return playFx(id, a.preview);
    const qs = new URLSearchParams({ title: a.topSong.title, artist: a.name });
    const r = await fetch(`/api/preview?${qs}`);
    if (!r.ok) return;
    const p = await r.json();
    a.preview = p.preview;
    playFx(id, p.preview);
  }

  async function queue(s) {
    const id = `${s.title}|${s.artist}`;
    setQueued((q) => ({ ...q, [id]: 'busy' }));
    try {
      await queueSong(s.title, firstArtist(s.artist));
      setQueued((q) => ({ ...q, [id]: 'ok' }));
    } catch (e) {
      setQueued((q) => ({ ...q, [id]: e.message }));
    }
  }

  const sectorLabels = (slices, radius, colorOf) =>
    [...slices].map(([s, { mid }]) => {
      const q = proj(C + Math.cos(mid) * radius, C + Math.sin(mid) * radius);
      return (
        <text
          key={s}
          x={q.x}
          y={q.y}
          className="gx-sector"
          fill={colorOf?.(s)}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: `${15 * q.s}px`, opacity: Math.max(0.35, Math.min(1, 0.4 + (q.s - 0.8) * 1.4)) }}
        >
          {s.toUpperCase()}
        </text>
      );
    });
  const sectorLines = (slices, [r0, r1]) =>
    [...slices].map(([s, { start: a }]) => {
      const p0 = proj(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
      const p1 = proj(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
      return <line key={s} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className="gx-divider" />;
    });

  return (
    <div className="gx-wrap">
      <div className="gx-top">
        <div className="gx-title">
          {history.length > 1 && (
            <button className="gx-back" onClick={back}>
              ‹ {history[history.length - 2]}
            </button>
          )}
          <span className="ml-kicker">
            <span className="spark">✦</span> ARTIST GALAXY
          </span>
          <h2>{name}</h2>
          {data?.artist?.genres?.length > 0 && (
            <div className="gx-genres">
              {data.artist.genres.map((g) => (
                <GenreChip key={g} tag={g} artist={name} songs={data.songs} />
              ))}
            </div>
          )}
        </div>
        <div className="seg gx-seg">
          {[
            ['both', 'Both'],
            ['songs', 'Songs'],
            ['artists', 'Artists'],
          ].map(([v, l]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {l}
            </button>
          ))}
        </div>
        <button className="gx-albums-btn" onClick={() => openAlbums({ artist: name })} title={`${name}'s albums, EPs and singles`}>
          💿 Albums
        </button>
        <button className="x gx-x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {L.song && songs.length > 0 && (
        <div className="gx-filters">
          {moodCounts.map(([m, n]) => (
            <button
              key={m}
              className={`gx-chip ${moodFilter === m ? 'on' : ''}`}
              style={{ '--c': MOOD_COLOR[m] }}
              title={MOOD_HINT[m]}
              onClick={() => setMoodFilter(moodFilter === m ? null : m)}
            >
              <i /> {m} <b>{n}</b>
            </button>
          ))}
          {soundTags.length > 0 && <span className="gx-sep" />}
          {soundTags.map((t) => (
            <button key={t} className={`gx-chip sound ${soundFilter === t ? 'on' : ''}`} title={SOUND_HINT[t]} onClick={() => setSoundFilter(soundFilter === t ? null : t)}>
              {t}
            </button>
          ))}
          {measured < measurable && <span className="ml-busy">Listening to songs… {measured}/{measurable}</span>}
        </div>
      )}

      <div className="gx-body">
        <div className="gx-stage">
          {!data && <div className="gx-loading">Mapping {name}'s universe…</div>}
          {data?.error && <div className="status err gx-loading">{data.error}</div>}
          {data && !data.error && (
            <>
            <svg
              viewBox={`0 ${C - viewHalf} 1000 ${viewHalf * 2}`}
              className={`gx-svg gx-3d ${cam.flat ? 'flat' : ''} ${drag.current?.moved ? 'grabbing' : ''}`}
              onClick={tap(() => setSel(null))}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              <defs>
                <radialGradient id="gx-core">
                  <stop offset="0%" stopColor="rgba(30,215,96,.45)" />
                  <stop offset="100%" stopColor="rgba(30,215,96,0)" />
                </radialGradient>
                <clipPath id="gx-clip-c">
                  <circle cx={C} cy={C} r="62" />
                </clipPath>
                <clipPath id="gx-node" clipPathUnits="objectBoundingBox">
                  <circle cx=".5" cy=".5" r=".5" />
                </clipPath>
              </defs>

              {/* orbits (drawn as rings on the tilted disc) */}
              {[...(L.song ? [L.song[0], (L.song[0] + L.song[1]) / 2, L.song[1]] : []), ...(L.artist ? [L.artist[0], L.artist[1]] : [])].map((r, i) => (
                <path key={i} d={ringPath(r)} className="gx-orbit" />
              ))}
              {L.song && sectorLines(songSlices, [L.song[0] - 20, L.song[1] + 10])}
              {L.artist && sectorLines(artistSlices, [L.artist[0] - 20, L.artist[1] + 12])}
              {L.song && sectorLabels(songSlices, L.songLabel, (m) => MOOD_COLOR[m])}
              {L.artist && sectorLabels(artistSlices, L.artistLabel)}

              {(() => {
                // every dot, projected and sorted back-to-front (far dots behind the artist)
                const nodes = [];
                for (const a of artists) {
                  const p0 = artistPos.get(a);
                  if (p0) nodes.push({ kind: 'artist', item: a, p: proj(p0.x, p0.y), pending: false });
                }
                for (const so of songs) {
                  const p0 = songPos.get(so);
                  if (p0) nodes.push({ kind: 'song', item: so, p: proj(p0.x, p0.y), pending: p0.pending });
                }
                nodes.sort((x, y) => x.p.z - y.p.z);
                const depth = (p) => (cam.flat ? 1 : Math.max(0.45, Math.min(1, 0.55 + (p.s - 0.85) * 1.5)));
                const showLabels = !hover;
                const draw = (n) => {
                  const { p } = n;
                  if (n.kind === 'artist') {
                    const a = n.item;
                    const on = sel?.item === a;
                    const size = 16 + a.similarity * 10;
                    return (
                      <g
                        key={`a|${a.mbid || a.name}`}
                        className={`gx-n artist ${on ? 'on' : ''} ${hover === a ? 'hov' : ''} ${filtering ? 'dim' : ''}`}
                        style={{ transform: `translate(${p.x}px, ${p.y}px) scale(${p.s})`, '--d': depth(p) }}
                        onClick={tap(() => setSel({ type: 'artist', item: a }))}
                        onMouseEnter={() => setHover(a)}
                        onMouseLeave={() => setHover(null)}
                      >
                        <line x1="0" y1="0" x2={(C - p.x) / p.s} y2={(C - p.y) / p.s} className="gx-tether" />
                        <circle r={size + 4} className="gx-ring dashed" />
                        {a.topSong?.cover ? (
                          <image href={a.topSong.cover} x={-size} y={-size} width={size * 2} height={size * 2} clipPath="url(#gx-node)" preserveAspectRatio="xMidYMid slice" />
                        ) : (
                          <circle r={size} fill="#132a1d" />
                        )}
                        {(on || (showLabels && labelledArtists.has(a.name) && p.s > 0.97)) && (
                          <text y={size + 18} textAnchor="middle" className="gx-label">
                            {a.name}
                          </text>
                        )}
                      </g>
                    );
                  }
                  const so = n.item;
                  const mood = so.a?.vibe?.mood;
                  const on = sel?.type === 'song' && sel.item.title === so.title;
                  const size = 12 + so.popularity * 12;
                  const match = songMatch(so);
                  const playing = fx.id === `song|${so.title}` && fx.playing;
                  return (
                    <g
                      key={`s|${so.title}|${so.album || ''}`}
                      className={`gx-n song ${on ? 'on' : ''} ${hover === so ? 'hov' : ''} ${n.pending ? 'pending' : ''} ${filtering && !match ? 'dim' : ''} ${playing ? 'playing' : ''}`}
                      style={{ transform: `translate(${p.x}px, ${p.y}px) scale(${p.s})`, '--c': mood ? MOOD_COLOR[mood] : '#4b6a5a', '--d': depth(p) }}
                      onClick={tap(() => setSel({ type: 'song', item: so }))}
                      onDoubleClick={tap(() => playFx(`song|${so.title}`, so.preview))}
                      onMouseEnter={() => setHover(so)}
                      onMouseLeave={() => setHover(null)}
                    >
                      <circle r={size + 5} className="gx-ring" />
                      {so.cover ? (
                        <image href={so.cover} x={-size} y={-size} width={size * 2} height={size * 2} clipPath="url(#gx-node)" preserveAspectRatio="xMidYMid slice" />
                      ) : (
                        <circle r={size} fill="#132a1d" />
                      )}
                      {(on || (showLabels && labelled.has(so.title) && p.s > 0.97)) && (
                        <text y={size + 17} textAnchor="middle" className="gx-label song">
                          {so.title.length > 22 ? `${so.title.slice(0, 21)}…` : so.title}
                        </text>
                      )}
                    </g>
                  );
                };
                const behind = nodes.filter((n) => n.p.z < 0);
                const front = nodes.filter((n) => n.p.z >= 0);
                const hov = nodes.find((n) => n.item === hover);
                return (
                  <>
                    {behind.map(draw)}
                    {/* the artist */}
                    <circle cx={C} cy={C} r="120" fill="url(#gx-core)" className="gx-pulse" />
                    <g className="gx-center" onClick={tap(() => setSel(null))}>
                      <circle cx={C} cy={C} r="68" className="gx-center-ring" />
                      {data.artist.image ? (
                        <image href={data.artist.image} x={C - 62} y={C - 62} width="124" height="124" clipPath="url(#gx-clip-c)" preserveAspectRatio="xMidYMid slice" />
                      ) : (
                        <circle cx={C} cy={C} r="62" fill="#0b1a12" />
                      )}
                    </g>
                    {front.map(draw)}
                    {hov && <HoverCard n={hov} />}
                  </>
                );
              })()}
            </svg>
            <div className="gx-cam">
              <button className={`gx-fxbtn ${!cam.flat ? 'on' : ''}`} onClick={() => setCam((c) => ({ ...c, flat: !c.flat }))} title="3D view or flat map">
                {cam.flat ? '◎ Flat' : '◉ 3D'}
              </button>
              {!cam.flat && (
                <button className={`gx-fxbtn ${autoSpin ? 'on' : ''}`} onClick={() => setAutoSpin((v) => !v)} title="Slowly turn the galaxy">
                  ⟳ {autoSpin ? 'Spinning' : 'Spin'}
                </button>
              )}
              {!cam.flat && <span className="muted">Drag to turn and tilt</span>}
            </div>
            </>
          )}
        </div>

        <aside className="gx-side">
          {!sel && data && !data.error && (
            <div className="gx-card">
              <div className="ml-label">How to read it</div>
              <p className="gx-p">
                <b>{name}</b> sits in the middle. {L.song && <>Songs orbit close by, grouped by <b>mood</b>. Bigger and closer = more played. </>}
                {L.artist && <>Further out are <b>similar artists</b>, grouped by <b>genre</b>. Closer = more fans in common.</>}
              </p>
              <p className="gx-p muted">Click a dot for details and effects. Double-click a song to play it.</p>
              <div className="gx-stats">
                <div>
                  <b>{songs.length}</b>
                  <span>songs</span>
                </div>
                <div>
                  <b>{artists.length}</b>
                  <span>similar artists</span>
                </div>
                <div>
                  <b>{sectors.filter((s) => s !== 'other').length}</b>
                  <span>genres</span>
                </div>
              </div>
              {measured > 0 && (
                <>
                  <div className="ml-label gx-mt">{name}'s sound</div>
                  <SoundMeters a={avgSound(songs)} />
                </>
              )}
              <div className="foot">{data.source}. Mood and sound are measured from 30-second previews, so they're estimates.</div>
            </div>
          )}

          {sel?.type === 'song' && (
            <SongCard
              s={songs.find((x) => x.title === sel.item.title) || sel.item}
              fx={fx}
              queued={queued[`${sel.item.title}|${sel.item.artist}`]}
              onQueue={() => queue(sel.item)}
              onMixLab={() =>
                onMixLab({ id: sel.item.title, name: sel.item.title, artists: [{ name: firstArtist(sel.item.artist) }], cover: sel.item.cover })
              }
            />
          )}

          {sel?.type === 'artist' && (
            <div className="gx-card">
              <div className="gx-hero">
                {sel.item.topSong?.cover ? <img src={sel.item.topSong.cover} alt="" /> : <div className="ph" />}
                <div>
                  <div className="ml-label">Similar artist</div>
                  <h3>{sel.item.name}</h3>
                  <div className="muted">{Math.round(sel.item.similarity * 100)}% fan overlap (relative)</div>
                </div>
              </div>
              <div className="gx-genres">
                {sel.item.genres.map((g) => (
                  <GenreChip key={g} tag={g} artist={sel.item.name} />
                ))}
              </div>
              {sel.item.topSong && (
                <div className="gx-p">
                  Biggest song: <b>{sel.item.topSong.title}</b>
                </div>
              )}
              <div className="un-actions">
                <button className="btn-green sm" onClick={() => openArtist(sel.item.name)}>
                  ✦ Open their galaxy
                </button>
                {sel.item.topSong && (
                  <button className="btn-ghost sm" onClick={() => playArtistTop(sel.item)}>
                    {fx.id === `artist|${sel.item.name}` && fx.playing ? '❚❚ Pause' : '▶ Play top song'}
                  </button>
                )}
              </div>
              {fx.id === `artist|${sel.item.name}` && <FxPanel fx={fx} />}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function avgSound(songs) {
  const list = songs.filter((s) => s.a?.sound);
  const avg = (f) => Math.round(list.reduce((a, s) => a + (f(s) || 0), 0) / list.length);
  return {
    bpm: avg((s) => s.a.bpm),
    energy: avg((s) => s.a.energy),
    sound: { bass: avg((s) => s.a.sound.bass), space: avg((s) => s.a.sound.space), brightness: avg((s) => s.a.sound.brightness), punch: avg((s) => s.a.sound.punch) },
  };
}

function SoundMeters({ a }) {
  const rows = [
    ['808s / bass', a.sound?.bass],
    ['Space / reverb', a.sound?.space],
    ['Brightness', a.sound?.brightness],
    ['Drum punch', a.sound?.punch],
    ['Energy', a.energy],
  ];
  return (
    <div className="gx-meters">
      {rows.map(([l, v]) => (
        <div key={l} className="gx-meter">
          <span>{l}</span>
          <div>
            <i style={{ width: `${v ?? 0}%` }} />
          </div>
          <b>{v ?? '–'}</b>
        </div>
      ))}
    </div>
  );
}

function FxPanel({ fx }) {
  return (
    <div className="gx-fx">
      <div className="ml-label">Live effects</div>
      <div className="gx-fx-row">
        {EFFECTS.map((e) => (
          <button key={e.id} className={`gx-fxbtn ${fx.fx[e.id] ? 'on' : ''}`} title={e.hint} onClick={() => toggleFx(e.id)}>
            {e.label}
          </button>
        ))}
      </div>
      <div className="ml-mixtrack gx-prog">
        <span style={{ width: `${(fx.t / (fx.d || 30)) * 100}%` }} />
      </div>
    </div>
  );
}

function SongCard({ s, fx, queued, onQueue, onMixLab }) {
  const a = s.a;
  const [live, setLive] = useState('');
  async function playOnSpotify() {
    stopFx();
    try {
      const name = await mixOnSpotify(s.title, s.artist, setLive);
      setLive(`✓ Playing ${name} on your Spotify`);
    } catch (e) {
      setLive(`⚠ ${e.message}`);
    }
  }
  const id = `song|${s.title}`;
  const playing = fx.id === id && fx.playing;
  const ready = isLoggedIn() && canQueue();
  return (
    <div className="gx-card">
      <div className="gx-hero">
        {s.cover ? <img src={s.cover} alt="" /> : <div className="ph" />}
        <div>
          <div className="ml-label">{[s.album, s.year].filter(Boolean).join(' · ') || 'Song'}</div>
          <h3>{s.title}</h3>
          <div className="muted">
            <ArtistLink name={s.artist} />
            {s.plays > 0 && <> · {fmt(s.plays)} open plays</>}
          </div>
        </div>
      </div>

      {a ? (
        <>
          <div className="ml-chips">
            {a.bpm && <span className="ml-chip">{Math.round(a.bpm)} BPM</span>}
            {a.key && (
              <span className="ml-chip">
                {a.key.camelot} · {a.key.name}
              </span>
            )}
            {a.vibe?.moods?.map((m) => (
              <span key={m} className="ml-chip mood" style={{ '--c': MOOD_COLOR[m] }}>
                {m}
              </span>
            ))}
          </div>
          {a.vibe?.sound?.length > 0 && (
            <div className="gx-genres gx-mt">
              {a.vibe.sound.map((t) => (
                <span key={t} title={SOUND_HINT[t]}>
                  {t}
                </span>
              ))}
            </div>
          )}
          <SoundMeters a={a} />
        </>
      ) : (
        <div className="ml-chips">
          <span className="ml-chip dim pulse">{s.preview ? 'Measuring the sound…' : 'No preview to measure'}</span>
        </div>
      )}

      {s.preview && (
        <>
          <button className="btn-green gx-play" onClick={() => playFx(id, s.preview)}>
            {playing ? '❚❚ Pause' : '▶ Play with effects'}
          </button>
          {fx.id === id ? <FxPanel fx={fx} /> : <div className="muted gx-mt">Try it slowed + reverb, or in 8D with headphones.</div>}
        </>
      )}

      <div className="un-actions gx-mt">
        <button className="btn-ghost sm" onClick={onMixLab}>
          ✦ Mix Lab from here
        </button>
        {ready && (
          <button className="btn-ghost sm ml-live" onClick={playOnSpotify}>
            ⇄ Play on my Spotify
          </button>
        )}
        {ready ? (
          <button className="btn-ghost sm" disabled={queued === 'busy' || queued === 'ok'} onClick={onQueue}>
            {queued === 'ok' ? '✓ Queued' : queued === 'busy' ? 'Adding…' : '+ Queue'}
          </button>
        ) : null}
        {s.appleUrl && (
          <a className="btn-ghost sm" href={s.appleUrl} target="_blank" rel="noreferrer">
            Apple Music ↗
          </a>
        )}
      </div>
      {live && <div className={`ml-livestep ${live.startsWith('⚠') ? 'err' : ''}`}>{live}</div>}
      {queued && !['ok', 'busy'].includes(queued) && <div className="status err">{queued}</div>}
    </div>
  );
}


// The dot you hover: bigger, with a few details next to it
function HoverCard({ n }) {
  const { p, item, kind } = n;
  const song = kind === 'song';
  const base = song ? 12 + item.popularity * 12 : 16 + item.similarity * 10;
  const R = Math.max(40, base * p.s * 1.9);
  const right = p.x < 620;
  const W = 260;
  const H = 108;
  const cx = right ? R + 14 : -R - 14 - W;
  const cover = song ? item.cover : item.topSong?.cover;
  const a = song ? item.a : null;
  const mood = a?.vibe?.mood;
  const color = song ? (mood ? MOOD_COLOR[mood] : '#7dffb6') : '#1ed760';
  const cut = (t, n2) => (t && t.length > n2 ? `${t.slice(0, n2 - 1)}…` : t || '');
  const lines = song
    ? [
        cut([item.album, item.year].filter(Boolean).join(' · ') || item.artist, 34),
        item.plays > 0 ? `${fmt(item.plays)} plays · ${fmt(item.listeners || 0)} listeners` : 'Not much open play data',
        a ? [a.bpm && `${Math.round(a.bpm)} BPM`, a.key?.camelot, mood].filter(Boolean).join(' · ') : item.preview ? 'Measuring tempo and key…' : 'No preview to measure',
      ]
    : [
        `${Math.round(item.similarity * 100)}% fan overlap`,
        cut((item.genres || []).slice(0, 2).join(' · ') || 'Similar artist', 34),
        item.topSong ? cut(`Biggest: ${item.topSong.title}`, 34) : '',
      ];
  return (
    <g className="gx-hover" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
      <circle r={R + 10} fill={color} opacity=".12" />
      <circle r={R + 4} fill="none" stroke={color} strokeWidth="3" />
      {cover ? (
        <image href={cover} x={-R} y={-R} width={R * 2} height={R * 2} clipPath="url(#gx-node)" preserveAspectRatio="xMidYMid slice" />
      ) : (
        <circle r={R} fill="#132a1d" />
      )}
      <g transform={`translate(${cx}, ${-H / 2})`}>
        <rect width={W} height={H} rx="14" className="gx-hcard" stroke={color} />
        <text x="14" y="26" className="gx-h-title">
          {cut(song ? item.title : item.name, 24)}
        </text>
        {lines.map((l, i) => (
          <text key={i} x="14" y={48 + i * 19} className={`gx-h-line ${i === 2 ? 'strong' : ''}`} fill={i === 2 ? color : undefined}>
            {l}
          </text>
        ))}
      </g>
    </g>
  );
}
