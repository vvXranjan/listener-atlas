import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    pb = { ...pb, uri: uris[0], positionMs: o.positionMs, durationMs: 200000, isPlaying: true };
  }),
}));

const { startAutoDj, stopAutoDj, mixNow, autoDjState } = await import('../src/autoDj.js');
const set = [{ title: 'A', artist: 'x' }, { title: 'B', artist: 'y' }];

describe('Auto-DJ', () => {
  beforeEach(() => {
    log.length = 0;
    vi.useFakeTimers();
    pb = { uri: 'spotify:track:NOW', name: 'Now', positionMs: 0, durationMs: 60000, isPlaying: true, volume: 70, supportsVolume: true, deviceId: 'mac' };
  });

  it('lets the current song play, then fades into song 1 near its end', async () => {
    await startAutoDj(set, { fadeOutMs: 7000, fadeInMs: 4000 });
    await vi.advanceTimersByTimeAsync(3100);
    expect(log.filter((l) => l[0] === 'play')).toHaveLength(0); // still far from the end
    pb.positionMs = 53000; // 7s left
    await vi.advanceTimersByTimeAsync(1600);
    await vi.runOnlyPendingTimersAsync();
    expect(log[0]).toEqual(['fade', 70, 8]); // fade out to ~12%
    expect(log[1]).toEqual(['play', 'spotify:track:A,spotify:track:B', 0]);
    expect(log[2]).toEqual(['fade', 8, 70]); // fade back in
    await stopAutoDj();
  });

  it('"Mix to next now" works from anywhere in the song, and stops if you change the song', async () => {
    pb.isPlaying = false; // nothing playing: starts song 1 straight away
    const started = startAutoDj(set, { skipIntroMs: 15000 });
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    expect(log.find((l) => l[0] === 'play')).toEqual(['play', 'spotify:track:A,spotify:track:B', 15000]);
    log.length = 0;
    pb.positionMs = 40000;
    const m = mixNow();
    await vi.advanceTimersByTimeAsync(1000);
    await m;
    expect(log.find((l) => l[0] === 'play')).toEqual(['play', 'spotify:track:B', 15000]);
    expect(autoDjState().on).toBe(true);
    pb.uri = 'spotify:track:SOMETHING_ELSE'; // you picked another song yourself
    await vi.advanceTimersByTimeAsync(1600);
    expect(autoDjState().on).toBe(false);
    expect(autoDjState().status).toMatch(/changed the song/);
  });
});
