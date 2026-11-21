// Mix Lab audio analysis: tempo (BPM), musical key (Camelot) and energy,
// worked out in the browser from a song's 30-second preview.
// The math functions are pure so they can be tested without a browser.

// ---------- tiny FFT (radix-2, in place) ----------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const hann = (n) => Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));

// Magnitude spectra for overlapping frames
function spectra(samples, size, hop) {
  const win = hann(size);
  const out = [];
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  for (let start = 0; start + size <= samples.length; start += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = samples[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
    out.push(mag);
  }
  return out;
}

// ---------- tempo ----------
// Spectral-flux onsets, then autocorrelation; a soft preference for ~120 BPM
// picks between "half" and "double" time when both fit.
export function detectBpm(samples, sampleRate) {
  const size = 1024;
  const hop = 512;
  const frames = spectra(samples, size, hop);
  if (frames.length < 50) return null;
  const fps = sampleRate / hop;
  const hi = Math.floor((4000 / sampleRate) * size); // ignore hiss above 4 kHz
  const env = new Float32Array(frames.length);
  for (let f = 1; f < frames.length; f++) {
    let flux = 0;
    for (let k = 1; k < hi; k++) {
      const d = Math.log1p(frames[f][k]) - Math.log1p(frames[f - 1][k]);
      if (d > 0) flux += d;
    }
    env[f] = flux;
  }
  // remove the slow trend so only the "hits" stay
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  for (let i = 0; i < env.length; i++) env[i] = Math.max(0, env[i] - mean);

  const minLag = Math.floor((60 / 200) * fps);
  const maxLag = Math.ceil((60 / 60) * fps);
  let best = { score: -1, lag: 0 };
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    s /= env.length - lag;
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    scores[lag] = s;
    if (s * prior > best.score) best = { score: s * prior, lag };
  }
  if (!best.lag) return null;
  // sub-frame accuracy (parabolic peak)
  const a = scores[best.lag - 1] ?? scores[best.lag];
  const b = scores[best.lag];
  const c = scores[best.lag + 1] ?? scores[best.lag];
  const shift = a - 2 * b + c ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  const bpm = (60 * fps) / (best.lag + Math.max(-0.5, Math.min(0.5, shift)));
  return Math.round(bpm * 10) / 10;
}

// ---------- key ----------
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
// Camelot wheel numbers for each root (index = pitch class)
const CAM_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAM_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

function corr(x, y) {
  const mx = x.reduce((a, b) => a + b, 0) / 12;
  const my = y.reduce((a, b) => a + b, 0) / 12;
  let n = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < 12; i++) {
    n += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? n / Math.sqrt(dx * dy) : 0;
}

export function chroma(samples, sampleRate) {
  const size = 8192;
  const frames = spectra(samples, size, size / 2);
  const c = new Array(12).fill(0);
  const pcs = new Int8Array(size / 2).fill(-1);
  for (let k = 1; k < size / 2; k++) {
    const f = (k * sampleRate) / size;
    if (f < 55 || f > 2000) continue;
    pcs[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12; // A=9
  }
  for (const mag of frames) {
    let total = 0;
    for (let k = 0; k < mag.length; k++) if (pcs[k] >= 0) total += mag[k];
    if (!total) continue;
    for (let k = 0; k < mag.length; k++) if (pcs[k] >= 0) c[pcs[k]] += mag[k] / total;
  }
  return c;
}

export function detectKey(samples, sampleRate) {
  const c = chroma(samples, sampleRate);
  if (!c.some((v) => v > 0)) return null;
  let best = { r: -2 };
  for (let root = 0; root < 12; root++) {
    for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
      const rot = prof.map((_, i) => prof[(i - root + 12) % 12]);
      const r = corr(c, rot);
      if (r > best.r) best = { r, root, mode };
    }
  }
  const cam = best.mode === 'major' ? `${CAM_MAJOR[best.root]}B` : `${CAM_MINOR[best.root]}A`;
  return { name: `${NOTES[best.root]}${best.mode === 'minor' ? 'm' : ''}`, camelot: cam, confidence: Math.round(best.r * 100) / 100 };
}

// ---------- energy ----------
export function detectEnergy(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  const db = 20 * Math.log10(rms || 1e-9);
  // -30 dB (quiet) .. -6 dB (very loud master) → 0..100
  return Math.round(Math.max(0, Math.min(100, ((db + 30) / 24) * 100)));
}

export function analyzeSamples(samples, sampleRate) {
  return { bpm: detectBpm(samples, sampleRate), key: detectKey(samples, sampleRate), energy: detectEnergy(samples) };
}

// ---------- how well two songs blend ----------
export function parseCamelot(code) {
  const m = /^(\d{1,2})([AB])$/.exec(code || '');
  return m ? { n: Number(m[1]), l: m[2] } : null;
}

