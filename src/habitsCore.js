// Your listening habits: which song you play after which.
// Pure functions, shared by the browser (local fallback) and the server (cloud copy).

const SESSION_GAP_MS = 30 * 60 * 1000; // a gap longer than this starts a new listening session
const HALF_LIFE_DAYS = 60; // a habit from 2 months ago counts half
const MAX_PAIRS = 1500;
const MAX_SONGS = 1500;

// same song even if the artists are written differently or with "(feat. …)"
export const songKey = (s) =>
  `${String(s?.title || '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .trim()}|${String(s?.artist || '')
    .toLowerCase()
    .split(/,|&| with | feat\.? | x /)[0]
    .trim()}`;

const slim = (s) => ({ title: String(s.title || '').slice(0, 200), artist: String(s.artist || '').slice(0, 200), uri: s.uri || null });

export const emptyDoc = () => ({ v: 1, pairs: {}, songs: {}, cursor: 0, last: null, updatedAt: 0 });

const decay = (ageMs) => Math.pow(0.5, Math.max(0, ageMs) / (HALF_LIFE_DAYS * 86400000));
export const pairScore = (p, now = Date.now()) => (p ? p.n * decay(now - p.last) : 0);

function prune(obj, max, now) {
  const keys = Object.keys(obj);
  if (keys.length <= max) return obj;
  const keep = keys.sort((a, b) => pairScore(obj[b], now) - pairScore(obj[a], now)).slice(0, max);
  return Object.fromEntries(keep.map((k) => [k, obj[k]]));
}

// Add newly played songs. `plays` = [{ title, artist, uri, playedAt (ms) }] in any order.
// Only plays newer than what we've already seen count, so syncing twice is harmless.
export function mergePlays(doc, plays, now = Date.now()) {
  const d = doc && doc.v === 1 ? { ...doc, pairs: { ...doc.pairs }, songs: { ...doc.songs } } : emptyDoc();
  const fresh = (plays || [])
    .filter((p) => p && p.title && Number.isFinite(p.playedAt) && p.playedAt > d.cursor && p.playedAt <= now + 60000)
    .sort((a, b) => a.playedAt - b.playedAt);
  let prev = d.last;
  for (const p of fresh) {
    const k = songKey(p);
    const s = d.songs[k] || { ...slim(p), n: 0, last: 0 };
    d.songs[k] = { ...s, uri: s.uri || p.uri || null, n: s.n + 1, last: p.playedAt };
    if (prev && prev.key !== k && p.playedAt - prev.at < SESSION_GAP_MS) {
      const pk = `${prev.key}>${k}`;
      const old = d.pairs[pk] || { a: prev.song, b: slim(p), n: 0, last: 0 };
      d.pairs[pk] = { ...old, n: old.n + 1, last: p.playedAt };
    }
    prev = { key: k, at: p.playedAt, song: slim(p) };
  }
  if (fresh.length) {
    d.cursor = fresh[fresh.length - 1].playedAt;
    d.last = prev;
    d.updatedAt = now;
  }
  d.pairs = prune(d.pairs, MAX_PAIRS, now);
  d.songs = prune(d.songs, MAX_SONGS, now);
  return d;
}

// 0..1: how strongly you go from song A to song B (1 play ≈ 0.4, 3 ≈ 0.8, 6+ ≈ 0.95)
export function habitStrength(doc, from, to, now = Date.now()) {
  if (!doc || !from || !to) return 0;
  return 1 - Math.exp(-pairScore(doc.pairs?.[`${songKey(from)}>${songKey(to)}`], now) / 2);
}

export function habitCount(doc, from, to) {
  return doc?.pairs?.[`${songKey(from)}>${songKey(to)}`]?.n || 0;
}

// Songs you usually play after this one, strongest first
export function habitsAfter(doc, song, now = Date.now(), limit = 8) {
  if (!doc || !song) return [];
  const prefix = `${songKey(song)}>`;
  return Object.entries(doc.pairs || {})
    .filter(([k]) => k.startsWith(prefix))
    .map(([, p]) => ({ ...p.b, n: p.n, last: p.last, strength: 1 - Math.exp(-pairScore(p, now) / 2) }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, limit);
}

// Did you play this song in the last `ms`? (radio mode avoids repeats)
export function playedWithin(doc, song, ms, now = Date.now()) {
  const s = doc?.songs?.[songKey(song)];
  return !!s && now - s.last < ms;
}

export function topPairs(doc, limit = 20, now = Date.now()) {
  return Object.values(doc?.pairs || {})
    .map((p) => ({ ...p, score: pairScore(p, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function topSongs(doc, limit = 20, now = Date.now()) {
  return Object.values(doc?.songs || {})
    .map((s) => ({ ...s, score: pairScore(s, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function topArtists(doc, limit = 10, now = Date.now()) {
  const by = new Map();
  for (const s of Object.values(doc?.songs || {})) {
    const name = String(s.artist || '').split(/,|&| with | feat\.? /i)[0].trim();
    if (!name) continue;
    const cur = by.get(name) || { name, n: 0, score: 0 };
    cur.n += s.n;
    cur.score += pairScore(s, now);
    by.set(name, cur);
  }
  return [...by.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
