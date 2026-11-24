// /api/jam: a shared listening session, like Spotify Jam.
//
// The host (the one whose Spotify plays) starts a Jam and shows a QR code. Friends scan it,
// open the Jam page on their phone (no Spotify login needed) and add songs. The host's app picks
// the songs up every few seconds and Auto-DJ plays them next, in the order they were added.
//
// Stored in Upstash Redis (the same database as habits), so every phone sees the same Jam.
// Without a database it keeps Jams in memory, which works on your own computer (npm run dev).
// Everything expires 8 hours after the host was last seen.
import { randomBytes } from 'node:crypto';
import { fetchT as fetch } from './http.mjs';

const TTL_S = 8 * 3600;
const MAX_QUEUE = 40; // songs waiting for the host at once
const MAX_PER_GUEST = 4; // songs one guest can have waiting
const COOLDOWN_S = 5; // seconds between two adds from the same guest
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: easy to type

// ---------- storage ----------
function redis(env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return async (...command) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command.map(String)),
    });
    if (!r.ok) throw new Error(`Database error ${r.status}`);
    return (await r.json()).result;
  };
}

// The few Redis commands a Jam needs, in memory (one server process only)
export function memoryKv() {
  const m = new Map(); // key -> { v, until }
  const live = (k) => {
    const e = m.get(k);
    if (e && e.until && e.until < Date.now()) m.delete(k);
    return m.get(k);
  };
  const put = (k, v, until = live(k)?.until || 0) => m.set(k, { v, until });
  return async (cmd, k, ...a) => {
    const e = live(k);
    switch (String(cmd).toUpperCase()) {
      case 'GET':
        return e ? e.v : null;
      case 'SET': {
        const nx = a.includes('NX');
        if (nx && e) return null;
        const ex = a.indexOf('EX');
        put(k, String(a[0]), ex >= 0 ? Date.now() + Number(a[ex + 1]) * 1000 : 0);
        return 'OK';
      }
      case 'DEL':
        return [k, ...a].reduce((n, key) => n + (m.delete(key) ? 1 : 0), 0);
      case 'EXPIRE':
        if (!e) return 0;
        e.until = Date.now() + Number(a[0]) * 1000;
        return 1;
      case 'RPUSH': {
        const list = e ? e.v : [];
        list.push(...a.map(String));
        put(k, list);
        return list.length;
      }
      case 'LRANGE': {
        const list = e ? e.v : [];
        const end = Number(a[1]) < 0 ? list.length + Number(a[1]) + 1 : Number(a[1]) + 1;
        return list.slice(Number(a[0]), end);
      }
      case 'LTRIM': {
        if (!e) return 'OK';
        const end = Number(a[1]) < 0 ? e.v.length + Number(a[1]) + 1 : Number(a[1]) + 1;
        e.v = e.v.slice(Number(a[0]), end);
        return 'OK';
      }
      case 'LLEN':
        return e ? e.v.length : 0;
      case 'SADD': {
        const s = e ? e.v : new Set();
        const before = s.size;
        a.forEach((x) => s.add(String(x)));
        put(k, s);
        return s.size - before;
      }
      case 'SCARD':
        return e ? e.v.size : 0;
      default:
        throw new Error(`memoryKv: ${cmd} not supported`);
    }
  };
}
const local = memoryKv();
function store(env) {
  const r = redis(env);
  if (r) return r;
  if (env.VERCEL) return null; // memory isn't shared between Vercel's servers: needs the database
  return local;
}

