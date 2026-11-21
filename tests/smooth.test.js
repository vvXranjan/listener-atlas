import { describe, it, expect } from 'vitest';
import { facing, colorFor, fmt } from '../src/GlobeLayers.jsx';
import { createFpsJudge, pixelRatioFor } from '../src/perf.js';

describe('Smooth globe', () => {
  it('only keeps bars facing you, fading near the edge', () => {
    const pts = [
      { position: [77, 28], listeners: 1 }, // Delhi, in front
      { position: [-74, 40], listeners: 1 }, // New York, far side
      { position: [30, 40], listeners: 1 }, // Istanbul-ish, near the edge
    ];
    const v = facing(pts, [77, 28]);
    expect(v).toHaveLength(2);
    expect(v[0].w).toBe(1);
    expect(v[1].w).toBeGreaterThan(0);
    expect(v[1].w).toBeLessThan(1);
  });

  it('keeps the bar colours and number format', () => {
    expect(colorFor(100, 100)).toEqual([225, 255, 238, 235]);
    expect(fmt(45_100_000)).toBe('45.1M');
    expect(fmt(3_210_000_000)).toBe('3.21B');
  });
});

describe('Adaptive quality', () => {
  it('steps down only when the globe is moving and frames are slow', () => {
    const j = createFpsJudge({ windowMs: 1000 });
    let verdict = null;
    for (let i = 0; i < 40; i++) verdict = j.frame(16, false) || verdict; // idle frames don't count
    expect(verdict).toBe(null);
    for (let i = 0; i < 30; i++) verdict = j.frame(40, true) || verdict; // 25 fps while moving
    expect(verdict).toBe('smooth');
  });

  it('says full quality is fine when frames are fast', () => {
    const j = createFpsJudge({ windowMs: 1000 });
    let verdict = null;
    for (let i = 0; i < 70; i++) verdict = j.frame(16, true) || verdict; // 60 fps
    expect(verdict).toBe('quality');
    expect(j.frame(5000, true)).toBe(null); // a paused tab is ignored
  });

  it('is a little softer in smooth mode on Retina screens', () => {
    expect(pixelRatioFor('quality', 2)).toBe(2);
    expect(pixelRatioFor('smooth', 2)).toBe(1.25);
    expect(pixelRatioFor('smooth', 1)).toBe(1);
  });
});
