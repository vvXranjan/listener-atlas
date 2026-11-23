// Time-synced lyrics from LRCLIB (lrclib.net): a free, open, community lyrics library.
// We only pass them through to the app for the song you're playing; nothing is stored.
import { fetchT as fetch } from './http.mjs';

const LR = 'https://lrclib.net/api';
const UA = { 'Lrclib-Client': 'Listener Atlas (https://github.com/vvXranjan/listener-atlas)' };
const cache = new Map();

// "[01:02.34] words" -> [{ t: 62340, text: 'words' }]
export function parseLrc(lrc) {
  const out = [];
  for (const line of String(lrc || '').split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0;
      out.push({ t: Number(m[1]) * 60000 + Number(m[2]) * 1000 + frac, text });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/[^a-z0-9]/g, '');

// pick the best match: same title, same artist, closest length, synced first
export function pickBest(list, { title, artist, durationSec }) {
  const t = norm(title);
  const a = norm(String(artist).split(/,|&| feat/i)[0]);
  const score = (r) => {
    let s = 0;
    if (norm(r.trackName) === t) s += 10;
    else if (norm(r.trackName).includes(t) || t.includes(norm(r.trackName))) s += 4;
    if (norm(r.artistName).includes(a)) s += 6;
    if (durationSec && r.duration) s -= Math.min(10, Math.abs(r.duration - durationSec) / 2);
    if (r.syncedLyrics) s += 3;
    if (r.instrumental) s -= 2;
    return s;
  };
  const best = [...(list || [])].sort((x, y) => score(y) - score(x))[0];
  // title and artist must both match, or it's someone else's song
  if (!best) return null;
  const titleOk = norm(best.trackName) === t || norm(best.trackName).includes(t) || t.includes(norm(best.trackName));
  return titleOk && norm(best.artistName).includes(a) ? best : null;
}

function shape(r) {
  if (!r) return { found: false };
  const synced = parseLrc(r.syncedLyrics);
  return {
    found: true,
    instrumental: !!r.instrumental,
    synced: synced.length ? synced : null,
    plain: synced.length ? null : r.plainLyrics || null,
    track: r.trackName,
    artist: r.artistName,
    source: 'LRCLIB',
  };
}

export async function getLyrics({ title, artist, album, durationMs }) {
  if (!title || !artist) throw new Error('title and artist are required');
  const durationSec = durationMs ? Math.round(Number(durationMs) / 1000) : null;
  const key = `${norm(title)}|${norm(artist)}|${durationSec || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.until) return hit.v;

  const main = String(artist).split(/,|&| feat/i)[0].trim();
  let best = null;
  // exact lookup first (fast, uses the song length)
  if (durationSec) {
    const qs = new URLSearchParams({ track_name: title, artist_name: main, duration: String(durationSec) });
    if (album) qs.set('album_name', album);
    const r = await fetch(`${LR}/get?${qs}`, { headers: UA }).catch(() => null);
    if (r?.ok) best = await r.json().catch(() => null);
  }
  // otherwise search and pick the closest
  if (!best?.syncedLyrics) {
    const qs = new URLSearchParams({ track_name: title.replace(/\s*[([].*?[)\]]/g, '').trim(), artist_name: main });
    const r = await fetch(`${LR}/search?${qs}`, { headers: UA }).catch(() => null);
    const list = r?.ok ? await r.json().catch(() => []) : [];
    const found = pickBest(list, { title, artist, durationSec });
    if (found && (!best || (found.syncedLyrics && !best.syncedLyrics))) best = found;
  }
  const v = shape(best);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(key, { v, until: Date.now() + (v.found ? 24 * 3600e3 : 10 * 60e3) });
  return v;
}
