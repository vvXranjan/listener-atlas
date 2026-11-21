import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v), removeItem: (k) => delete store[k] };
const queued = [];
vi.mock('../src/spotify.js', () => ({
  isLoggedIn: () => true,
  canQueue: () => true,
  getQueue: vi.fn(async () => ({ queue: [] })),
  queueUri: vi.fn(async (u) => queued.push(u)),
  findTrackUri: vi.fn(async (t) => ({ uri: `spotify:track:${t}` })),
}));
vi.mock('../src/autoDj.js', () => ({ autoDjState: () => ({ on: false }) }));
globalThis.fetch = vi.fn(async () =>
  Response.json({ picks: [{ title: 'Pick A', artist: 'X', match: 80 }], pool: [{ title: 'Pick B', artist: 'Y', match: 70 }, { title: 'Pick C', artist: 'Z', match: 60 }] })
);

const { getSet, saveSet, getPlayed, setPref } = await import('../src/setStore.js');
const { setNow } = await import('../src/nowStore.js');
const { startSetSync, dropPlayed } = await import('../src/setSync.js');
const track = (id, name, artist) => ({ id, name, artists: [{ name: artist }] });

describe('Your set stays in sync with Spotify', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    queued.length = 0;
  });

  it('drops songs once they play (and anything skipped before them)', () => {
    saveSet([{ title: 'HUMBLE.', artist: 'Kendrick Lamar' }, { title: "God's Plan", artist: 'Drake' }, { title: 'SICKO MODE', artist: 'Travis Scott' }]);
    dropPlayed(track('g', "God's Plan", 'Drake'));
    expect(getSet().map((s) => s.title)).toEqual(['SICKO MODE']);
    expect(getPlayed().map((s) => s.title)).toEqual(["God's Plan", 'HUMBLE.']);
    expect(dropPlayed(track('z', 'Not in set', 'Nobody'))).toBe(false);
  });

  it('fills up to 3 songs and keeps Spotify\'s queue one step ahead', async () => {
    vi.useFakeTimers();
    setPref('autoFill', true);
    setPref('syncQueue', true);
    saveSet([{ title: 'Song 1', artist: 'Me' }]);
    startSetSync();
    setNow({ track: track('now', 'Current', 'Someone') });
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 50));
    const titles = getSet().map((s) => s.title);
    expect(titles).toHaveLength(3);
    expect(titles[0]).toBe('Song 1');
    expect(getSet()[1].auto).toBe(true);
    expect(queued).toEqual(['spotify:track:Song 1']); // only the next song, once
  });
});
