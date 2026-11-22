// Transition modes for Auto-DJ, and the "AI" that picks one for each pair of songs.
//
// Spotify plays one song at a time on a device, so a transition is shaped with what Spotify lets
// us control: the volume curve, how long each fade takes, a short gap, a beat-timed "echo" fade,
// and where the next song starts. In Auto mode the plan is chosen per transition from the measured
// tempo, key and energy of both songs (measured from their previews, in the background).
import { tempoGap, keyScore } from './audioAnalysis.js';

export const MODES = [
  { id: 'auto', icon: '🤖', label: 'AI auto', desc: 'Picks the best transition for each pair, from tempo, key and energy.' },
  { id: 'smooth', icon: '🌊', label: 'Smooth', desc: 'Long, gentle blend: 12 s fade out, 8 s fade in.' },
  { id: 'quick', icon: '⚡', label: 'Quick cut', desc: 'Fast switch in under 2 s. Best for big tempo jumps.' },
  { id: 'echo', icon: '🔁', label: 'Echo out', desc: 'Volume steps down on the beat for 8 beats, then the next song hits.' },
  { id: 'hype', icon: '🔥', label: 'Hype', desc: 'Short fade, next song starts past its intro (about 20 s in).' },
  { id: 'chill', icon: '🌙', label: 'Chill', desc: 'Very slow fade, a breath of silence, slow fade in.' },
];
export const modeInfo = (id) => MODES.find((m) => m.id === id) || MODES[0];

const BASE = {
  smooth: { fadeOutMs: 12000, fadeInMs: 8000, lowPct: 0.1, gapMs: 0, startAtMs: 0 },
  quick: { fadeOutMs: 1500, fadeInMs: 300, lowPct: 0.3, gapMs: 0, startAtMs: 0 },
  echo: { fadeOutMs: 0, fadeInMs: 1200, lowPct: 0.08, gapMs: 250, startAtMs: 0, beats: 8 },
  hype: { fadeOutMs: 3500, fadeInMs: 800, lowPct: 0.2, gapMs: 0, startAtMs: 20000 },
  chill: { fadeOutMs: 14000, fadeInMs: 12000, lowPct: 0.05, gapMs: 700, startAtMs: 0 },
  medium: { fadeOutMs: 7000, fadeInMs: 4500, lowPct: 0.12, gapMs: 0, startAtMs: 0 },
};

// beat length for the echo fade; falls back to 95 BPM
const beatMs = (bpm) => {
  let b = Number(bpm) || 95;
  while (b > 160) b /= 2;
  while (b < 70) b *= 2;
  return 60000 / b;
};

function build(kind, from, why, extra = {}) {
  const p = { ...BASE[kind], ...extra };
  if (kind === 'echo') {
    p.beatMs = beatMs(from?.bpm);
    p.fadeOutMs = Math.round(p.beatMs * p.beats);
  }
  const shown = kind === 'medium' ? 'smooth' : kind;
  const m = modeInfo(shown);
  return { kind: shown, icon: m.icon, label: m.label, why, ...p };
}

// The plan for one transition. from/to: { bpm, key: { camelot }, energy } (any may be missing)
export function planTransition(mode, from = {}, to = {}) {
  if (mode && mode !== 'auto') return build(mode, from, modeInfo(mode).desc);

  const g = tempoGap(from?.bpm, to?.bpm);
  const k = keyScore(from?.key?.camelot, to?.key?.camelot);
  const dE = from?.energy != null && to?.energy != null ? to.energy - from.energy : null;
  const ai = (kind, why, extra) => ({ ...build(kind, from, why, extra), auto: true });

  if (g == null && k == null && dE == null) return ai('medium', 'No audio info yet, so a safe 7 s blend');
  if (g != null && g > 12) {
    return from?.bpm ? ai('echo', `Big tempo jump (${Math.round(g)}%): echo out on the beat, then drop in`) : ai('quick', `Big tempo jump (${Math.round(g)}%): quick cut`);
  }
  if (dE != null && dE > 15) return ai('hype', 'Energy goes up: short fade, start past the intro');
  if (k != null && k < 0.5) return ai('quick', 'Keys clash: a quick switch so they don\'t overlap', { fadeOutMs: 2500, fadeInMs: 600 });
  if (dE != null && dE < -15) return ai('chill', 'Energy drops: slow fade with a breath in between');
  if ((g == null || g <= 4) && (k == null || k >= 0.85)) return ai('smooth', 'Tempos and keys match: long smooth blend');
  return ai('medium', 'Close tempo and key: a 7 s blend');
}

// one short line for the screen
export const planText = (p) => (p ? `${p.icon} ${p.label}${p.auto ? ' (AI)' : ''} · ${p.why}` : '');
