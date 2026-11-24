import { it, expect, vi } from 'vitest';
import { jamRoute, memoryKv, cleanSong, cleanCode } from '../server/jam.mjs';

const env = {}; // no database: in-memory Jam (like npm run dev)
const post = (body) => jamRoute({ method: 'POST', body: Buffer.from(JSON.stringify(body)), env });
const get = (query) => jamRoute({ method: 'GET', query, env });
const song = (title, artist = 'Artist') => ({ title, artist, cover: 'https://is1-ssl.mzstatic.com/x.jpg' });

it('a full Jam: start, friends add, host takes them in order, end', async () => {
  const c = await post({ action: 'create', host: 'Vaibhav' });
  expect(c.status).toBe(200);
  const { code, hostKey } = c.body;
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  const look = await get({ code: code.toLowerCase(), guest: 'g1' });
  expect(look.body).toMatchObject({ code, host: 'Vaibhav', guests: 1, waiting: [] });
  expect(JSON.stringify(look.body)).not.toContain(hostKey); // the host key never leaks

  expect((await post({ action: 'add', code, guest: 'g1', name: 'Asha', song: song('One') })).status).toBe(200);
  expect((await post({ action: 'add', code, guest: 'g1', name: 'Asha', song: song('Two') })).status).toBe(429); // cooldown
  expect((await post({ action: 'add', code, guest: 'g2', name: 'Ravi', song: song('one') })).status).toBe(409); // already in
  expect((await post({ action: 'add', code, guest: 'g2', name: 'Ravi', song: song('Two') })).status).toBe(200);

  expect((await post({ action: 'sync', code, hostKey: 'wrong' })).status).toBe(403);
  const s = await post({ action: 'sync', code, hostKey, now: { ...song('Now'), playing: true }, next: [{ ...song('One'), by: 'Asha' }] });
  expect(s.body.adds.map((a) => [a.title, a.by])).toEqual([['One', 'Asha'], ['Two', 'Ravi']]);
  expect(s.body.guests).toBe(2);
  expect((await post({ action: 'sync', code, hostKey, now: { ...song('Now'), playing: true }, next: [{ ...song('One'), by: 'Asha' }] })).body.adds).toEqual([]); // taken once only

  const after = await get({ code });
  expect(after.body.now).toMatchObject({ title: 'Now', playing: true });
  expect(after.body.next[0]).toMatchObject({ title: 'One', by: 'Asha' });

  expect((await post({ action: 'end', code, hostKey })).status).toBe(200);
  expect((await get({ code })).status).toBe(404);
  expect((await post({ action: 'add', code, guest: 'g3', song: song('Three') })).status).toBe(404);
});

it('limits each guest and cleans what they send', async () => {
  vi.useFakeTimers();
  try {
    const { code } = (await post({ action: 'create', host: 'H' })).body;
    for (let i = 0; i < 4; i++) {
      expect((await post({ action: 'add', code, guest: 'spam', name: 'X', song: song(`S${i}`) })).status).toBe(200);
      vi.advanceTimersByTime(6000);
    }
    expect((await post({ action: 'add', code, guest: 'spam', name: 'X', song: song('S9') })).status).toBe(429);
  } finally {
    vi.useRealTimers();
  }
  expect(cleanSong({ title: 'A', artist: 'B', cover: 'https://evil.com/x.png', uri: 'javascript:1' })).toEqual({ title: 'A', artist: 'B', cover: null, preview: null, uri: null });
  expect(cleanSong({ title: '', artist: 'B' })).toBeNull();
  expect(cleanCode('ab-c d12')).toBe('ABCD12');
  expect((await get({ code: 'ABC' })).status).toBe(400);
});

it('needs the database on Vercel', async () => {
  const r = await jamRoute({ method: 'GET', query: { code: 'ABCDEF' }, env: { VERCEL: '1' } });
  expect(r.status).toBe(503);
});

it('memory store handles list trims like Redis', async () => {
  const db = memoryKv();
  await db('RPUSH', 'q', 'a', 'b', 'c');
  await db('LTRIM', 'q', 2, -1);
  expect(await db('LRANGE', 'q', 0, -1)).toEqual(['c']);
  expect(await db('SET', 'k', '1', 'EX', 5, 'NX')).toBe('OK');
  expect(await db('SET', 'k', '1', 'EX', 5, 'NX')).toBeNull();
});

it("puts friends' songs right after the playing song, first come first served", async () => {
  const { insertJamSongs } = await import('../src/jam.js');
  const set = [song('Now'), song('Mine 1'), song('Later')];
  let s = insertJamSongs(set, [{ ...song('Hey'), by: 'Asha' }], song('Now'));
  expect(s.map((x) => x.title)).toEqual(['Now', 'Hey', 'Mine 1', 'Later']);
  s = insertJamSongs(s, [{ ...song('Later'), by: 'Ravi' }, { ...song('Now'), by: 'Ravi' }], song('Now'));
  // "Later" moves up behind Asha's song (no copy); the playing song isn't added again
  expect(s.map((x) => [x.title, x.by || null])).toEqual([['Now', null], ['Hey', 'Asha'], ['Later', 'Ravi'], ['Mine 1', null]]);
});
