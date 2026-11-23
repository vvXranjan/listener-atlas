// Search songs / artists / albums, an artist's albums, and an album's tracks.
// Apple's open iTunes catalogue: covers, 30 s previews, dates, track lists.
import { fetchT as fetch } from './http.mjs';
import { strip } from './api.mjs';

const IT = 'https://itunes.apple.com';
const cache = new Map();
const cached = async (key, ttlMs, fn) => {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.until) return hit.v;
  const v = await fn();
  cache.set(key, { v, until: Date.now() + ttlMs });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return v;
};

async function it(path) {
  const r = await fetch(`${IT}${path}${path.includes('?') ? '&' : '?'}country=us`);
  if (!r.ok) throw new Error(`Apple Music search failed (${r.status})`);
  return (await r.json()).results || [];
}

const art = (u, size = 300) => (u ? u.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`) : null);

// "Album", "EP" or "Single"
export function albumKind(a) {
  const name = a.collectionName || '';
  if (/\s-\s*single$/i.test(name) || a.trackCount <= 2) return 'Single';
  if (/\s-\s*ep$/i.test(name) || a.trackCount <= 6) return 'EP';
  return 'Album';
}
const cleanAlbum = (n) => String(n || '').replace(/\s-\s*(single|ep)$/i, '').trim();

const mapAlbum = (a) => ({
  id: String(a.collectionId),
  title: cleanAlbum(a.collectionName),
  artist: a.artistName,
  cover: art(a.artworkUrl100, 400),
  year: a.releaseDate?.slice(0, 4) || null,
  date: a.releaseDate?.slice(0, 10) || null,
  tracks: a.trackCount || 0,
  kind: albumKind(a),
  explicit: a.collectionExplicitness === 'explicit',
  genre: a.primaryGenreName || null,
  appleUrl: a.collectionViewUrl || null,
});
const mapSong = (t) => ({
  title: t.trackName,
  artist: t.artistName,
  album: cleanAlbum(t.collectionName),
  albumId: t.collectionId ? String(t.collectionId) : null,
  cover: art(t.artworkUrl100, 300),
  preview: t.previewUrl || null,
  durationMs: t.trackTimeMillis || null,
  year: t.releaseDate?.slice(0, 4) || null,
  genre: t.primaryGenreName || null,
  trackNumber: t.trackNumber || null,
  disc: t.discNumber || 1,
  explicit: t.trackExplicitness === 'explicit',
  appleUrl: t.trackViewUrl || null,
});

// Same album often appears twice (clean + explicit, deluxe re-issues): keep one
function dedupeAlbums(list) {
  const seen = new Map();
  for (const a of list) {
    const k = `${strip(a.title)}|${a.kind}`;
    const prev = seen.get(k);
    if (!prev || (a.explicit && !prev.explicit) || (a.explicit === prev.explicit && a.tracks > prev.tracks)) seen.set(k, a);
  }
  return [...seen.values()];
}

// Deezer ranks search results by popularity (Apple's search often puts covers first)
async function deezer(path) {
  const r = await fetch(`https://api.deezer.com${path}`);
  if (!r.ok) throw new Error(`deezer ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error('deezer error');
  return j.data || [];
}
const mapDeezer = (t) => ({
  title: t.title,
  artist: t.artist?.name,
  album: t.album?.title || null,
  cover: t.album?.cover_medium || null,
  preview: t.preview || null,
  durationMs: t.duration ? t.duration * 1000 : null,
  explicit: !!t.explicit_lyrics,
  rank: t.rank || 0,
});

// versions people rarely mean unless they type it
const VARIANT = /\b(slowed|reverb|sped ?up|nightcore|karaoke|instrumental|cover|tik ?tok|8d|lofi|remix|acoustic|live)\b/i;
export function rankSongs(list, term) {
  const q = strip(term).replace(/[^a-z0-9]/g, '');
  const wantVariant = VARIANT.test(term);
  const score = (s, i) => {
    let v = -i; // keep the source order as the base
    const t = strip(s.title).replace(/[^a-z0-9]/g, '');
    if (t === q) v += 20;
    else if (t.startsWith(q)) v += 8;
    if (!wantVariant && VARIANT.test(`${s.title} ${s.album || ''}`)) v -= 40;
    v += Math.min(15, (s.rank || 0) / 60000); // Deezer popularity
    return v;
  };
  return list.map((s, i) => [score(s, i), s]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

// Search box: songs, artists and albums at once
export async function searchMusic(term) {
  const q = encodeURIComponent(term.trim());
  return cached(`q|${term.trim().toLowerCase()}`, 3600e3, async () => {
    const [songs, albums, artists, dz] = await Promise.all([
      it(`/search?term=${q}&entity=song&limit=20`).catch(() => []),
      it(`/search?term=${q}&entity=album&limit=10`).catch(() => []),
      it(`/search?term=${q}&entity=musicArtist&limit=6`).catch(() => []),
      deezer(`/search?q=${q}&limit=20`).catch(() => []),
    ]);
    const seenSong = new Set();
    const s = [];
    // popular versions first (Deezer), with Apple's preview/album when both have the song
    const apple = new Map(songs.map(mapSong).filter((t) => t.title && t.artist).map((t) => [`${strip(t.title)}|${strip(t.artist)}`, t]));
    for (const d of dz.map(mapDeezer)) {
      if (!d.title || !d.artist) continue;
      const k = `${strip(d.title)}|${strip(d.artist)}`;
      if (seenSong.has(k)) continue;
      seenSong.add(k);
      const a = apple.get(k);
      s.push(a ? { ...a, rank: d.rank } : d);
    }
    for (const t of songs.map(mapSong)) {
      if (!t.title || !t.artist) continue;
      const k = `${strip(t.title)}|${strip(t.artist)}`;
      if (seenSong.has(k)) continue;
      seenSong.add(k);
      s.push(t);
    }
    return {
      songs: rankSongs(s, term).slice(0, 12),
      albums: dedupeAlbums(albums.map(mapAlbum)).slice(0, 8),
      artists: artists.map((a) => ({ name: a.artistName, genre: a.primaryGenreName || null })).filter((a) => a.name).slice(0, 6),
    };
  });
}

// All albums / EPs / singles of an artist, newest first
export async function artistAlbums(name) {
  const key = strip(name);
  return cached(`a|${key}`, 6 * 3600e3, async () => {
    const found = await it(`/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5`);
    const artist = found.find((a) => strip(a.artistName || '') === key) || found[0];
    if (!artist) return { artist: name, albums: [] };
    const rows = await it(`/lookup?id=${artist.artistId}&entity=album&limit=200`);
    const albums = dedupeAlbums(rows.filter((r) => r.wrapperType === 'collection').map(mapAlbum)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { artist: artist.artistName, genre: artist.primaryGenreName || null, albums };
  });
}

// One album with its tracks
export async function albumTracks(id) {
  if (!/^\d{1,15}$/.test(String(id))) throw new Error('bad album id');
  return cached(`t|${id}`, 6 * 3600e3, async () => {
    const rows = await it(`/lookup?id=${id}&entity=song&limit=200`);
    const head = rows.find((r) => r.wrapperType === 'collection');
    if (!head) throw new Error('Album not found');
    const tracks = rows
      .filter((r) => r.wrapperType === 'track' && r.kind === 'song')
      .map(mapSong)
      .sort((a, b) => a.disc - b.disc || a.trackNumber - b.trackNumber);
    return { album: mapAlbum(head), tracks };
  });
}
