import { describe, it, expect, vi } from 'vitest';

const calls = [];
vi.mock('../src/spotify.js', () => ({
  accessToken: vi.fn(),
  canQueue: () => true,
  canStream: () => true,
  isLoggedIn: () => true,
  playback: vi.fn(async () => ({ is_playing: true, device: { id: 'mac', volume_percent: 70 } })),
  pausePlayback: vi.fn(async (id) => calls.push(['pause', id])),
  resumePlayback: vi.fn(async (id) => calls.push(['resume', id])),
  transferTo: vi.fn(),
  listDevices: vi.fn(async () => []),
  findTrackUri: vi.fn(async () => ({ uri: 'spotify:track:x', name: '5% TINT' })),
  playUris: vi.fn(async (uris, o) => calls.push(['play', uris[0], o.deviceId])),
  setDeviceVolume: vi.fn(async (v) => calls.push(['vol', Math.round(v)])),
}));

describe('Your Spotify + app audio', () => {
  it('finds an idle Spotify app when nothing is playing', async () => {
    const sp = await import('../src/spotify.js');
    sp.playback.mockResolvedValueOnce(null);
    sp.listDevices.mockResolvedValueOnce([
      { id: 'phone', type: 'Smartphone', is_active: false },
      { id: 'mac', type: 'Computer', is_active: false },
    ]);
    const { ensureDevice } = await import('../src/spotifyPlayer.js');
    expect(await ensureDevice()).toBe('mac');
  });

  it('pauses Spotify once while previews play, resumes the same device after', async () => {
    vi.useFakeTimers();
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    const { setAppAudio } = await import('../src/spotifyPlayer.js');
    setAppAudio('preview', true);
    setAppAudio('fx', true); // second sound: no second pause
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toEqual([['pause', 'mac']]);
    setAppAudio('preview', false);
    setAppAudio('fx', false);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(1); // waits a moment before resuming
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual([['pause', 'mac'], ['resume', 'mac']]);
    vi.useRealTimers();
  });

  it('"Mix into it" fades down, plays the new song, fades back up', async () => {
    calls.length = 0;
    const { mixOnSpotify } = await import('../src/spotifyPlayer.js');
    vi.useFakeTimers();
    const p = mixOnSpotify('5% TINT', 'Travis Scott');
    await vi.runAllTimersAsync();
    expect(await p).toBe('5% TINT');
    vi.useRealTimers();
    const play = calls.findIndex((c) => c[0] === 'play');
    expect(calls[play]).toEqual(['play', 'spotify:track:x', 'mac']);
    expect(calls[play - 1]).toEqual(['vol', 14]); // faded to 20% of 70
    expect(calls.at(-1)).toEqual(['vol', 70]); // back to where it was
  });
});
