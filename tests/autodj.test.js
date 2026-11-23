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
let spotifyQueue = []; // fake Spotify queue
vi.mock('../src/spotify.js', () => ({
  getQueue: vi.fn(async () => ({ queue: spotifyQueue.map((t) => ({ title: t, artist: 'x', uri: `spotify:track:${t}` })) })),
  seekTo: vi.fn(async () => {}),
  nextTrack: vi.fn(async () => {
    const t = spotifyQueue.shift();
    log.push(['skip', t]);
    pb = { ...pb, uri: `spotify:track:${t}`, name: t, artist: 'x', positionMs: 0, durationMs: 200000, isPlaying: true };
  }),
  queueUri: vi.fn(),
  isLoggedIn: () => true,
  canQueue: () => true,
  canLibrary: () => false,
  accessToken: vi.fn(),
  recentPlays: vi.fn(async () => []),
  findTrackUri: vi.fn(async (t) => ({ uri: `spotify:track:${t}` })),
  playUris: vi.fn(async (uris, o) => {
    log.push(['play', uris.join(','), o.positionMs]);
    const title = uris[0].split(':').pop();
    pb = { ...pb, uri: uris[0], name: title, artist: 'x', positionMs: o.positionMs, durationMs: 200000, isPlaying: true };
  }),
}));

const { startAutoDj, stopAutoDj, mixNow, resumeSet, autoDjState, nextInSet, newlyQueued } = await import('../src/autoDj.js');
const { saveSet, getSet } = await import('../src/setStore.js');
await import('../src/setSync.js'); // radio mode loads this on demand; load it up front for the frozen test clock
const song = (t) => ({ title: t, artist: 'x' });
const plays = () => log.filter((l) => l[0] === 'play').map((l) => l[1]);

