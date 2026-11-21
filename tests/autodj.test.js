import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v), removeItem: (k) => delete store[k] };

const log = [];
let pb; // fake "what Spotify is playing"
vi.mock('../src/spotifyPlayer.js', () => ({
  ensureDevice: vi.fn(async () => 'mac'),
  currentPlayback: vi.fn(async () => (pb ? { ...pb } : null)),
  fadeVolume: vi.fn(async (from, to) => {
    log.push(['fade', Math.round(from), Math.round(to)]);
    return true;
  }),
}));
vi.mock('../src/spotify.js', () => ({
  findTrackUri: vi.fn(async (t) => ({ uri: `spotify:track:${t}` })),
  playUris: vi.fn(async (uris, o) => {
    log.push(['play', uris.join(','), o.positionMs]);
    const title = uris[0].split(':').pop();
    pb = { ...pb, uri: uris[0], name: title, artist: 'x', positionMs: o.positionMs, durationMs: 200000, isPlaying: true };
  }),
}));

const { startAutoDj, stopAutoDj, mixNow, resumeSet, autoDjState, nextInSet } = await import('../src/autoDj.js');
const { saveSet, getSet } = await import('../src/setStore.js');
const song = (t) => ({ title: t, artist: 'x' });
const plays = () => log.filter((l) => l[0] === 'play').map((l) => l[1]);

describe('Auto-DJ stays in sync with your set and Spotify', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    log.length = 0;
    vi.useFakeTimers();
    pb = { uri: 'spotify:track:NOW', name: 'NOW', artist: 'someone', positionMs: 0, durationMs: 60000, isPlaying: true, volume: 70, supportsVolume: true, deviceId: 'mac' };
  });
  afterEach(async () => {
    await stopAutoDj();
    vi.useRealTimers();
  });

  it('follows your live set: songs you add or reorder after starting are used', async () => {
    saveSet([song('A'), song('B')]);
    await startAutoDj({ fadeOutMs: 7000 });
    saveSet([song('C'), song('A'), song('B')]); // you changed the set while it runs
    pb.positionMs = 53000; // 7 s left of the current song
    await vi.advanceTimersByTimeAsync(3000);
    expect(plays()[0]).toBe('spotify:track:C,spotify:track:A,spotify:track:B');
    expect(log[0]).toEqual(['fade', 70, 8]); // faded out first
  });

  it('skips a stray song from the Spotify queue and goes back to your set', async () => {
    saveSet([song('A'), song('B')]);
    pb.isPlaying = false;
    const start = startAutoDj({});
    await vi.advanceTimersByTimeAsync(1000);
    await start;
    expect(plays()[0]).toBe('spotify:track:A,spotify:track:B');
    // A is near its end, then Spotify plays something from its own queue
    pb.positionMs = pb.durationMs - 9000;
    pb.isPlaying = false; // (we "missed" the end, e.g. tab in background)
    await vi.advanceTimersByTimeAsync(1100);
    pb = { ...pb, uri: 'spotify:track:OLDQUEUE', name: 'Old queued song', positionMs: 1000, isPlaying: true };
    await vi.advanceTimersByTimeAsync(2500);
    expect(plays().at(-1)).toBe('spotify:track:B'); // back on the set: B, the song after A
    expect(autoDjState().skipped).toBe(1);
    expect(autoDjState().on).toBe(true);
  });

  it('pauses when you pick your own song mid-way, and resumes the set on request', async () => {
    saveSet([song('A'), song('B')]);
    pb.isPlaying = false;
    const start = startAutoDj({});
    await vi.advanceTimersByTimeAsync(1000);
    await start;
    pb.positionMs = 30000; // middle of A
    await vi.advanceTimersByTimeAsync(1100);
    pb = { ...pb, uri: 'spotify:track:MINE', name: 'My pick', positionMs: 0 };
    await vi.advanceTimersByTimeAsync(1100);
    expect(autoDjState().paused).toBe(true);
    expect(plays()).toHaveLength(1); // it did not fight you
    const r = resumeSet();
    await vi.advanceTimersByTimeAsync(5000);
    await r;
    expect(autoDjState().paused).toBe(false);
    expect(plays().at(-1)).toBe('spotify:track:A,spotify:track:B');
  });

  it('"Mix to next now" uses the song after the one playing', async () => {
    saveSet([song('A'), song('B'), song('C')]);
    pb = { ...pb, uri: 'spotify:track:B', name: 'B', artist: 'x' };
    await startAutoDj({});
    const m = mixNow();
    await vi.advanceTimersByTimeAsync(5000);
    await m;
    expect(plays().at(-1)).toBe('spotify:track:C');
    expect(nextInSet({ uri: 'zzz', name: 'zzz', artist: 'q' }, getSet())).toMatchObject({ title: 'A' });
  });
});
