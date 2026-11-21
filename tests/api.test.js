import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handle } from '../server/handlers.mjs';
import { nodeHandler, webHandler } from '../server/adapters.mjs';

// ---------- fake outside services ----------
const chartHtml = (tracks) => {
  const data = {
    data: [
      {
        data: {
          shelves: [
            { id: 'playlist-detail-header - pl.abc', title: 'Top 25: Atlanta', artwork: { dictionary: { url: 'https://img/{w}x{h}cc.{f}' } } },
            {
              itemKind: 'trackLockup',
              items: tracks.map(([title, artist], i) => ({
                title,
                artistName: artist,
                rankingText: String(i + 1),
                showExplicitBadge: i === 0,
                duration: 180000,
                artwork: { dictionary: { url: 'https://img/{w}x{h}bb.{f}' } },
                contentDescriptor: { identifiers: { storeAdamID: String(100 + i) }, url: `https://music.apple.com/us/song/${i}` },
              })),
            },
          ],
        },
      },
    ],
  };
  return `<html><script type="application/json" id="serialized-server-data">${JSON.stringify(data)}</script></html>`;
};

function fakeFetch(url, opts = {}) {
  const u = String(url);
  const ok = (body, type = 'application/json') =>
    Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': type } }));
  if (u.includes('music.apple.com') && u.includes('/search?')) {
    const term = decodeURIComponent(new URL(u).searchParams.get('term'));
    if (term === 'Top 25: Atlanta') return ok('<a href="https://music.apple.com/us/playlist/top-25-atlanta/pl.abc123">x</a>', 'text/html');
    if (term.startsWith('Top 100:')) return ok('<a href="https://music.apple.com/in/playlist/top-100-india/pl.def456">x</a>', 'text/html');
    return ok('<html>no charts</html>', 'text/html');
  }
  if (u.includes('/playlist/top-25-atlanta/')) return ok(chartHtml([['Spaceship (feat. Don Toliver)', 'Shake Wells'], ['Top Uh It', 'Lil Baby']]), 'text/html');
  if (u.includes('/playlist/top-100-india/')) return ok(chartHtml([['Ashke', 'Karan Aujla']]), 'text/html');
  if (u.includes('itunes.apple.com/lookup')) return ok({ results: [{ trackId: 100, previewUrl: 'https://p/1.m4a', primaryGenreName: 'Hip-Hop' }] });
  if (u.includes('musicbrainz.org')) return ok({ recordings: [{ id: '11111111-1111-1111-1111-111111111111', score: 100 }] });
  if (u.includes('api.listenbrainz.org/1/popularity')) return ok([{ total_listen_count: 1234, total_user_count: 56 }]);
  if (u.includes('listenbrainz.org/recent')) {
    const now = Math.floor(Date.now() / 1000);
    return ok({
      globalListenCount: 3106000000,
      listens: [
        { listened_at: now - 5, user_name: 'secret', track_metadata: { track_name: 'Stardust', artist_name: 'Nat King Cole' } },
        { listened_at: now - 90000000, user_name: 'old', track_metadata: { track_name: 'Old import', artist_name: 'Someone' } },
      ],
    });
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(fakeFetch)));
afterEach(() => vi.unstubAllGlobals());

