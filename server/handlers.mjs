// One API for every host: Vite dev server, Vercel functions and Netlify functions.
// handle() takes a plain request description and returns { status, body }.

import fs from 'node:fs';
import path from 'node:path';
// bundled copy of the Spotify data (included by every host's bundler)
import bundledLive from '../src/data/live.json' with { type: 'json' };
import { fetchT as fetch } from './http.mjs';

const LIVE_FILE = path.resolve(process.cwd(), 'src/data/live.json');

// In dev the file can be refreshed on disk; in production we use the copy bundled with the function.
function readLive() {
  try {
    return JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
  } catch {
    return bundledLive;
  }
}

const json = (status, body) => ({ status, body });
const artistCache = new Map();

export const ROUTES = [
  'live', 'cities', 'city', 'artist-info', 'artist', 'now-playing', 'shazam', 'song-insights', 'recommend',
  'song-search', 'preview', 'audio', 'galaxy', 'habits', 'genre',
];

// Only Apple's preview servers may be proxied (stops the proxy being used for anything else)
const audioCache = new Map(); // recently used previews, so repeat plays are instant
export const AUDIO_HOSTS = /^https:\/\/(audio-ssl\.itunes\.apple\.com|[a-z0-9-]+\.mzstatic\.com)\//;

/**
 * @param {object} req
 * @param {string} req.route   e.g. "city" (the part after /api/)
 * @param {string} req.method
 * @param {Record<string,string>} req.query
 * @param {Buffer|null} req.body
 * @param {Record<string,string|undefined>} [req.env]
 */
export async function handle({ route, method = 'GET', query = {}, body = null, headers = {}, env = process.env }) {
  const q = (k) => (typeof query[k] === 'string' ? query[k].trim() : '');
  const token = env.APIFY_TOKEN;
  try {
    switch (route) {
      case 'live':
        return json(200, { ...readLive(), autoRefresh: !!token && env.NODE_ENV !== 'production', refreshHours: 24 });

      case 'cities': {
        const { searchCities } = await import('./api.mjs');
        return json(200, await searchCities(q('q')));
      }

      case 'city': {
        if (!q('name')) return json(400, { error: 'name is required' });
        const { getCityChart } = await import('./api.mjs');
        return json(200, await getCityChart(q('name'), q('cc') || undefined));
      }

      case 'artist-info': {
        if (!q('name')) return json(400, { error: 'name is required' });
        const { getArtistInfo } = await import('./api.mjs');
        return json(200, await getArtistInfo(q('name')));
      }

      case 'artist': {
        const name = q('name');
        if (!name) return json(400, { error: 'name is required' });
        if (!token) return json(501, { error: 'Add APIFY_TOKEN to look up new artists (the free Apify plan works).' });
        const key = name.toLowerCase();
        if (!artistCache.has(key)) {
          const { fetchArtists } = await import('../scripts/fetch-data-lib.mjs');
          const { normalizeArtist } = await import('../scripts/normalize.mjs');
          const raw = await fetchArtists([name], token);
          if (!raw.length) return json(404, { error: `No Spotify artist found for "${name}"` });
          artistCache.set(key, normalizeArtist(raw[0]));
        }
        return json(200, artistCache.get(key));
      }

      case 'now-playing': {
        const { getNowPlaying } = await import('./live.mjs');
        return json(200, await getNowPlaying());
      }

      case 'shazam': {
        if (method !== 'POST') return json(405, { error: 'POST a WAV recording' });
        if (!body || !body.length) return json(400, { error: 'No recording received' });
        if (body.length > 4 * 1024 * 1024) return json(413, { error: 'Recording too large' });
        const { recognizeSong } = await import('./live.mjs');
        return json(200, await recognizeSong(body, q('tz') || undefined));
      }

      case 'song-insights': {
        const title = q('title');
        const artists = q('artists')
          .split('|')
          .map((x) => x.trim())
          .filter(Boolean);
        if (!title || !artists.length) return json(400, { error: 'title and artists are required' });
        const { songInsights } = await import('./song.mjs');
        return json(200, await songInsights(title, artists, { budgetMs: Number(env.SONG_SCAN_BUDGET_MS) || 8000 }));
      }

      case 'recommend': {
        const title = q('title');
        const artists = q('artists')
          .split('|')
          .map((x) => x.trim())
          .filter(Boolean);
        if (!title || !artists.length) return json(400, { error: 'title and artists are required' });
        const { recommend } = await import('./recommend.mjs');
        return json(200, await recommend(title, artists, env));
      }

      case 'habits': {
        const { habitsRoute } = await import('./habits.mjs');
        return habitsRoute({ method, headers, body, env });
      }

      case 'galaxy': {
        if (!q('name')) return json(400, { error: 'name is required' });
        const { artistGalaxy } = await import('./galaxy.mjs');
        return json(200, await artistGalaxy(q('name')));
      }

      case 'genre': {
        if (!q('tag')) return json(400, { error: 'tag is required' });
        const { genrePage } = await import('./genre.mjs');
        return json(200, await genrePage(q('tag')));
      }

      case 'song-search': {
        const term = q('q');
        if (term.length < 2) return json(400, { error: 'Type at least 2 letters' });
        const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=10`);
        if (!r.ok) return json(502, { error: `Song search failed (${r.status})` });
        const j = await r.json();
        return json(
          200,
          (j.results || []).map((t) => ({
            title: t.trackName,
            artist: t.artistName,
            album: t.collectionName,
            cover: t.artworkUrl100?.replace('100x100bb', '300x300bb') || null,
            preview: t.previewUrl || null,
            appleUrl: t.trackViewUrl || null,
            genre: t.primaryGenreName || null,
            year: t.releaseDate?.slice(0, 4) || null,
          }))
        );
      }

      case 'preview': {
        if (!q('title') || !q('artist')) return json(400, { error: 'title and artist are required' });
        const { itunesSong } = await import('./recommend.mjs');
        const song = await itunesSong(q('title'), q('artist'));
        return song ? json(200, song) : json(404, { error: 'No preview found' });
      }

      case 'audio': {
        const u = q('u');
        if (!AUDIO_HOSTS.test(u)) return json(400, { error: 'Only Apple Music previews can be loaded' });
        let hit = audioCache.get(u);
        if (!hit) {
          const r = await fetch(u);
          if (!r.ok) return json(502, { error: `Preview download failed (${r.status})` });
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 4 * 1024 * 1024) return json(413, { error: 'Preview too large' });
          hit = { buf, type: r.headers.get('content-type') || 'audio/mp4' };
          audioCache.set(u, hit);
          if (audioCache.size > 40) audioCache.delete(audioCache.keys().next().value); // keep memory small
        }
        const buf = hit.buf;
        return {
          status: 200,
          binary: true,
          body: buf,
          headers: { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
        };
      }

      default:
        return json(404, { error: 'Unknown API route' });
    }
  } catch (e) {
    const msg = e?.message || String(e);
    // a user-facing problem (bad recording etc.) vs. an upstream service failing
    const status = /recording|Couldn't find|No Apple Music chart/i.test(msg) ? 400 : 502;
    return json(status, { error: msg });
  }
}
