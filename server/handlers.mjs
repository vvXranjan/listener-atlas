// One API for every host: Vite dev server, Vercel functions and Netlify functions.
// handle() takes a plain request description and returns { status, body }.

import fs from 'node:fs';
import path from 'node:path';
// bundled copy of the Spotify data (included by every host's bundler)
import bundledLive from '../src/data/live.json' with { type: 'json' };

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

export const ROUTES = ['live', 'cities', 'city', 'artist-info', 'artist', 'now-playing', 'shazam', 'song-insights'];

/**
 * @param {object} req
 * @param {string} req.route   e.g. "city" (the part after /api/)
 * @param {string} req.method
 * @param {Record<string,string>} req.query
 * @param {Buffer|null} req.body
 * @param {Record<string,string|undefined>} [req.env]
 */
export async function handle({ route, method = 'GET', query = {}, body = null, env = process.env }) {
  const q = (k) => (typeof query[k] === 'string' ? query[k].trim() : '');
  const token = env.APIFY_TOKEN;
  try {
    switch (route) {
      case 'live':
        return json(200, { ...readLive(), autoRefresh: !!token && env.NODE_ENV !== 'production', refreshHours: 24 });

      case 'cities': {
        const { searchCities } = await import('./api.mjs');
        return json(200, searchCities(q('q')));
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
