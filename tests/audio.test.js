import { describe, it, expect } from 'vitest';
import {
  detectBpm, detectKey, detectEnergy, keyScore, tempoGap, tempoScore, transitionScore, transitionTip,
} from '../src/audioAnalysis.js';

const SR = 22050;

// kick-like clicks at a given tempo, with a little noise
function clicks(bpm, seconds = 20) {
  const out = new Float32Array(SR * seconds);
  const every = (60 / bpm) * SR;
  for (let t = 0; t < out.length; t += every) {
    const s = Math.round(t);
    for (let i = 0; i < 800 && s + i < out.length; i++) {
      out[s + i] += Math.sin((2 * Math.PI * 60 * i) / SR) * Math.exp(-i / 150) * 0.8;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] += (Math.random() - 0.5) * 0.01;
  return out;
}

// a held chord made of sine tones (MIDI note numbers)
function chord(midis, seconds = 6) {
  const out = new Float32Array(SR * seconds);
  for (const m of midis) {
    const f = 440 * 2 ** ((m - 69) / 12);
    for (let i = 0; i < out.length; i++) out[i] += Math.sin((2 * Math.PI * f * i) / SR) * 0.2;
  }
  return out;
}

describe('Mix Lab audio analysis', () => {
  it('finds the tempo of a click track', () => {
    for (const bpm of [90, 120, 140]) {
      const got = detectBpm(clicks(bpm), SR);
      expect(tempoGap(bpm, got)).toBeLessThan(3); // exact or half/double time
    }
  });

  it('finds the key of a chord (C major = 8B, A minor = 8A)', () => {
    const cMaj = detectKey(chord([48, 52, 55, 60, 64, 67]), SR);
    expect(cMaj.camelot).toBe('8B');
    const aMin = detectKey(chord([45, 48, 52, 57, 60, 64]), SR);
    expect(aMin.camelot).toBe('8A');
  });

  it('louder audio = more energy', () => {
    const quiet = chord([60], 2).map((v) => v * 0.05);
    const loud = chord([60, 64, 67], 2);
    expect(detectEnergy(loud)).toBeGreaterThan(detectEnergy(quiet));
  });

  it('Camelot rules: same key best, neighbours good, far keys poor', () => {
    expect(keyScore('8A', '8A')).toBe(1);
    expect(keyScore('8A', '8B')).toBe(0.85);
    expect(keyScore('8A', '9A')).toBe(0.9);
    expect(keyScore('12A', '1A')).toBe(0.9); // wheel wraps around
    expect(keyScore('8A', '2B')).toBe(0.3);
  });

  it('half or double time counts as a tempo match', () => {
    expect(tempoGap(140, 70)).toBe(0);
    expect(tempoScore(140, 141)).toBe(1);
    expect(tempoScore(140, 100)).toBeLessThan(0.5);
  });

  it('transition score rewards matching tempo and key', () => {
    const from = { bpm: 140, key: { camelot: '8A' }, energy: 70 };
    const good = transitionScore(from, { match: 70, bpm: 141, key: { camelot: '9A' }, energy: 75 });
    const bad = transitionScore(from, { match: 70, bpm: 100, key: { camelot: '2B' }, energy: 20 });
    expect(good).toBeGreaterThan(bad);
    // no audio info: falls back to the data score only
    expect(transitionScore({}, { match: 60 })).toBe(60);
    expect(transitionTip(from, { bpm: 141, key: { camelot: '8A' }, energy: 72 })).toMatch(/Tempos already match, keys blend smoothly/);
  });
});
