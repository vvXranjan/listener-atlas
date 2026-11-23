import { it, expect, vi } from 'vitest';
import { parseLrc, pickBest } from '../server/lyrics.mjs';
import { lineAt } from '../src/LyricsView.jsx';

// placeholder lines only (no real lyrics in the repo)
const LRC = '[00:01.50] line one\n[00:04.20] line two\n[00:04.20][00:30.00] chorus\n[01:02.345] line four\nnot a timed line';

it('parses LRC time stamps, including repeated ones', () => {
  const l = parseLrc(LRC);
  expect(l.map((x) => x.t)).toEqual([1500, 4200, 4200, 30000, 62345]);
  expect(l[3].text).toBe('chorus');
});

it('finds the line being sung', () => {
  const l = parseLrc(LRC);
  expect(lineAt(l, 0)).toBe(-1);
  expect(lineAt(l, 1600)).toBe(0);
  expect(lineAt(l, 5000)).toBe(2);
  expect(lineAt(l, 999999)).toBe(4);
});

it('picks the right version: same title + artist, closest length, synced first', () => {
  const best = pickBest(
    [
      { trackName: 'Song (Live)', artistName: 'Other', duration: 200, syncedLyrics: '[00:01.00] x' },
      { trackName: 'Song', artistName: 'Artist', duration: 300, plainLyrics: 'x' },
      { trackName: 'Song', artistName: 'Artist', duration: 241, syncedLyrics: '[00:01.00] x' },
    ],
    { title: 'Song', artist: 'Artist, Guest', durationSec: 240 }
  );
  expect(best.duration).toBe(241);
});

it('lyrics route: exact lookup, then search', async () => {
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).includes('/api/get')) return new Response('{}', { status: 404 });
    if (String(url).includes('/api/search')) return Response.json([{ trackName: 'Song', artistName: 'Artist', duration: 180, syncedLyrics: LRC }]);
    return new Response('no', { status: 404 });
  });
  const { getLyrics } = await import('../server/lyrics.mjs');
  const r = await getLyrics({ title: 'Song', artist: 'Artist', durationMs: 180000 });
  expect(r.found).toBe(true);
  expect(r.synced).toHaveLength(5);
  const none = await getLyrics({ title: 'Nope', artist: 'Nobody', durationMs: 1000 }).catch((e) => e);
  expect(none.found === false || none instanceof Error).toBe(true);
});
