import { useEffect, useMemo, useRef, useState } from 'react';
import { useNow, getNow } from './nowStore.js';
import { seekHere } from './spotifyPlayer.js';
import { isLoggedIn } from './spotify.js';
import ArtistLink from './ArtistLink.jsx';

// Open from anywhere
export const openLyrics = () => window.dispatchEvent(new CustomEvent('open-lyrics'));

// where the song is right now (smooth, between Spotify updates)
const posNow = () => {
  const n = getNow();
  if (!n.track) return 0;
  return Math.min(n.track.durationMs || Infinity, n.progressMs + (n.playing ? Date.now() - n.fetchedAt : 0));
};

// last line whose time has come
export function lineAt(lines, ms) {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= ms) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

// a colour from the cover art, darkened, for the background (like Spotify)
function useCoverColor(url) {
  const [c, setC] = useState(null);
  useEffect(() => {
    setC(null);
    if (!url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 24;
        const g = cv.getContext('2d');
        g.drawImage(img, 0, 0, 24, 24);
        const d = g.getImageData(0, 0, 24, 24).data;
        let r = 0;
        let gg = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]);
          const mn = Math.min(d[i], d[i + 1], d[i + 2]);
          if (mx - mn < 25 || mx < 40) continue; // skip greys / near-black: we want the colour
          r += d[i];
          gg += d[i + 1];
          b += d[i + 2];
          n++;
        }
        if (!n) return setC('rgb(83, 83, 83)');
        const k = 0.62; // darker, so white text reads well
        setC(`rgb(${Math.round((r / n) * k)}, ${Math.round((gg / n) * k)}, ${Math.round((b / n) * k)})`);
      } catch {
        /* cover can't be read: keep the default */
      }
    };
    img.src = url;
  }, [url]);
  return c;
}

export default function LyricsView({ onClose }) {
  const now = useNow();
  const tr = now.track;
  const [data, setData] = useState(null);
  const [idx, setIdx] = useState(-1);
  const [offset, setOffset] = useState(0); // your fine-tune, ms
  const box = useRef(null);
  const userScroll = useRef(0);
  const bg = useCoverColor(tr?.cover);
  const canSeek = isLoggedIn();

  // fetch lyrics when the song changes
  useEffect(() => {
    if (!tr?.name) return setData(null);
    let alive = true;
    setData({ loading: true });
    setIdx(-1);
    setOffset(0);
    const qs = new URLSearchParams({ title: tr.name, artist: tr.artists.map((a) => a.name).join(', '), durationMs: String(tr.durationMs || '') });
    if (tr.album) qs.set('album', tr.album);
    fetch(`/api/lyrics?${qs}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Lyrics failed (${r.status})`);
        return j;
      })
      .then((j) => alive && setData(j))
      .catch((e) => alive && setData({ error: e.message }));
    return () => {
      alive = false;
    };
  }, [tr?.id, tr?.name]);

  const lines = data?.synced;
  // follow the song, ~6 times a second
  useEffect(() => {
    if (!lines?.length) return;
    const tick = () => setIdx(lineAt(lines, posNow() + offset + 150));
    tick();
    const iv = setInterval(tick, 160);
    return () => clearInterval(iv);
  }, [lines, offset]);

  // keep the current line in the middle (unless you just scrolled yourself)
  useEffect(() => {
    if (idx < 0 || Date.now() - userScroll.current < 3500) return;
    const el = box.current?.querySelector(`[data-i="${idx}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [idx]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const plainLines = useMemo(() => (data?.plain ? data.plain.split(/\r?\n/) : null), [data]);

  return (
    <div className="ly-wrap" onClick={onClose}>
      <aside className="ly-panel" style={bg ? { '--ly-bg': bg } : undefined} onClick={(e) => e.stopPropagation()}>
        <header className="ly-head">
          {tr?.cover && <img src={tr.cover} alt="" />}
          <div className="ly-meta">
            <small>Lyrics</small>
            <b>{tr?.name || 'Nothing playing'}</b>
            {tr && (
              <span className="tr-artist">
                <ArtistLink name={tr.artists.map((a) => a.name).join(', ')} />
              </span>
            )}
          </div>
          {lines && (
            <div className="ly-sync" title="If the words run early or late, nudge them">
              <button onClick={() => setOffset((o) => o - 500)} aria-label="Lyrics earlier">
                −
              </button>
              <span>{offset ? `${offset > 0 ? '+' : ''}${(offset / 1000).toFixed(1)}s` : 'sync'}</span>
              <button onClick={() => setOffset((o) => o + 500)} aria-label="Lyrics later">
                +
              </button>
            </div>
          )}
          <button className="ly-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="ly-body" ref={box} onWheel={() => (userScroll.current = Date.now())} onTouchMove={() => (userScroll.current = Date.now())}>
          {!tr && <p className="ly-msg">Play a song on Spotify and its lyrics show up here, in time with the music.</p>}
          {tr && data?.loading && <p className="ly-msg">Finding lyrics…</p>}
          {tr && data?.error && <p className="ly-msg">{data.error}</p>}
          {tr && data && !data.loading && !data.error && !data.found && <p className="ly-msg">No lyrics found for this song yet.</p>}
          {tr && data?.instrumental && <p className="ly-msg">♪ Instrumental ♪</p>}

          {lines?.map((l, i) => (
            <p
              key={i}
              data-i={i}
              className={`ly-line ${i === idx ? 'on' : i < idx ? 'past' : ''} ${canSeek ? 'seek' : ''}`}
              onClick={() => canSeek && Promise.resolve(seekHere(Math.max(0, l.t - offset))).catch(() => {})}
            >
              {l.text || '♪'}
            </p>
          ))}

          {plainLines && (
            <>
              <p className="ly-note">These lyrics aren't synced to the song yet.</p>
              {plainLines.map((l, i) => (
                <p key={i} className="ly-line plain">
                  {l || ' '}
                </p>
              ))}
            </>
          )}
          {data?.found && <p className="ly-src">Lyrics from {data.source} (lrclib.net), a free community library.</p>}
        </div>
      </aside>
    </div>
  );
}
