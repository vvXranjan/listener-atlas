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

// Tempo folded into a DJ range (70–160 BPM), so half/double-time reads the same
export const djBpm = (bpm) => {
  let b = Number(bpm);
  if (!b || !isFinite(b) || b <= 0) return null;
  while (b > 160) b /= 2;
  while (b < 70) b *= 2;
  return b;
};
// beat length for the echo fade; falls back to 95 BPM
const beatMs = (bpm) => 60000 / (djBpm(bpm) || 95);

// Transition length in bars, like Spotify Mix (a bar = 4 beats)
export const BAR_CHOICES = ['auto', 1, 2, 4, 8, 16];
export const barsDesc = (b) =>
  b === 'auto' || b == null
    ? 'AI picks the length, then rounds it to whole bars so the fade lands on the beat.'
    : `Every transition lasts exactly ${b} bar${b === 1 ? '' : 's'} (${b * 4} beats) of the playing song.`;
const POW_BARS = [1, 2, 4, 8, 16];
const MAX_FADE_MS = 40000;
// the whole number of bars closest to a length in ms
export function snapBars(ms, barMs) {
  if (!barMs || !ms) return 1;
  let best = 1;
  for (const b of POW_BARS) if (Math.abs(Math.log((b * barMs) / ms)) < Math.abs(Math.log((best * barMs) / ms))) best = b;
  return best;
}
const fmtS = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;

// Fit a plan to whole bars of the outgoing song's tempo.
// bars: 'auto' (AI snaps its own length to the nearest 1/2/4/8/16 bars) or a number you picked.
function fitBars(p, from, to, bars) {
  const bpm = djBpm(from?.bpm);
  if (!bpm) return { ...p, bars: null };
  const barMs = (4 * 60000) / bpm;
  const ratio = p.fadeOutMs ? p.fadeInMs / p.fadeOutMs : 0.6;
  const picked = bars !== 'auto' && bars != null && POW_BARS.includes(Number(bars));
  const out = { ...p, bpm: Math.round(bpm), barMs };
  if (p.kind === 'echo') {
    // echo steps down once per beat: 1 bar = 4 steps (kept between 4 and 16 steps)
    const n = picked ? Number(bars) : 2;
    out.beats = Math.max(4, Math.min(16, n * 4));
    out.bars = out.beats / 4;
    out.fadeOutMs = Math.round(out.beatMs * out.beats);
  } else {
    out.bars = picked ? Number(bars) : snapBars(p.fadeOutMs, barMs);
    while (out.bars > 1 && out.bars * barMs > MAX_FADE_MS) out.bars /= 2; // keep very slow songs sane
    out.fadeOutMs = Math.round(out.bars * barMs);
    // fade in over whole bars of the NEXT song (or the same tempo if it isn't measured yet)
    const toBar = (4 * 60000) / (djBpm(to?.bpm) || bpm);
    const inBars = Math.max(1, snapBars(out.fadeOutMs * ratio, toBar));
    out.fadeInMs = Math.min(Math.round(inBars * toBar), Math.max(300, Math.round(out.fadeOutMs * 1.2)));
  }
  // Hype: start the next song on a phrase line (a multiple of 8 of its bars), near 20 s in
  if (p.startAtMs) {
    const phrase = 8 * ((4 * 60000) / (djBpm(to?.bpm) || bpm));
    out.startAtMs = Math.max(phrase, Math.round(p.startAtMs / phrase) * phrase);
  }
  out.lengthText = `${out.bars} bar${out.bars === 1 ? '' : 's'} · ${fmtS(out.fadeOutMs)} at ${out.bpm} BPM`;
  return out;
}

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
// opts.bars: 'auto' or 1/2/4/8/16 — the transition then lasts exactly that many bars
export function planTransition(mode, from = {}, to = {}, opts = {}) {
  return fitBars(pickPlan(mode, from || {}, to || {}), from, to, opts.bars ?? 'auto');
}
function pickPlan(mode, from, to) {
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
export const planText = (p) => (p ? `${p.icon} ${p.label}${p.auto ? ' (AI)' : ''}${p.lengthText ? ` · ${p.lengthText}` : ''} · ${p.why}` : '');
