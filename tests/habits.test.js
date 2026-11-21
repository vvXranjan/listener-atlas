import { describe, it, expect, vi, afterEach } from 'vitest';
import { emptyDoc, mergePlays, habitStrength, habitsAfter, playedWithin, topPairs, topArtists, songKey } from '../src/habitsCore.js';
import { habitsRoute } from '../server/habits.mjs';

const min = 60 * 1000;
const T0 = Date.UTC(2026, 10, 20, 18, 0);
const play = (title, artist, at) => ({ title, artist, uri: `spotify:track:${title}`, playedAt: at });

describe('Learning your habits', () => {
  it('learns "Highest in the Room → No Pole" from plays in one session', () => {
    let d = emptyDoc();
    for (let day = 0; day < 3; day++) {
      const t = T0 + day * 86400000;
      d = mergePlays(d, [play('HIGHEST IN THE ROOM', 'Travis Scott', t), play('No Pole', 'Don Toliver', t + 3 * min)], T0 + 5 * 86400000);
    }
    const from = { title: 'Highest in the Room', artist: 'Travis Scott' }; // different capitals: same song
    const next = habitsAfter(d, from, T0 + 5 * 86400000);
    expect(next[0]).toMatchObject({ title: 'No Pole', n: 3 });
    expect(habitStrength(d, from, { title: 'No Pole', artist: 'Don Toliver' }, T0 + 5 * 86400000)).toBeGreaterThan(0.7);
  });

  it('does not link songs from different sessions, and syncing twice changes nothing', () => {
    const plays = [play('A', 'x', T0), play('B', 'y', T0 + 2 * 3600 * 1000)];
    const d1 = mergePlays(emptyDoc(), plays, T0 + 3 * 3600 * 1000);
    expect(Object.keys(d1.pairs)).toHaveLength(0); // 2 hours apart: not "after"
    const d2 = mergePlays(d1, plays, T0 + 3 * 3600 * 1000);
    expect(d2.songs[songKey({ title: 'A', artist: 'x' })].n).toBe(1); // not counted twice
  });

  it('carries the session across syncs, fades old habits, knows recent plays', () => {
    let d = mergePlays(emptyDoc(), [play('A', 'x', T0)], T0 + min);
    d = mergePlays(d, [play('B', 'y', T0 + 4 * min)], T0 + 5 * min); // next sync, same session
    expect(topPairs(d, 5, T0 + 5 * min)[0]).toMatchObject({ a: { title: 'A' }, b: { title: 'B' }, n: 1 });
    const soon = habitStrength(d, { title: 'A', artist: 'x' }, { title: 'B', artist: 'y' }, T0 + 5 * min);
    const later = habitStrength(d, { title: 'A', artist: 'x' }, { title: 'B', artist: 'y' }, T0 + 180 * 86400000);
    expect(later).toBeLessThan(soon);
    expect(playedWithin(d, { title: 'B', artist: 'y' }, 60 * min, T0 + 30 * min)).toBe(true);
    expect(playedWithin(d, { title: 'B', artist: 'y' }, 60 * min, T0 + 3 * 3600 * 1000)).toBe(false);
    expect(topArtists(d, 5, T0 + 5 * min).map((a) => a.name)).toEqual(expect.arrayContaining(['x', 'y']));
  });
});

describe('/api/habits (cloud copy)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = { KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'kv-secret' };

  it('says "not set up" without a database, so the app uses the browser', async () => {
    const r = await habitsRoute({ method: 'GET', headers: { authorization: 'Bearer t' }, env: {} });
    expect(r.status).toBe(503);
  });

  it('only works with a real Spotify login, and keeps each person separate', async () => {
    const store = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, opts = {}) => {
        if (String(url).includes('api.spotify.com/v1/me')) {
          const tok = opts.headers.Authorization.split(' ')[1];
          return tok === 'good-vaibhav' ? Response.json({ id: 'vaibhav' }) : tok === 'good-friend' ? Response.json({ id: 'friend' }) : new Response('no', { status: 401 });
        }
        const [cmd, key, value] = JSON.parse(opts.body);
        if (cmd === 'GET') return Response.json({ result: store[key] ?? null });
        if (cmd === 'SET') return Response.json({ result: (store[key] = value) && 'OK' });
        if (cmd === 'DEL') return Response.json({ result: delete store[key] ? 1 : 0 });
        return new Response('?', { status: 400 });
      })
    );
    expect((await habitsRoute({ method: 'GET', headers: {}, env })).status).toBe(401);
    expect((await habitsRoute({ method: 'GET', headers: { authorization: 'Bearer stolen' }, env })).status).toBe(401);

    const plays = [play('HIGHEST IN THE ROOM', 'Travis Scott', T0), play('No Pole', 'Don Toliver', T0 + 3 * min)];
    const r = await habitsRoute({ method: 'POST', headers: { authorization: 'Bearer good-vaibhav' }, body: Buffer.from(JSON.stringify({ plays })), env });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.pairs)).toHaveLength(1);
    expect(Object.keys(store)).toEqual(['habits:vaibhav']); // saved under the Spotify account

    const friend = await habitsRoute({ method: 'GET', headers: { authorization: 'Bearer good-friend' }, env });
    expect(Object.keys(friend.body.pairs)).toHaveLength(0); // can't see Vaibhav's habits

    await habitsRoute({ method: 'DELETE', headers: { authorization: 'Bearer good-vaibhav' }, env });
    expect(store['habits:vaibhav']).toBeUndefined();
  });
});
