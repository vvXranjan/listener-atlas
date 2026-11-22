import { it, expect, vi, afterEach } from 'vitest';

const ids = ['r1', 'r2', 'r3', 'r4'];
const meta = {
  r1: { recording: { name: 'Mask Off' }, artist: { name: 'Future', artists: [{ name: 'Future', artist_mbid: 'f' }] }, release: { caa_release_mbid: 'x', caa_id: 1 } },
  r2: { recording: { name: 'Bad and Boujee' }, artist: { name: 'Migos feat. Lil Uzi Vert', artists: [{ name: 'Migos', artist_mbid: 'm' }] }, release: {} },
  r3: { recording: { name: 'Mask Off' }, artist: { name: 'Future', artists: [{ name: 'Future' }] }, release: {} }, // duplicate
  r4: { recording: { name: 'Low Life' }, artist: { name: 'Future feat. The Weeknd', artists: [{ name: 'Future' }] }, release: {} },
};
const plays = { r1: 900, r2: 700, r3: 100, r4: 500 };

afterEach(() => vi.restoreAllMocks());

it('builds a genre page: top songs by listens, deduped, plus biggest artists', async () => {
  globalThis.fetch = vi.fn(async (url, opts) => {
    if (url.includes('/lb-radio/tags')) return Response.json(ids.map((id) => ({ recording_mbid: id, percent: 90 })));
    if (url.includes('/popularity/recording')) {
      const body = JSON.parse(opts.body);
      return Response.json(body.recording_mbids.map((id) => ({ recording_mbid: id, total_listen_count: plays[id], total_user_count: 10 })));
    }
    if (url.includes('/metadata/recording')) return Response.json(meta);
    return new Response('no', { status: 404 });
  });
  const { genrePage, normalizeTag } = await import('../server/genre.mjs');
  expect(normalizeTag('  Southern   Hip-Hop! ')).toBe('southern hip-hop');
  const g = await genrePage('Southern Hip Hop');
  expect(g.tag).toBe('southern hip hop');
  expect(g.songs.map((s) => s.title)).toEqual(['Mask Off', 'Bad and Boujee', 'Low Life']);
  expect(g.songs[0].cover).toContain('coverartarchive.org/release/x/1');
  expect(g.artists[0]).toMatchObject({ name: 'Future', songs: 2, plays: 1400 });
  expect(g.artists[1].name).toBe('Migos');
});
