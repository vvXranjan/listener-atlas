// /api/habits: your listening habits, saved in a cloud database (Upstash Redis on Vercel)
// so your Mac, phone and any browser share them.
//
// Who you are comes from Spotify itself: every request carries your Spotify login token,
// and we ask Spotify "whose token is this?". Nobody can read or change another person's habits.
// Without a database configured, it answers 503 and the app keeps habits in the browser.
import { fetchT as fetch } from './http.mjs';
import { emptyDoc, mergePlays } from '../src/habitsCore.js';

const who = new Map(); // token -> { id, until }

async function spotifyUserId(token) {
  const hit = who.get(token);
  if (hit && hit.until > Date.now()) return hit.id;
  const r = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const me = await r.json();
  if (!me?.id) return null;
  who.set(token, { id: me.id, until: Date.now() + 10 * 60 * 1000 });
  if (who.size > 500) who.delete(who.keys().next().value);
  return me.id;
}

function kv(env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return async (...command) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!r.ok) throw new Error(`Database error ${r.status}`);
    return (await r.json()).result;
  };
}

function parseBody(body) {
  if (!body?.length) return {};
  try {
    return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
  } catch {
    return null;
  }
}

const cleanPlays = (list) =>
  (Array.isArray(list) ? list : [])
    .slice(0, 100)
    .filter((p) => p && typeof p.title === 'string' && Number.isFinite(p.playedAt))
    .map((p) => ({ title: p.title, artist: String(p.artist || ''), uri: typeof p.uri === 'string' ? p.uri : null, playedAt: p.playedAt }));

export async function habitsRoute({ method, headers = {}, body, env = process.env }) {
  const db = kv(env);
  if (!db) return { status: 503, body: { error: 'Cloud storage is not set up', cloud: false } };
  const auth = headers.authorization || headers.Authorization || '';
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  if (!token) return { status: 401, body: { error: 'Connect Spotify first' } };
  const uid = await spotifyUserId(token).catch(() => null);
  if (!uid) return { status: 401, body: { error: 'Spotify login expired: reconnect' } };
  const key = `habits:${uid}`;

  if (method === 'DELETE') {
    await db('DEL', key);
    return { status: 200, body: { ...emptyDoc(), cloud: true } };
  }
  const saved = await db('GET', key);
  let doc = saved ? JSON.parse(saved) : emptyDoc();
  if (method === 'POST') {
    const b = parseBody(body);
    if (b === null) return { status: 400, body: { error: 'Bad request' } };
    const before = doc.cursor;
    doc = mergePlays(doc, cleanPlays(b.plays));
    if (doc.cursor !== before) await db('SET', key, JSON.stringify(doc));
  }
  return { status: 200, body: { ...doc, cloud: true } };
}
