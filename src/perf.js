import { useEffect, useState } from 'react';
import { TERRAIN_SPEC } from './mapStyles.js';

// Smooth experience on every Mac: the app watches its own frame rate while the globe
// moves. If it struggles, it switches to "smooth" quality (sharpness, 3D terrain,
// background blur and star count go down; everything still works). You can also pick
// "smooth" or "quality" yourself.

const KEY = 'perfMode'; // 'auto' | 'smooth' | 'quality'
const subs = new Set();
let mode = read();
let autoLevel = 'quality'; // what auto decided
let map = null;

function read() {
  try {
    const m = localStorage.getItem(KEY);
    return ['auto', 'smooth', 'quality'].includes(m) ? m : 'auto';
  } catch {
    return 'auto';
  }
}

export const getQuality = () => (mode === 'auto' ? autoLevel : mode);
export const getPerfMode = () => mode;

function emit() {
  const q = getQuality();
  if (typeof document !== 'undefined') document.body.classList.toggle('perf-smooth', q === 'smooth');
  applyToMap();
  subs.forEach((fn) => fn({ mode, quality: q }));
}

export function setPerfMode(m) {
  mode = m;
  try {
    localStorage.setItem(KEY, m);
  } catch {}
  emit();
}

export function usePerf() {
  const [s, set] = useState({ mode, quality: getQuality() });
  useEffect(() => {
    subs.add(set);
    set({ mode, quality: getQuality() });
    return () => subs.delete(set);
  }, []);
  return s;
}

// Sharpness: full on Retina in quality mode, a little softer in smooth mode
export function pixelRatioFor(q, dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) {
  return q === 'smooth' ? Math.min(dpr, 1.25) : Math.min(dpr, 2);
}

function applyToMap() {
  if (!map) return;
  const q = getQuality();
  try {
    map.setPixelRatio(pixelRatioFor(q));
  } catch {}
  try {
    if (map.getSource('dem')) map.setTerrain(q === 'smooth' ? null : TERRAIN_SPEC);
    if (map.getLayer('relief')) map.setLayoutProperty('relief', 'visibility', q === 'smooth' ? 'none' : 'visible');
  } catch {}
}

// Decide from real frame times: only while the globe is moving (idle frames don't count)
export function createFpsJudge({ slowFps = 38, fastFps = 55, windowMs = 2500 } = {}) {
  let frames = 0;
  let movingMs = 0;
  return {
    frame(dtMs, moving) {
      if (!moving || dtMs > 250) return null; // paused tab or a one-off hitch: ignore
      frames += 1;
      movingMs += dtMs;
      if (movingMs < windowMs) return null;
      const fps = (frames * 1000) / movingMs;
      frames = 0;
      movingMs = 0;
      if (fps < slowFps) return 'smooth';
      if (fps > fastFps) return 'quality';
      return null;
    },
  };
}

export function attachPerf(theMap) {
  map = theMap;
  emit();
  const reapply = () => applyToMap();
  theMap.on('style.load', reapply); // switching satellite/dark rebuilds layers
  const judge = createFpsJudge();
  let last = performance.now();
  let raf = 0;
  let calmSince = 0;
  let strikes = 0; // how many times it had to step down
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const dt = now - last;
    last = now;
    if (mode !== 'auto') return;
    const verdict = judge.frame(dt, theMap.isMoving());
    if (verdict === 'smooth' && autoLevel !== 'smooth') {
      autoLevel = 'smooth';
      calmSince = now;
      strikes += 1;
      emit();
    } else if (verdict === 'quality' && autoLevel === 'smooth' && strikes < 2 && now - calmSince > 60000) {
      // try full quality once more after a calm minute; if it struggles again, stay smooth
      // only step back up after a minute of easy running, so it doesn't flicker
      autoLevel = 'quality';
      emit();
    }
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    theMap.off('style.load', reapply);
    map = null;
  };
}
