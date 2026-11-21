import { describe, it, expect, vi } from 'vitest';
import { everyWhileVisible } from '../src/visibility.js';

describe('Polling only while you look', () => {
  it('runs on a timer when visible, pauses when hidden, catches up on return', async () => {
    vi.useFakeTimers();
    const listeners = {};
    globalThis.document = { hidden: false, addEventListener: (e, f) => (listeners[e] = f), removeEventListener: () => {} };
    const fn = vi.fn();
    const stop = everyWhileVisible(fn, 1000);
    expect(fn).toHaveBeenCalledTimes(1); // right away
    await vi.advanceTimersByTimeAsync(3000);
    expect(fn).toHaveBeenCalledTimes(4);
    document.hidden = true;
    listeners.visibilitychange();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fn).toHaveBeenCalledTimes(4); // paused in a background tab
    document.hidden = false;
    listeners.visibilitychange();
    expect(fn).toHaveBeenCalledTimes(5); // fresh data as soon as you come back
    stop();
    vi.useRealTimers();
  });
});