// ---------- routes ----------
describe('API routes', () => {
  it('serves the bundled Spotify data', async () => {
    const r = await handle({ route: 'live' });
    expect(r.status).toBe(200);
    expect(r.body.artists.length).toBeGreaterThan(50);
  });

  it('suggests cities', async () => {
    const r = await handle({ route: 'cities', query: { q: 'atla' } });
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ name: 'Atlanta', country: 'US' });
  });

  it('rejects bad requests clearly', async () => {
    expect((await handle({ route: 'nope' })).status).toBe(404);
    expect((await handle({ route: 'city', query: {} })).status).toBe(400);
    expect((await handle({ route: 'artist-info', query: {} })).status).toBe(400);
    expect((await handle({ route: 'song-insights', query: { title: 'x' } })).status).toBe(400);
    const a = await handle({ route: 'artist', query: { name: 'Drake' }, env: {} });
    expect(a.status).toBe(501);
    expect(a.body.error).toMatch(/APIFY_TOKEN/);
  });

  it("reads a city's Apple Music chart, with previews", async () => {
    const r = await handle({ route: 'city', query: { name: 'Atlanta', cc: 'US' } });
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('city');
    expect(r.body.chart.title).toBe('Top 25: Atlanta');
    expect(r.body.chart.tracks[0]).toMatchObject({ rank: 1, artist: 'Shake Wells', preview: 'https://p/1.m4a', explicit: true });
    expect(r.body.chart.tracks[0].artwork).toBe('https://img/200x200bb.jpg');
  });

  it('falls back to the country chart when a city has none', async () => {
    const r = await handle({ route: 'city', query: { name: 'Jaipur', cc: 'IN' } });
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('country');
    expect(r.body.chart.tracks[0].title).toBe('Ashke');
  });

  it('says so when a city does not exist', async () => {
    const r = await handle({ route: 'city', query: { name: 'Qqqzzzville' } });
    expect(r.status).toBe(400);
  });

  it('only shows live plays from the last hour, without usernames', async () => {
    const r = await handle({ route: 'now-playing' });
    expect(r.status).toBe(200);
    expect(r.body.listens).toHaveLength(1);
    expect(r.body.listens[0]).toMatchObject({ track: 'Stardust', artist: 'Nat King Cole' });
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });

  it('finds where a song is charting and its ListenBrainz plays', async () => {
    const r = await handle({
      route: 'song-insights',
      query: { title: 'Spaceship (feat. Shake Wells & Don Toliver)', artists: 'Shake Wells|Don Toliver' },
      env: { SONG_SCAN_BUDGET_MS: '20000' },
    });
    expect(r.status).toBe(200);
    expect(r.body.charts.charts).toEqual([expect.objectContaining({ city: 'Atlanta', rank: 1 })]);
    expect(r.body.listens).toEqual({ listens: 1234, listeners: 56, recordings: 1 });
  }, 30000);

  it('Shazam: needs POST and a real recording', async () => {
    expect((await handle({ route: 'shazam', method: 'GET' })).status).toBe(405);
    expect((await handle({ route: 'shazam', method: 'POST', body: Buffer.alloc(0) })).status).toBe(400);
    const bad = await handle({ route: 'shazam', method: 'POST', body: Buffer.from('not audio at all') });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/recording/i);
  });

  it('Shazam: turns a WAV into a fingerprint and asks Shazam', async () => {
    // 3 seconds of a tone, 16 kHz mono WAV
    const rate = 16000;
    const n = rate * 3;
    const buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + n * 2, 4);
    buf.write('WAVEfmt ', 8);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * (440 + 200 * Math.sin(i / 8000)) * i) / rate)), 44 + i * 2);

    globalThis.fetch.mockImplementation((url) =>
      String(url).includes('amp.shazam.com')
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                matches: [{}],
                track: { title: 'Spaceship', subtitle: 'Shake Wells', images: { coverart: 'https://c.jpg' }, genres: { primary: 'Hip-Hop' }, share: { href: 'https://shz.am/x' } },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            )
          )
        : fakeFetch(url)
    );
    const r = await handle({ route: 'shazam', method: 'POST', body: buf });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ found: true, title: 'Spaceship', artist: 'Shake Wells', genre: 'Hip-Hop' });
    const sent = globalThis.fetch.mock.calls.find(([u]) => String(u).includes('amp.shazam.com'));
    expect(JSON.parse(sent[1].body).signature.uri).toMatch(/^data:audio\/vnd\.shazam\.sig;base64,/);
  });
});

// ---------- host adapters ----------
describe('hosting adapters', () => {
  it('Vercel / Node style handler returns JSON with caching', async () => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    const req = { url: '/api/cities?q=lond', method: 'GET' };
    await nodeHandler('cities')(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/json/);
    expect(res.headers['Cache-Control']).toMatch(/s-maxage/);
    expect(JSON.parse(res.body)[0].name).toBe('London');
  });

  it('Netlify / Web style handler routes by path', async () => {
    const r = await webHandler(new Request('https://site.netlify.app/api/cities?q=mumb'));
    expect(r.status).toBe(200);
    expect((await r.json())[0].name).toBe('Mumbai');
    const missing = await webHandler(new Request('https://site.netlify.app/api/whatever'));
    expect(missing.status).toBe(404);
  });

  it('Netlify handler passes POST bodies through', async () => {
    const r = await webHandler(new Request('https://site.netlify.app/api/shazam', { method: 'POST', body: 'junk' }));
    expect(r.status).toBe(400);
  });
});
