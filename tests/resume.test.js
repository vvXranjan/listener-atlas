import { it, expect, vi, beforeEach } from 'vitest';

const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem: (k) => delete store[k] };
globalThis.window = { addEventListener: vi.fn(), removeEventListener: vi.fn() };

let pb = null;
let devices = [];
const calls = [];
vi.mock('../src/spotify.js', () => ({
  isLoggedIn: () => true,
  canQueue: () => true,
  playback: async () => pb,
  listDevices: async () => devices,
  playUris: async (uris, o) => calls.push(['play', uris[0], o.deviceId, o.positionMs]),
  resumePlayback: async (id) => calls.push(['resume', id]),
  recentPlays: async () => [{ uri: 'spotify:track:recent' }],
}));
vi.mock('../src/spotifyPlayer.js', () => ({ ensureDevice: async () => 'tab' }));
vi.mock('../src/nowStore.js', () => ({ onNow: () => () => {} }));

beforeEach(() => {
  calls.length = 0;
  vi.resetModules();
});

it('starts a little before where you were, or from the top if it was nearly over', async () => {
  const { startAt } = await import('../src/resume.js');
  expect(startAt({ positionMs: 60000, durationMs: 200000 })).toBe(58000);
  expect(startAt({ positionMs: 196000, durationMs: 200000 })).toBe(0);
  expect(startAt(null)).toBe(0);
});

it('presses play on a paused Spotify app', async () => {
  pb = { is_playing: false, device: { id: 'mac', name: 'MacBook' }, item: {} };
  const { resumeOnOpen } = await import('../src/resume.js');
  expect(await resumeOnOpen()).toBe('resumed');
  expect(calls).toEqual([['resume', 'mac']]);
});

it('no active player: plays your last song on an open Spotify app', async () => {
  pb = null;
  devices = [{ id: 'phone', type: 'Smartphone' }, { id: 'mac', type: 'Computer' }];
  store['last-spotify-song-v1'] = JSON.stringify({ uri: 'spotify:track:last', positionMs: 30000, durationMs: 200000 });
  const { resumeOnOpen } = await import('../src/resume.js');
  expect(await resumeOnOpen()).toBe('played');
  expect(calls).toEqual([['play', 'spotify:track:last', 'mac', 28000]]);
});

it('leaves music alone if it is already playing, and respects the switch', async () => {
  pb = { is_playing: true };
  let m = await import('../src/resume.js');
  expect(await m.resumeOnOpen()).toBe('already');
  vi.resetModules();
  m = await import('../src/resume.js');
  m.setResumeOn(false);
  expect(await m.resumeOnOpen()).toBe('off');
  m.setResumeOn(true);
  expect(calls).toEqual([]);
});

it('no Spotify app open anywhere: waits for your first tap, then plays here', async () => {
  pb = null;
  devices = [];
  const { resumeOnOpen } = await import('../src/resume.js');
  const onNeedTap = vi.fn();
  expect(await resumeOnOpen({ onNeedTap })).toBe('waiting');
  expect(onNeedTap).toHaveBeenCalled();
  const go = window.addEventListener.mock.calls.at(-1)[1];
  await go();
  expect(calls.at(-1)).toEqual(['play', 'spotify:track:last', 'tab', 28000]);
});