describe('Auto-DJ stays in sync with your set and Spotify', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    log.length = 0;
    spotifyQueue = [];
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
    await vi.advanceTimersByTimeAsync(2200);
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

  it('a song you queue from your phone plays next (via Spotify\'s queue), then the set continues', async () => {
    saveSet([song('A'), song('B')]);
    spotifyQueue = ['OLD']; // already in the queue before Auto-DJ: "old"
    pb.isPlaying = false;
    const start = startAutoDj({});
    await vi.advanceTimersByTimeAsync(1000);
    await start;
    spotifyQueue = ['PHONE', 'OLD', 'A', 'B']; // you queued PHONE from your phone
    await vi.advanceTimersByTimeAsync(5500);
    expect(getSet().map((s) => s.title)).toEqual(['A', 'PHONE', 'B']);
    expect(getSet()[1].queued).toBe(true);
    expect(autoDjState().queuedByYou).toBe(1);
    pb.positionMs = pb.durationMs - 7000; // A ends: skip into PHONE, no second copy
    await vi.advanceTimersByTimeAsync(4000);
    expect(log.filter((l) => l[0] === 'skip')).toEqual([['skip', 'PHONE']]);
    expect(plays()).toHaveLength(1); // only the first start used a play list
  });

  it('radio: when the set runs out it adds the best next song and keeps going', async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ picks: [{ title: 'RADIO1', artist: 'x', match: 90 }], pool: [] })
    );
    saveSet([song('A')]);
    pb.isPlaying = false;
    const start = startAutoDj({});
    await vi.advanceTimersByTimeAsync(1000);
    await start;
    await vi.advanceTimersByTimeAsync(2500);
    expect(getSet().map((s) => s.title)).toEqual(['A', 'RADIO1']); // added by radio
    expect(getSet()[1].auto).toBe(true);
    pb.positionMs = pb.durationMs - 7000;
    await vi.advanceTimersByTimeAsync(4000);
    expect(plays().at(-1)).toBe('spotify:track:RADIO1'); // and it plays it
  });

  it('a song you queue mid-song plays next even if it was already in your old queue/playlist', async () => {
    saveSet([song('A'), song('B'), song('C')]);
    spotifyQueue = ['X', 'Y', 'Z']; // the playlist you had on before (X is in it)
    pb.isPlaying = false;
    const start = startAutoDj({});
    await vi.advanceTimersByTimeAsync(1000);
    await start;
    spotifyQueue = ['B', 'C']; // Auto-DJ's list replaced the old playlist
    await vi.advanceTimersByTimeAsync(5500);
    spotifyQueue = ['X', 'B', 'C']; // mid-song you queue X from your phone
    await vi.advanceTimersByTimeAsync(5500);
    expect(getSet().map((s) => s.title)).toEqual(['A', 'X', 'B', 'C']);
    pb.positionMs = pb.durationMs - 7000; // A ends: X plays, not B
    await vi.advanceTimersByTimeAsync(4000);
    expect(log.filter((l) => l[0] === 'skip')).toEqual([['skip', 'X']]);
    expect(pb.name).toBe('X');
    pb.positionMs = pb.durationMs - 7000; // X ends: back to the set at B
    await vi.advanceTimersByTimeAsync(4000);
    expect(plays().at(-1)).toBe('spotify:track:B,spotify:track:C');
  });

  it('if Spotify plays your queued song on its own, Auto-DJ keeps it instead of skipping', async () => {
    saveSet([song('A'), song('B')]);
    pb.isPlaying = false;
    const start = startAutoDj({});
    await vi.advanceTimersByTimeAsync(1000);
    await start;
    spotifyQueue = ['B'];
    await vi.advanceTimersByTimeAsync(5500);
    pb.positionMs = pb.durationMs - 9000;
    pb.isPlaying = false; // we missed the end (tab asleep)
    spotifyQueue = ['X', 'B']; // you queued X
    await vi.advanceTimersByTimeAsync(3100);
    pb = { ...pb, uri: 'spotify:track:X', name: 'X', artist: 'x', positionMs: 1000, isPlaying: true };
    spotifyQueue = ['B'];
    await vi.advanceTimersByTimeAsync(1100);
    expect(autoDjState().skipped).toBe(0);
    expect(autoDjState().paused).toBe(false);
    expect(getSet().map((s) => s.title)).toEqual(['A', 'X', 'B']);
    expect(nextInSet(pb).title).toBe('B');
  });

  it('newlyQueued ignores the playlist scrolling on and autoplay batches', () => {
    const q = (...ids) => ids.map((u) => ({ uri: u }));
    const prev = new Map([['p1', 1], ['p2', 1], ['p3', 1]]);
    expect(newlyQueued(q('p2', 'p3', 'p4'), prev, new Set()).fresh).toEqual([]); // p4 appeared at the end
    expect(newlyQueued(q('n', 'p2', 'p3', 'p4'), prev, new Set()).fresh.map((t) => t.uri)).toEqual(['n']);
    expect(newlyQueued(q('a1', 'a2', 'a3', 'a4', 'a5'), new Map(), new Set(['s'])).fresh).toEqual([]); // autoplay
  });

  it('Echo out mode steps the volume down on the beat, then the next song comes in', async () => {
    const { setPref } = await import('../src/setStore.js');
    setPref('djMode', 'echo');
    saveSet([song('A'), song('B')]);
    pb.isPlaying = false;
    const start = startAutoDj({});
    await vi.advanceTimersByTimeAsync(1000);
    await start;
    log.length = 0;
    pb.positionMs = pb.durationMs - 5000; // echo at 95 BPM ≈ 5 s
    await vi.advanceTimersByTimeAsync(9000);
    const fades = log.filter((l) => l[0] === 'fade');
    expect(fades.length).toBeGreaterThanOrEqual(8); // one step per beat (+ gap + fade in)
    expect(fades[1][1]).toBeLessThan(fades[0][1]); // going down step by step
    expect(plays().at(-1)).toBe('spotify:track:B');
    expect(autoDjState().plan.kind).toBe('echo');
    setPref('djMode', 'auto');
  });

  it('a song you queue in the last seconds (even during the fade) still plays next', async () => {
    const { setPref } = await import('../src/setStore.js');
    setPref('djMode', 'smooth'); // 12 s fade
    const sp = await import('../src/spotifyPlayer.js');
    const instant = sp.fadeVolume.getMockImplementation();
    sp.fadeVolume.mockImplementation(async (from, to, ms) => {
      log.push(['fade', Math.round(from), Math.round(to)]);
      await new Promise((r) => setTimeout(r, ms)); // fades take real time here
      return true;
    });
    try {
      saveSet([song('A'), song('B'), song('C')]);
      pb.isPlaying = false;
      const start = startAutoDj({});
      await vi.advanceTimersByTimeAsync(10000); // first song fades in over 8 s
      await start;
      spotifyQueue = ['B', 'C'];
      await vi.advanceTimersByTimeAsync(5500);
      pb.positionMs = pb.durationMs - 13000; // the 12 s fade starts now
      await vi.advanceTimersByTimeAsync(3000);
      expect(autoDjState().mixing).toBe(true);
      spotifyQueue = ['LATE', 'B', 'C']; // you queue a song with ~10 s left, mid-fade
      await vi.advanceTimersByTimeAsync(15000);
      expect(log.filter((l) => l[0] === 'skip')).toEqual([['skip', 'LATE']]); // Spotify's next = your song
      expect(pb.name).toBe('LATE');
      expect(getSet().map((s) => s.title)).toEqual(['A', 'LATE', 'B', 'C']);
      expect(plays()).toHaveLength(1); // no extra play list: B and C still follow
    } finally {
      sp.fadeVolume.mockImplementation(instant);
      setPref('djMode', 'auto');
      await stopAutoDj();
    }
  });

  it('passive start (app opened): does not start music by itself', async () => {
    saveSet([song('A'), song('B')]);
    pb.isPlaying = false;
    await startAutoDj({ passive: true });
    await vi.advanceTimersByTimeAsync(4000);
    expect(plays()).toHaveLength(0);
    expect(autoDjState().on).toBe(true);
  });

  it('always-on: starts with an empty set without stopping, and never starts music itself', async () => {
    saveSet([]);
    pb.isPlaying = false;
    await startAutoDj({ passive: true });
    await vi.advanceTimersByTimeAsync(4000);
    expect(autoDjState().on).toBe(true);
    expect(autoDjState().error).toBe('');
    expect(plays()).toHaveLength(0);
  });
});

