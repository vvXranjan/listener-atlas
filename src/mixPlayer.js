import { useEffect, useState } from 'react';
import { stopPreview, stopOthers } from './player.js';
import { tempoGap } from './audioAnalysis.js';
import { setAppAudio } from './spotifyPlayer.js';

// "Hear the transition": plays the end of song A, then fades into song B
// like a DJ would. If the tempos are close (within 8%), song B is sped up
// or slowed down to match, without changing its pitch.

const A_START = 12; // seconds into A's preview
const A_SOLO = 7; // A plays alone this long
const FADE = 6; // crossfade length
const B_SOLO = 8; // B plays alone after the fade

let state = null; // { id, phase }
const subs = new Set();
const emit = () => subs.forEach((fn) => fn(state));
let stopFn = null;

export function stopMix() {
  stopFn?.();
  stopFn = null;
  state = null;
  setAppAudio('mix', false);
  emit();
}
stopOthers.add(stopMix);

function rateFor(fromBpm, toBpm) {
  if (!fromBpm || !toBpm) return 1;
  const g = tempoGap(fromBpm, toBpm);
  if (g == null || g > 8) return 1;
  // match B to A, allowing half/double time
  const best = [0.5, 1, 2].map((m) => fromBpm / (toBpm * m)).sort((x, y) => Math.abs(x - 1) - Math.abs(y - 1))[0];
  return Math.max(0.92, Math.min(1.08, best));
}

export function playMix(id, from, to) {
  stopMix();
  stopPreview();
  if (!from?.preview || !to?.preview) return;
  const a = new Audio(from.preview);
  const b = new Audio(to.preview);
  const rate = rateFor(from.bpm, to.bpm);
  b.playbackRate = rate;
  b.preservesPitch = true;
  b.mozPreservesPitch = true;
  b.webkitPreservesPitch = true;
  a.volume = 0.85;
  b.volume = 0;
  let raf = 0;
  let t0 = 0;
  let bStarted = false;
  let alive = true;

  const tick = () => {
    if (!alive) return;
    const t = (performance.now() - t0) / 1000;
    if (t < A_SOLO) {
      state = { id, phase: 'a', progress: t / (A_SOLO + FADE + B_SOLO), rate };
    } else if (t < A_SOLO + FADE) {
      if (!bStarted) {
        bStarted = true;
        b.play().catch(() => {});
      }
      const x = (t - A_SOLO) / FADE;
      // equal-power fade sounds smoother than a straight line
      a.volume = 0.85 * Math.cos((x * Math.PI) / 2);
      b.volume = 0.85 * Math.sin((x * Math.PI) / 2);
      state = { id, phase: 'fade', progress: t / (A_SOLO + FADE + B_SOLO), rate };
    } else if (t < A_SOLO + FADE + B_SOLO) {
      a.pause();
      b.volume = 0.85;
      state = { id, phase: 'b', progress: t / (A_SOLO + FADE + B_SOLO), rate };
    } else {
      stopMix();
      return;
    }
    emit();
    raf = requestAnimationFrame(tick);
  };

  stopFn = () => {
    alive = false;
    cancelAnimationFrame(raf);
    a.pause();
    b.pause();
    a.src = '';
    b.src = '';
  };

  setAppAudio('mix', true);
  state = { id, phase: 'loading', progress: 0, rate };
  emit();
  const start = () => {
    try {
      a.currentTime = A_START;
    } catch {
      /* not seekable yet */
    }
    a.play()
      .then(() => {
        t0 = performance.now();
        raf = requestAnimationFrame(tick);
      })
      .catch(() => stopMix());
  };
  b.preload = 'auto';
  if (a.readyState >= 1) start();
  else a.addEventListener('loadedmetadata', start, { once: true });
}

export function useMix() {
  const [s, set] = useState(state);
  useEffect(() => {
    subs.add(set);
    return () => subs.delete(set);
  }, []);
  return s;
}
