// Genre page: the most played songs and the biggest artists for a genre tag
// (e.g. "southern hip hop"). Open data: ListenBrainz tag radio + popularity + metadata.
import { cleanTitle } from './song.mjs';
import { strip } from './api.mjs';
import { fetchT as fetch } from './http.mjs';

const LB = 'https://api.listenbrainz.org/1';
const cache = new Map();

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

const caa = (rel) =>
  rel?.caa_release_mbid && rel?.caa_id ? `https://coverartarchive.org/release/${rel.caa_release_mbid}/${rel.caa_id}-250.jpg` : null;

// listens per recording (falls back to nothing if the service is busy)
async function listenCounts(mbids) {
  const out = {};
  for (let i = 0; i < mbids.length; i += 100) {
    const part = mbids.slice(i, i + 100);
    const j = await getJson(`${LB}/popularity/recording`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recording_mbids: part }),
    }).catch(() => []);
    for (const r of Array.isArray(j) ? j : []) if (r?.recording_mbid) out[r.recording_mbid] = r;
  }
  return out;
}

async function metadata(mbids) {
  const out = {};
  const parts = [];
  for (let i = 0; i < mbids.length; i += 25) parts.push(mbids.slice(i, i + 25));
  const res = await Promise.all(
    parts.map((p) => getJson(`${LB}/metadata/recording/?recording_mbids=${p.join(',')}&inc=artist%20release`).catch(() => ({})))
  );
  for (const j of res) Object.assign(out, j && typeof j === 'object' ? j : {});
  return out;
}

export function normalizeTag(tag) {
  return String(tag || '')
    .toLowerCase()
    .replace(/[^a-z0-9&'\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

export async function genrePage(tagIn) {
  const tag = normalizeTag(tagIn);
  if (!tag) throw new Error('genre is required');
  const hit = cache.get(tag);
  if (hit && Date.now() < hit.until) return hit.v;
  const v = await build(tag);
  cache.set(tag, { v, until: Date.now() + (v.songs.length >= 10 ? 6 * 3600 : 120) * 1000 });
  return v;
}

async function build(tag) {
  const q = encodeURIComponent(tag);
  // popular songs first; widen the range if the genre is small
  let radio = await getJson(`${LB}/lb-radio/tags?tag=${q}&operator=and&pop_begin=60&pop_end=100&count=150`).catch(() => []);
  if (!Array.isArray(radio) || radio.length < 25) {
    const more = await getJson(`${LB}/lb-radio/tags?tag=${q}&operator=and&pop_begin=20&pop_end=100&count=150`).catch(() => []);
    radio = [...(Array.isArray(radio) ? radio : []), ...(Array.isArray(more) ? more : [])];
  }
  const pct = {};
  for (const r of radio) if (r?.recording_mbid) pct[r.recording_mbid] = Math.max(pct[r.recording_mbid] || 0, r.percent || 0);
  const ids = Object.keys(pct).slice(0, 200);

  const counts = await listenCounts(ids);
  const ranked = ids
    .map((id) => ({ id, plays: counts[id]?.total_listen_count || 0, listeners: counts[id]?.total_user_count || 0, pct: pct[id] }))
    .sort((a, b) => b.plays - a.plays || b.pct - a.pct)
    .slice(0, 70);
  const meta = await metadata(ranked.map((r) => r.id));

  const songs = [];
  const seen = new Set();
  for (const r of ranked) {
    const m = meta[r.id];
    const title = m?.recording?.name;
    const artist = m?.artist?.name || (m?.artist?.artists || []).map((a) => a.name + (a.join_phrase || '')).join('');
    if (!title || !artist) continue;
    const key = `${cleanTitle(title)}|${strip(artist)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const main = m.artist?.artists?.[0];
    songs.push({
      title,
      artist,
      mainArtist: main?.name || artist,
      artistMbid: main?.artist_mbid || null,
      cover: caa(m.release),
      year: m.release?.year || null,
      plays: r.plays,
      listeners: r.listeners,
      mbid: r.id,
    });
  }

  // the biggest artists in this genre, by listens across these songs
  const byArtist = new Map();
  for (const s of songs) {
    const k = strip(s.mainArtist);
    const a = byArtist.get(k) || { name: s.mainArtist, mbid: s.artistMbid, plays: 0, songs: 0, topSong: s.title, cover: s.cover };
    a.plays += s.plays;
    a.songs += 1;
    byArtist.set(k, a);
  }
  const artists = [...byArtist.values()].sort((a, b) => b.plays - a.plays || b.songs - a.songs).slice(0, 18);

  return {
    tag,
    songs: songs.slice(0, 40),
    artists,
    source: 'ListenBrainz tags + listens (open data)',
    fetchedAt: new Date().toISOString(),
  };
}
