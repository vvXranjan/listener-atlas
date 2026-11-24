// Small wrappers that plug handle() into each host.

import { handle } from './handlers.mjs';

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  // Vercel may have parsed the body already
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body));
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 5 * 1024 * 1024) break;
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

const CACHE = {
  live: 'public, s-maxage=300, stale-while-revalidate=3600',
  cities: 'public, s-maxage=86400',
  city: 'public, s-maxage=600, stale-while-revalidate=3600',
  'artist-info': 'public, s-maxage=21600',
  'song-insights': 'public, s-maxage=600',
  'now-playing': 'public, s-maxage=8',
  recommend: 'public, s-maxage=1800',
  'song-search': 'public, s-maxage=3600',
  preview: 'public, s-maxage=86400',
  galaxy: 'public, s-maxage=21600',
  genre: 'public, s-maxage=21600',
  music: 'public, s-maxage=3600',
  lyrics: 'public, s-maxage=86400',
  habits: 'private, no-store', // personal: never cached
  jam: 'private, no-store', // live: never cached
};

// Node style (req, res): Vite dev server and Vercel functions.
// With no fixed route, the route comes from the path: /api/<route>
// (one Vercel function serves every route: the free plan allows only 12 functions).
export const routeFromPath = (pathname) => pathname.replace(/^\/api\/?/, '').split('/')[0] || '';

export function nodeHandler(fixedRoute) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const query = Object.fromEntries(url.searchParams);
    const route = fixedRoute || req.query?.route || query.route || routeFromPath(url.pathname);
    if (!fixedRoute) delete query.route; // Vercel adds ?route= for api/[route].js
    const body = req.method === 'POST' ? await readBody(req) : null;
    const r = await handle({ route, method: req.method, query, body, headers: req.headers || {} });
    res.statusCode = r.status;
    if (r.binary) {
      for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
      return res.end(r.body);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (r.status === 200 && CACHE[route]) res.setHeader('Cache-Control', CACHE[route]);
    res.end(JSON.stringify(r.body));
  };
}

// Web standard (Request -> Response): Netlify functions
export async function webHandler(request) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/(\.netlify\/functions\/api|api)\/?/, '').split('/')[0];
  const query = Object.fromEntries(url.searchParams);
  const body = request.method === 'POST' ? Buffer.from(await request.arrayBuffer()) : null;
  const r = await handle({ route, method: request.method, query, body, headers: Object.fromEntries(request.headers) });
  if (r.binary) return new Response(r.body, { status: r.status, headers: r.headers });
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (r.status === 200 && CACHE[route]) headers['Cache-Control'] = CACHE[route];
  return new Response(JSON.stringify(r.body), { status: r.status, headers });
}
