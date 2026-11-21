// "Who's listening to this song?" — the best free signals:
//  1. Apple Music city charts: in which big cities is this song in the Top 25 right now?
//  2. ListenBrainz (open source): how many plays and listeners it has tracked
//     (song IDs come from MusicBrainz, also open source)

import { getCityChart, strip } from './api.mjs';
import { fetchT as fetch } from './http.mjs';

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
  if (v != null) cache.set(key, { t: Date.now(), v }); // a miss is retried next time
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

// MusicBrainz allows ~1 request per second, so calls are queued (and retried when busy)
export function mbFetch(url, { tries = 3 } = {}) {
  const run = mbQueue.then(async () => {
    for (let attempt = 0; attempt < tries; attempt++) {
      const r = await fetch(url, { headers: MB_HEADERS });
      await new Promise((res) => setTimeout(res, 1100 * (attempt + 1)));
      if (r.ok) return r.json();
      if (r.status !== 503 && r.status !== 429) throw new Error(`MusicBrainz ${r.status}`);
    }
    throw new Error('MusicBrainz is busy right now');
  });
  mbQueue = run.catch(() => {});
  return run;
}

// Fast exact match from ListenBrainz's hosted copy of MusicBrainz (no rate limit issues)
export async function acrLookupFull(title, artist) {
  return cached(`acr|${strip(title)}|${strip(artist)}`, 24 * 3600 * 1000, async () => {
    const t = title.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim();
    const r = await fetch(
      `https://labs.api.listenbrainz.org/acr-lookup/json?artist_credit_name=${encodeURIComponent(artist)}&recording_name=${encodeURIComponent(t)}`
    );
    if (!r.ok) return null;
    const j = await r.json();
    const hit = Array.isArray(j) ? j[0] : null;
    return hit?.recording_mbid ? { recordingMbid: hit.recording_mbid, artistMbids: hit.artist_mbids || [] } : null;
  });
}

async function acrLookup(title, artist) {
  return (await acrLookupFull(title, artist).catch(() => null))?.recordingMbid || null;
}

// An artist's MusicBrainz ID by name (cached for a week)
export async function artistMbid(name) {
  return cached(`artist-mbid|${strip(name)}`, 7 * 24 * 3600 * 1000, async () => {
    const mb = await mbFetch(
      `https://musicbrainz.org/ws/2/artist?fmt=json&limit=5&query=${encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`)}`,
      { tries: 2 }
    );
    const exact = (mb.artists || []).find((a) => a.score >= 90 && strip(a.name) === strip(name));
    return exact?.id || (mb.artists || []).find((a) => a.score === 100)?.id || null;
  });
}

// MusicBrainz IDs for a song. quick = the single best match is enough.
export async function findRecordingIds(title, artist, { quick = false } = {}) {
  return cached(`mbid|${quick}|${strip(title)}|${strip(artist)}`, 24 * 3600 * 1000, async () => {
    const ids = [];
    const exact = await acrLookup(title, artist).catch(() => null);
    if (exact) ids.push(exact);
    if (quick && ids.length) return ids;
    // several versions of a song can exist; search for the rest
    try {
      const t = title.replace(/\s*[([].*?[)\]]/g, '').replace(/"/g, '').trim();
      const q = `recording:"${t}" AND artist:"${artist.replace(/"/g, '')}"`;
      const mb = await mbFetch(`https://musicbrainz.org/ws/2/recording?fmt=json&limit=50&query=${encodeURIComponent(q)}`, {
        tries: quick ? 1 : 3,
      });
      for (const r of mb.recordings || []) if (r.score >= 90 && !ids.includes(r.id)) ids.push(r.id);
    } catch (e) {
      if (!ids.length) throw e;
    }
    return ids;
  });
}

export async function songListens(title, artist) {
  return cached(`lb|${strip(title)}|${strip(artist)}`, 3600 * 1000, async () => {
    const ids = await findRecordingIds(title, artist);
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