// ---------- helpers ----------
const keys = (c) => ({ meta: `jam:${c}`, host: `jam:${c}:host`, q: `jam:${c}:q`, guests: `jam:${c}:g` });
const newCode = () => Array.from(randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
export const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const IMG = /^https:\/\/([a-z0-9-]+\.mzstatic\.com|i\.scdn\.co)\//;
const AUDIO = /^https:\/\/(audio-ssl\.itunes\.apple\.com|[a-z0-9-]+\.mzstatic\.com)\//;
const URI = /^spotify:track:[A-Za-z0-9]{22}$/;

// a song as stored: only the fields we show, checked
export function cleanSong(s) {
  if (!s || typeof s !== 'object') return null;
  const title = str(s.title, 200);
  const artist = str(s.artist, 200);
  if (!title || !artist) return null;
  return {
    title,
    artist,
    cover: IMG.test(s.cover || '') ? s.cover : null,
    preview: AUDIO.test(s.preview || '') ? s.preview : null,
    uri: URI.test(s.uri || '') ? s.uri : null,
  };
}
const cleanName = (n) => str(n, 24) || 'Guest';
const cleanId = (g) => String(g || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);

function parse(body) {
  if (!body?.length) return {};
  try {
    return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
  } catch {
    return null;
  }
}
const readJson = (v) => {
  try {
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};
const ok = (body) => ({ status: 200, body });
const err = (status, error) => ({ status, body: { error } });

async function isHost(db, code, hostKey) {
  const k = await db('GET', keys(code).host);
  return !!k && typeof hostKey === 'string' && k === hostKey;
}
async function touch(db, code) {
  const k = keys(code);
  await Promise.all([k.meta, k.host, k.q, k.guests].map((x) => db('EXPIRE', x, TTL_S)));
}

// ---------- the route ----------
export async function jamRoute({ method, query = {}, body, env = process.env }) {
  const db = store(env);
  if (!db) return err(503, 'Jam needs the cloud database (Upstash Redis) on this site.');

  // a guest (or the host) looks at the Jam
  if (method === 'GET') {
    const code = cleanCode(query.code);
    if (code.length !== 6) return err(400, 'That Jam code is 6 letters.');
    const k = keys(code);
    const meta = readJson(await db('GET', k.meta));
    if (!meta || meta.ended) return err(404, 'This Jam has ended or the code is wrong.');
    const guest = cleanId(query.guest);
    if (guest) await db('SADD', k.guests, guest);
    const [waiting, guests] = await Promise.all([db('LRANGE', k.q, 0, -1), db('SCARD', k.guests)]);
    return ok({
      code,
      host: meta.host,
      now: meta.now || null,
      next: meta.next || [],
      waiting: (waiting || []).map(readJson).filter(Boolean).map(({ id, by, title, artist, cover }) => ({ id, by, title, artist, cover })),
      guests: Number(guests) || 0,
      hostSeenAt: meta.seenAt || meta.createdAt,
    });
  }

  if (method !== 'POST') return err(405, 'Use GET or POST');
  const b = parse(body);
  if (!b) return err(400, 'Bad request');
  const code = cleanCode(b.code);
  const k = keys(code);

  switch (b.action) {
    case 'create': {
      let c = '';
      for (let i = 0; i < 5 && !c; i++) {
        const tryCode = newCode();
        if ((await db('SET', keys(tryCode).meta, JSON.stringify({ placeholder: true }), 'EX', TTL_S, 'NX')) === 'OK') c = tryCode;
      }
      if (!c) return err(503, 'Could not start a Jam, try again.');
      const hostKey = randomBytes(18).toString('hex');
      const meta = { host: cleanName(b.host || 'Jam'), createdAt: Date.now(), seenAt: Date.now(), now: null, next: [] };
      await db('SET', keys(c).meta, JSON.stringify(meta), 'EX', TTL_S);
      await db('SET', keys(c).host, hostKey, 'EX', TTL_S);
      return ok({ code: c, hostKey, host: meta.host });
    }

    case 'add': {
      if (code.length !== 6) return err(400, 'That Jam code is 6 letters.');
      const meta = readJson(await db('GET', k.meta));
      if (!meta || meta.ended) return err(404, 'This Jam has ended.');
      const song = cleanSong(b.song);
      if (!song) return err(400, 'Pick a song to add.');
      const guest = cleanId(b.guest);
      if (!guest) return err(400, 'Missing guest id');
      const waiting = ((await db('LRANGE', k.q, 0, -1)) || []).map(readJson).filter(Boolean);
      if (waiting.length >= MAX_QUEUE) return err(429, 'The Jam queue is full. Try again in a bit.');
      if (waiting.filter((w) => w.guest === guest).length >= MAX_PER_GUEST) return err(429, `You have ${MAX_PER_GUEST} songs waiting. Wait for one to play.`);
      const same = (x) => x.title.toLowerCase() === song.title.toLowerCase() && x.artist.toLowerCase() === song.artist.toLowerCase();
      if (waiting.some(same) || (meta.next || []).some(same)) return err(409, 'That song is already in the Jam.');
      if ((await db('SET', `jam:${code}:cd:${guest}`, '1', 'EX', COOLDOWN_S, 'NX')) !== 'OK') return err(429, 'One sec, slow down a little.');
      const item = { id: randomBytes(6).toString('hex'), by: cleanName(b.name), guest, at: Date.now(), ...song };
      await db('RPUSH', k.q, JSON.stringify(item));
      await db('SADD', k.guests, guest);
      return ok({ added: { id: item.id, title: item.title, artist: item.artist } });
    }

    // the host: pushes what's playing, takes the songs guests added (one call every few seconds)
    case 'sync': {
      if (!(await isHost(db, code, b.hostKey))) return err(403, 'Not the host of this Jam');
      const meta = readJson(await db('GET', k.meta)) || {};
      const now = b.now ? { ...cleanSong(b.now), by: b.now.by ? cleanName(b.now.by) : null, playing: !!b.now.playing } : null;
      const next = (Array.isArray(b.next) ? b.next : [])
        .slice(0, 10)
        .map((s) => (cleanSong(s) ? { ...cleanSong(s), by: s.by ? cleanName(s.by) : null } : null))
        .filter(Boolean);
      await db('SET', k.meta, JSON.stringify({ ...meta, now: now?.title ? now : null, next, seenAt: Date.now() }), 'EX', TTL_S);
      // take what's waiting: read, then cut exactly what was read (adds that arrive meanwhile stay)
      const raw = (await db('LRANGE', k.q, 0, -1)) || [];
      if (raw.length) await db('LTRIM', k.q, raw.length, -1);
      await touch(db, code);
      const adds = raw.map(readJson).filter(Boolean).map(({ id, by, title, artist, cover, preview, uri }) => ({ id, by, title, artist, cover, preview, uri }));
      return ok({ adds, guests: Number(await db('SCARD', k.guests)) || 0 });
    }

    case 'end': {
      if (!(await isHost(db, code, b.hostKey))) return err(403, 'Not the host of this Jam');
      const meta = readJson(await db('GET', k.meta)) || {};
      await db('SET', k.meta, JSON.stringify({ ...meta, ended: true }), 'EX', 600);
      await db('DEL', k.host, k.q, k.guests);
      return ok({ ended: true });
    }

    default:
      return err(400, 'Unknown action');
  }
}
