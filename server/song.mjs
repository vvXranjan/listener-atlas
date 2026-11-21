// "Who's listening to this song?" — the best free signals:
//  1. Apple Music city charts: in which big cities is this song in the Top 25 right now?
//  2. ListenBrainz (open source): how many plays and listeners it has tracked
//     (song IDs come from MusicBrainz, also open source)

import { getCityChart, strip } from './api.mjs';

// Cities to scan (each has an Apple Music "Top 25" city chart)
const SCAN = [
  ['New York City', 'US'], ['Los Angeles', 'US'], ['Chicago', 'US'], ['Houston', 'US'], ['Atlanta', 'US'],
  ['Dallas', 'US'], ['Miami', 'US'], ['Toronto', 'CA'], ['London', 'GB'], ['Manchester', 'GB'],
  ['Paris', 'FR'], ['Berlin', 'DE'], ['Mumbai', 'IN'], ['Sydney', 'AU'], ['Melbourne', 'AU'],
  ['Tokyo', 'JP'], ['Mexico City', 'MX'], ['São Paulo', 'BR'], ['Lagos', 'NG'], ['Johannesburg', 'ZA'],
];

const cache = new Map();
const cached = async (key, ttl, fn) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
};

// "Spaceship (feat. Shake Wells & Don Toliver) - Remix" -> "spaceship"
export const cleanTitle = (t) =>
  strip(t)
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();

// run fn over items, n at a time; stop waiting after budgetMs and return what's done
async function pool(items, n, fn, budgetMs = Infinity) {
  const out = new Array(items.length).fill(undefined);
  let i = 0;
  const work = Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]).catch(() => null);
      }
    })
  );
  let timedOut = false;
  if (Number.isFinite(budgetMs)) {
    await Promise.race([work, new Promise((r) => setTimeout(() => ((timedOut = true), r()), budgetMs))]);
  } else await work;
  return { out, done: out.filter((x) => x !== undefined).length, timedOut };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export async function songCharts(title, artists, budgetMs = Infinity) {
  const t = cleanTitle(title);
  const names = artists.map((a) => strip(a));
  const { out: results, done } = await pool(SCAN, 6, async ([city, cc]) => {
    const data = await withTimeout(getCityChart(city, cc), 15000);
    if (data.scope !== 'city') return null;
    const hit = data.chart.tracks.find(
      (tr) => cleanTitle(tr.title) === t && names.some((n) => strip(tr.artist).includes(n))
    );
    return hit ? { city: data.city, country: data.country, position: data.position, rank: hit.rank } : null;
  }, budgetMs);
  return {
    scanned: done,
    charts: results.filter(Boolean).sort((a, b) => a.rank - b.rank),
  };
}

// ---------- ListenBrainz popularity ----------
let mbQueue = Promise.resolve();
const MB_HEADERS = { 'User-Agent': 'ListenerAtlas/1.0 (personal project)', Accept: 'application/json' };

// MusicBrainz allows ~1 request per second, so calls are queued
function mbFetch(url) {
  const run = mbQueue.then(async () => {
    const r = await fetch(url, { headers: MB_HEADERS });
    await new Promise((res) => setTimeout(res, 1100));
    if (!r.ok) throw new Error(`MusicBrainz ${r.status}`);
    return r.json();
  });
  mbQueue = run.catch(() => {});
  return run;
}

export async function songListens(title, artist) {
  return cached(`lb|${strip(title)}|${strip(artist)}`, 3600 * 1000, async () => {
    const t = title.replace(/\s*[([].*?[)\]]/g, '').replace(/"/g, '').trim();
    const q = `recording:"${t}" AND artist:"${artist.replace(/"/g, '')}"`;
    const mb = await mbFetch(`https://musicbrainz.org/ws/2/recording?fmt=json&limit=50&query=${encodeURIComponent(q)}`);
    const ids = (mb.recordings || []).filter((r) => r.score >= 90).map((r) => r.id);
    if (!ids.length) return { listens: 0, listeners: 0, recordings: 0 };
    const r = await fetch('https://api.listenbrainz.org/1/popularity/recording', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recording_mbids: ids }),
    });
    if (!r.ok) throw new Error(`ListenBrainz ${r.status}`);
    const rows = await r.json();
    return {
      listens: rows.reduce((a, x) => a + (x.total_listen_count || 0), 0),
      // the same person can appear on several versions of a song, so take the biggest
      listeners: rows.reduce((a, x) => Math.max(a, x.total_user_count || 0), 0),
      recordings: ids.length,
    };
  });
}

export async function songInsights(title, artists, { budgetMs = 8000 } = {}) {
  const key = `song|${strip(title)}|${artists.map(strip).join(',')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.v;
  const [charts, listens] = await Promise.all([
    songCharts(title, artists, budgetMs).catch(() => null),
    Promise.race([
      songListens(title, artists[0]),
      new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), budgetMs)),
    ]).catch(() => null),
  ]);
  const v = { title, artists, charts, listens, complete: charts?.scanned === SCAN.length, fetchedAt: new Date().toISOString() };
  // only remember complete answers; a partial one (slow servers) is retried next time
  if (v.complete && listens) cache.set(key, { t: Date.now(), v });
  return v;
}
