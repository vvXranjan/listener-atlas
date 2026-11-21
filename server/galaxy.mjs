// Artist Galaxy data: an artist's top songs (with previews), similar artists
// and everyone's genres. All open data: ListenBrainz + MusicBrainz + iTunes.
import { artistMbid, acrLookupFull, cleanTitle } from './song.mjs';
import { getArtistInfo, strip } from './api.mjs';
import { fetchT as fetch } from './http.mjs';

const ARTIST_ALGO = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

const caa = (rec) =>
  rec.caa_release_mbid && rec.caa_id ? `https://coverartarchive.org/release/${rec.caa_release_mbid}/${rec.caa_id}-250.jpg` : null;

// tags that are not genres
const NOT_GENRE = /^(\d{4}s|english|american|usa|us|seen live|rapper|male vocalists?|favorites?|atlanta|georgia|canadian)$/i;

// Genres for many artists in one call, strongest first
export async function artistGenres(mbids) {
  if (!mbids.length) return {};
  const j = await getJson(`https://api.listenbrainz.org/1/metadata/artist/?artist_mbids=${mbids.join(',')}&inc=tag`);
  const out = {};
  for (const a of Array.isArray(j) ? j : []) {
    const tags = (a.tag?.artist || []).filter((t) => t.tag && !NOT_GENRE.test(t.tag.trim()));
    // real genres (they have a genre id) count a bit more than free tags
    tags.sort((x, y) => y.count + (y.genre_mbid ? 0.5 : 0) - (x.count + (x.genre_mbid ? 0.5 : 0)));
    out[a.artist_mbid || a.mbid] = [...new Set(tags.map((t) => t.tag.toLowerCase()))].slice(0, 5);
  }
  return out;
}

// Pick a few genre "sectors" for the galaxy: the main artist's genres first,
// then the ones most similar artists share.
export function pickSectors(mainGenres, artists, max = 6) {
  const counts = new Map();
  for (const a of artists) for (const g of a.genres.slice(0, 3)) counts.set(g, (counts.get(g) || 0) + 1);
  const order = [...new Set([...mainGenres.slice(0, 3), ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g)])];
  const sectors = order.slice(0, max);
  for (const a of artists) a.sector = a.genres.find((g) => sectors.includes(g)) || 'other';
  if (artists.some((a) => a.sector === 'other')) sectors.push('other');
  return sectors;
}

export async function itunesArtistSongs(name) {
  const j = await getJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=song&attribute=artistTerm&limit=200`
  ).catch(() => ({ results: [] }));
  const key = strip(name);
  const map = new Map();
  for (const t of j.results || []) {
    if (!strip(t.artistName || '').includes(key)) continue;
    const k = cleanTitle(t.trackName);
    if (!map.has(k) && t.previewUrl) map.set(k, t);
  }
  return map;
}

const galaxyCache = new Map();

// Who is this artist in the open databases? MusicBrainz search first; if it's busy,
// ask ListenBrainz using one of their songs.
async function findArtistId(name, itunes) {
  const viaMb = await artistMbid(name).catch(() => null);
  if (viaMb) return viaMb;
  for (const t of [...itunes.values()].slice(0, 3)) {
    const hit = await acrLookupFull(t.trackName, name).catch(() => null);
    if (hit?.artistMbids?.[0]) return hit.artistMbids[0];
  }
  return null;
}

export async function artistGalaxy(name) {
  const key = strip(name);
  const hit = galaxyCache.get(key);
  if (hit && Date.now() < hit.until) return hit.v;
  const v = await buildGalaxy(name);
  // a full answer is kept for 6 hours; a partial one only for 2 minutes
  const full = v.artist.mbid && v.artists.length > 0;
  galaxyCache.set(key, { v, until: Date.now() + (full ? 6 * 3600 : 120) * 1000 });
  return v;
}

async function buildGalaxy(name) {
    const itunes = await itunesArtistSongs(name);
    const mbid = await findArtistId(name, itunes);
    const [tops, sims, info] = await Promise.all([
      mbid ? getJson(`https://api.listenbrainz.org/1/popularity/top-recordings-for-artist/${mbid}`).catch(() => []) : [],
      mbid
        ? getJson(`https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=${mbid}&algorithm=${ARTIST_ALGO}`).catch(() => [])
        : [],
      getArtistInfo(name).catch(() => null),
    ]);

    // ---- songs: most played first, with a 30s preview when iTunes has one
    const songs = [];
    const seen = new Set();
    for (const rec of Array.isArray(tops) ? tops : []) {
      const k = cleanTitle(rec.recording_name || '');
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const it = itunes.get(k);
      songs.push({
        title: it?.trackName || rec.recording_name,
        artist: rec.artist_name || name,
        album: it?.collectionName || rec.release_name || null,
        cover: it?.artworkUrl100?.replace('100x100bb', '300x300bb') || caa(rec),
        preview: it?.previewUrl || null,
        appleUrl: it?.trackViewUrl || null,
        year: it?.releaseDate?.slice(0, 4) || null,
        plays: rec.total_listen_count || 0,
        listeners: rec.total_user_count || 0,
      });
      if (songs.length >= 24) break;
    }
    // no open listening data (new artist)? use the iTunes catalogue instead
    if (songs.length < 6) {
      for (const [k, t] of itunes) {
        if (seen.has(k)) continue;
        seen.add(k);
        songs.push({
          title: t.trackName,
          artist: t.artistName,
          album: t.collectionName,
          cover: t.artworkUrl100?.replace('100x100bb', '300x300bb') || null,
          preview: t.previewUrl,
          appleUrl: t.trackViewUrl,
          year: t.releaseDate?.slice(0, 4) || null,
          plays: 0,
          listeners: 0,
        });
        if (songs.length >= 18) break;
      }
    }
    const maxPlays = Math.max(1, ...songs.map((s) => s.plays));
    songs.forEach((s, i) => (s.popularity = s.plays ? s.plays / maxPlays : 1 - i / Math.max(1, songs.length)));

    // ---- similar artists with their biggest song (for a picture + quick play)
    const simList = (Array.isArray(sims) ? sims : []).filter((a) => a.artist_mbid && a.name).slice(0, 14);
    const best = Math.max(1, ...simList.map((a) => a.score || 0));
    const [genres, topsBySim] = await Promise.all([
      artistGenres([mbid, ...simList.map((a) => a.artist_mbid)].filter(Boolean)).catch(() => ({})),
      Promise.all(
        simList.map((a) =>
          getJson(`https://api.listenbrainz.org/1/popularity/top-recordings-for-artist/${a.artist_mbid}`)
            .then((r) => (Array.isArray(r) ? r[0] : null))
            .catch(() => null)
        )
      ),
    ]);
    const artists = simList.map((a, i) => ({
      name: a.name,
      mbid: a.artist_mbid,
      similarity: Math.round(((a.score || 0) / best) * 100) / 100,
      genres: genres[a.artist_mbid] || [],
      topSong: topsBySim[i]
        ? { title: topsBySim[i].recording_name, artist: topsBySim[i].artist_name, cover: caa(topsBySim[i]) }
        : null,
    }));
    const mainGenres = (mbid && genres[mbid]) || [];
    const sectors = pickSectors(mainGenres, artists);

    return {
      artist: {
        name,
        mbid,
        genres: mainGenres,
        image: info?.wiki?.image || info?.wiki?.thumbnail || info?.itunes?.image || songs[0]?.cover || null,
      },
      songs,
      artists,
      sectors,
      source: 'ListenBrainz + MusicBrainz genres + iTunes previews (open data)',
      fetchedAt: new Date().toISOString(),
    };
}
