import { useEffect, useState } from 'react';
import { getNow } from './nowStore.js';

// Shared by the lyrics panel and the full-screen "ambient" lyrics.

// where the song is right now (smooth, between Spotify updates)
export const posNow = () => {
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
export function useCoverColor(url) {
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


// Lyrics for a track ({ name, artists, durationMs, album })
export function useLyrics(tr) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!tr?.name) return setData(null);
    let alive = true;
    setData({ loading: true });
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

  return data;
}
