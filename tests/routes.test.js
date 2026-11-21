import { describe, it, expect, vi, afterEach } from 'vitest';
import { handle, AUDIO_HOSTS } from '../server/handlers.mjs';

afterEach(() => vi.unstubAllGlobals());

describe('Mix Lab routes', () => {
  it('audio proxy only loads Apple previews', async () => {
    expect(AUDIO_HOSTS.test('https://audio-ssl.itunes.apple.com/itunes-assets/x.m4a')).toBe(true);
    expect(AUDIO_HOSTS.test('https://evil.com/x.m4a')).toBe(false);
    expect(AUDIO_HOSTS.test('https://audio-ssl.itunes.apple.com.evil.com/x')).toBe(false);
    const bad = await handle({ route: 'audio', method: 'GET', query: { u: 'http://169.254.169.254/' } });
    expect(bad.status).toBe(400);
  });

  it('audio proxy returns the file as binary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/x-m4a' } })));
    const r = await handle({ route: 'audio', method: 'GET', query: { u: 'https://audio-ssl.itunes.apple.com/a.m4a' } });
    expect(r.status).toBe(200);
    expect(r.binary).toBe(true);
    expect([...r.body]).toEqual([1, 2, 3]);
  });

  it('song search returns songs with previews', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ results: [{ trackName: '5% TINT', artistName: 'Travis Scott', previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a', artworkUrl100: 'https://x.mzstatic.com/100x100bb.jpg' }] })));
    const r = await handle({ route: 'song-search', method: 'GET', query: { q: '5% tint' } });
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ title: '5% TINT', artist: 'Travis Scott' });
    expect((await handle({ route: 'song-search', method: 'GET', query: { q: 'a' } })).status).toBe(400);
  });
});

describe('One Vercel function for every route', async () => {
  const { nodeHandler, routeFromPath } = await import('../server/adapters.mjs');
  const fakeRes = () => {
    const r = { headers: {}, body: '' };
    r.setHeader = (k, v) => (r.headers[k] = v);
    r.end = (b) => (r.body = b);
    return r;
  };

  it('reads the route from the path', () => {
    expect(routeFromPath('/api/cities')).toBe('cities');
    expect(routeFromPath('/api/song-search')).toBe('song-search');
    expect(routeFromPath('/api/')).toBe('');
  });

  it('serves /api/cities through api/[route].js like Vercel calls it', async () => {
    const handler = nodeHandler();
    const res = fakeRes();
    await handler({ url: '/api/cities?q=lond&route=cities', method: 'GET', query: { route: 'cities', q: 'lond' } }, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)[0].name).toBe('London');
    const res2 = fakeRes(); // without Vercel's ?route=
    await handler({ url: '/api/cities?q=mumb', method: 'GET' }, res2);
    expect(JSON.parse(res2.body)[0].name).toBe('Mumbai');
  });
});