export function keyScore(a, b) {
  const x = parseCamelot(a);
  const y = parseCamelot(b);
  if (!x || !y) return null;
  const d = Math.min((x.n - y.n + 12) % 12, (y.n - x.n + 12) % 12);
  if (d === 0) return x.l === y.l ? 1 : 0.85;
  if (d === 1) return x.l === y.l ? 0.9 : 0.5;
  if (d === 2) return x.l === y.l ? 0.55 : 0.35;
  return 0.3;
}

// Tempo gap in %, counting half/double time as a match (70 BPM ≈ 140 BPM)
export function tempoGap(a, b) {
  if (!a || !b) return null;
  let best = Infinity;
  for (const m of [0.5, 1, 2]) best = Math.min(best, Math.abs(b * m - a) / a);
  return best * 100;
}

export function tempoScore(a, b) {
  const g = tempoGap(a, b);
  if (g == null) return null;
  if (g <= 3) return 1;
  if (g <= 8) return 1 - ((g - 3) / 5) * 0.3; // 0.7 at 8%
  return Math.max(0, 0.7 - (g - 8) / 20);
}

export function energyScore(a, b) {
  if (a == null || b == null) return null;
  const d = b - a; // a small lift feels good, a big drop doesn't
  if (d >= -5 && d <= 12) return 1;
  return Math.max(0, 1 - (d > 12 ? d - 12 : -5 - d) / 40);
}

// 0..100. Missing audio info just uses the data score more.
export function transitionScore(from, to) {
  const parts = [
    [0.45, (to.match ?? 50) / 100],
    [0.25, tempoScore(from.bpm, to.bpm)],
    [0.2, keyScore(from.key?.camelot, to.key?.camelot)],
    [0.1, energyScore(from.energy, to.energy)],
  ].filter(([, v]) => v != null);
  const w = parts.reduce((a, [x]) => a + x, 0);
  return Math.round((parts.reduce((a, [x, v]) => a + x * v, 0) / w) * 100);
}

// One-line DJ tip for the pair
export function transitionTip(from, to) {
  const tips = [];
  const g = tempoGap(from.bpm, to.bpm);
  if (g != null) {
    const half = from.bpm && to.bpm && Math.abs(to.bpm * 2 - from.bpm) < Math.abs(to.bpm - from.bpm);
    const dbl = from.bpm && to.bpm && Math.abs(to.bpm / 2 - from.bpm) < Math.abs(to.bpm - from.bpm);
    if (g <= 3) tips.push(half || dbl ? 'Same groove in half/double time' : 'Tempos already match');
    else if (g <= 8) tips.push(`Nudge tempo ${Math.round(g)}% to match`);
    else tips.push('Big tempo jump: use a quick cut or echo out');
  }
  const k = keyScore(from.key?.camelot, to.key?.camelot);
  if (k != null) {
    if (k >= 0.85) tips.push('keys blend smoothly');
    else if (k >= 0.5) tips.push('keys are close');
    else tips.push('keys clash: mix on drums, not melody');
  }
  if (from.energy != null && to.energy != null) {
    const d = to.energy - from.energy;
    if (d > 12) tips.push('energy goes up');
    else if (d < -10) tips.push('energy drops');
  }
  if (!tips.length) return 'Fade in over 8 bars';
  const s = tips.join(', ');
  return s[0].toUpperCase() + s.slice(1) + '.';
}

// ---------- browser wrapper (decode the preview, cache results) ----------
const CACHE_KEY = 'mixlab-analysis-v1';
let memo = null;
function store() {
  if (memo) return memo;
  try {
    memo = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    memo = {};
  }
  return memo;
}
function save() {
  try {
    const entries = Object.entries(memo).slice(-300);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage full or blocked: keep in memory */
  }
}

let queue = Promise.resolve();
export function analyzePreview(previewUrl) {
  if (!previewUrl) return Promise.resolve(null);
  const s = store();
  if (s[previewUrl]) return Promise.resolve(s[previewUrl]);
  // one at a time so the page stays smooth
  const run = queue.then(async () => {
    if (s[previewUrl]) return s[previewUrl];
    const r = await fetch(`/api/audio?u=${encodeURIComponent(previewUrl)}`);
    if (!r.ok) throw new Error(`audio ${r.status}`);
    const buf = await r.arrayBuffer();
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Ctx(1, 1, 22050);
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.numberOfChannels;
    const len = audio.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < ch; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i] / ch;
    }
    await new Promise((res) => setTimeout(res, 0));
    const result = analyzeSamples(mono, audio.sampleRate);
    s[previewUrl] = result;
    save();
    return result;
  });
  queue = run.catch(() => null);
  return run;
}
