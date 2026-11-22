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

// ---------- sound: bass (808s), space (reverb), brightness, punch ----------
const pct = (arr, p) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))] || 0;
};
const clamp100 = (v) => Math.round(Math.max(0, Math.min(100, v)));

export function detectSound(samples, sampleRate) {
  const size = 2048;
  const frames = spectra(samples, size, size / 2);
  if (frames.length < 8) return null;
  const binHz = sampleRate / size;
  const bassTop = Math.round(120 / binHz);
  const top = Math.min(size / 2, Math.round(8000 / binHz));
  let bass = 0;
  let total = 0;
  const centroids = [];
  const levels = [];
  const flux = [];
  let prev = null;
  for (const mag of frames) {
    let e = 0;
    let w = 0;
    for (let k = 1; k < top; k++) {
      const p = mag[k] * mag[k];
      e += p;
      w += p * k * binHz;
      if (k <= bassTop) bass += p;
    }
    total += e;
    if (e > 0) centroids.push(w / e);
    levels.push(Math.sqrt(e));
    if (prev) {
      let f = 0;
      for (let k = 1; k < top; k++) f += Math.max(0, mag[k] - prev[k]);
      flux.push(f);
    }
    prev = mag;
  }
  const centroid = centroids.reduce((a, b) => a + b, 0) / Math.max(1, centroids.length);
  // quiet moments that stay full = sound keeps ringing (reverb, pads); dry mixes drop to near silence
  const sustain = pct(levels, 0.2) / (pct(levels, 0.9) || 1);
  // how much the hits stand out from the rest
  const crest = pct(flux, 0.97) / (flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length) || 1);
  return {
    bass: clamp100(((bass / (total || 1)) / 0.45) * 100), // 45%+ of energy under 120 Hz = maxed
    space: clamp100(((sustain - 0.15) / 0.55) * 100),
    brightness: clamp100(((centroid - 600) / 2400) * 100),
    punch: clamp100(((crest - 1.8) / 4) * 100),
  };
}

// Mood + sound labels from the numbers. Rough, rule-based, honest about it.
export function describeVibe(a) {
  if (!a) return { mood: null, moods: [], sound: [] };
  const minor = a.key?.name?.endsWith('m');
  const fast = a.bpm && (a.bpm >= 130 || (a.bpm >= 65 && a.bpm < 80)); // trap is often felt in half time
  const s = a.sound || {};
  const scores = {
    Hype: (a.energy ?? 50) * 0.5 + (s.punch ?? 50) * 0.3 + (fast ? 20 : 0),
    Dark: (minor ? 45 : 5) + (100 - (s.brightness ?? 50)) * 0.45 + (s.bass ?? 50) * 0.1,
    Dreamy: (s.space ?? 0) * 0.75 + (100 - (s.punch ?? 50)) * 0.25,
    Melodic: (s.brightness ?? 50) * 0.4 + (s.space ?? 0) * 0.3 + (100 - (s.punch ?? 50)) * 0.3,
    Chill: (100 - (a.energy ?? 50)) * 0.6 + (100 - (s.punch ?? 50)) * 0.4,
  };
  const moods = Object.entries(scores)
    .sort((x, y) => y[1] - x[1])
    .filter(([, v], i) => i === 0 || v >= 55)
    .slice(0, 2)
    .map(([m]) => m);
  const sound = [];
  if ((s.bass ?? 0) >= 60) sound.push('Heavy 808s');
  if ((s.space ?? 0) >= 55) sound.push('Spacey reverb');
  if ((s.punch ?? 0) >= 60) sound.push('Hard drums');
  if ((s.brightness ?? 50) >= 65) sound.push('Bright');
  if ((s.brightness ?? 50) <= 25) sound.push('Murky');
  if (a.bpm && a.bpm >= 65 && a.bpm < 80) sound.push('Half-time bounce');
  return { mood: moods[0], moods, sound };
}

export function analyzeSamples(samples, sampleRate) {
  const out = {
    bpm: detectBpm(samples, sampleRate),
    key: detectKey(samples, sampleRate),
    energy: detectEnergy(samples),
    sound: detectSound(samples, sampleRate),
  };
  return { ...out, vibe: describeVibe(out) };
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

// ---------- best order for a set ----------
// Score of a whole order: the average blend of each step (start -> 1 -> 2 ...)
export function flowScore(start, order, score = (a, b) => transitionScore(a, { ...b, match: 60 })) {
  const seq = start ? [start, ...order] : order;
  if (seq.length < 2) return null;
  let t = 0;
  for (let i = 1; i < seq.length; i++) t += score(seq[i - 1], seq[i]);
  return Math.round(t / (seq.length - 1));
}

// Finds the smoothest order. Tries every order for up to 8 songs,
// otherwise a smart guess (nearest neighbour + swapping pairs to improve).
export function bestOrder(start, items, score = (a, b) => transitionScore(a, { ...b, match: 60 })) {
  const n = items.length;
  if (n < 2) return { order: items, score: flowScore(start, items, score) };
  const memo = new Map();
  const s = (a, b) => {
    const k = `${items.indexOf(a)}>${items.indexOf(b)}`;
    if (!memo.has(k)) memo.set(k, score(a, b));
    return memo.get(k);
  };
  const total = (ord) => ord.reduce((t, x, i) => t + (i ? s(ord[i - 1], x) : start ? score(start, x) : 0), 0);
  let best = items;
  let bestT = total(items);
  if (n <= 8) {
    const used = new Array(n).fill(false);
    const cur = [];
    const walk = (t) => {
      if (cur.length === n) {
        if (t > bestT) {
          bestT = t;
          best = [...cur];
        }
        return;
      }
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        const prev = cur[cur.length - 1];
        const add = prev ? s(prev, items[i]) : start ? score(start, items[i]) : 0;
        used[i] = true;
        cur.push(items[i]);
        walk(t + add);
        cur.pop();
        used[i] = false;
      }
    };
    walk(0);
  } else {
    const left = [...items];
    const ord = [];
    let prev = start;
    while (left.length) {
      let bi = 0;
      if (prev) left.forEach((x, i) => (score(prev, x) > score(prev, left[bi]) ? (bi = i) : 0));
      prev = left.splice(bi, 1)[0];
      ord.push(prev);
    }
    let improved = true;
    let t = total(ord);
    while (improved) {
      improved = false;
      for (let i = 0; i < n - 1; i++)
        for (let j = i + 1; j < n; j++) {
          const c = [...ord.slice(0, i), ...ord.slice(i, j + 1).reverse(), ...ord.slice(j + 1)];
          const ct = total(c);
          if (ct > t + 1e-9) {
            ord.splice(0, n, ...c);
            t = ct;
            improved = true;
          }
        }
    }
    best = ord;
    bestT = t;
  }
  return { order: best, score: flowScore(start, best, score) };
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
const CACHE_KEY = 'mixlab-analysis-v2';
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

// The heavy math runs in a background worker so the page stays smooth.
let worker = null;
let workerFailed = false;
let nextId = 0;
const waiting = new Map();
function analyzeInWorker(samples, sampleRate) {
  if (!worker && !workerFailed) {
    try {
      worker = new Worker(new URL('./analysisWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const w = waiting.get(e.data.id);
        waiting.delete(e.data.id);
        if (!w) return;
        if (e.data.error) w.reject(new Error(e.data.error));
        else w.resolve(e.data.result);
      };
      worker.onerror = () => {
        // older browsers can't run this worker: finish the waiting songs here instead
        workerFailed = true;
        waiting.forEach((w) => {
          try {
            w.resolve(analyzeSamples(w.samples, w.sampleRate));
          } catch (e) {
            w.reject(e);
          }
        });
        waiting.clear();
      };
    } catch {
      workerFailed = true;
    }
  }
  if (workerFailed || !worker) return Promise.resolve(analyzeSamples(samples, sampleRate));
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject, samples, sampleRate });
    worker.postMessage({ id, samples, sampleRate }); // copied, so we can fall back if the worker dies
  });
}

// Middle 15 seconds is plenty for tempo, key and sound, and twice as fast
export function middleSlice(samples, sampleRate, seconds = 15) {
  const want = Math.floor(seconds * sampleRate);
  if (samples.length <= want) return samples;
  const start = Math.floor((samples.length - want) / 2);
  return samples.slice(start, start + want);
}

// Decode audio in every browser (older Safari only supports the callback style)
function decode(buf) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  let ctx;
  try {
    ctx = new Ctx(1, 1, 22050);
  } catch {
    ctx = new Ctx(1, 1, 44100); // some Safari versions reject low sample rates
  }
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(buf, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

async function analyzeOne(url) {
  const r = await fetch(`/api/audio?u=${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error(`audio ${r.status}`);
  const buf = await r.arrayBuffer();
  const audio = await decode(buf);
  const ch = audio.numberOfChannels;
  const len = audio.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i] / ch;
  }
  return analyzeInWorker(middleSlice(mono, audio.sampleRate), audio.sampleRate);
}

// Small priority queue: 2 songs at a time, lowest priority number first
const PARALLEL = 2;
const jobs = new Map(); // url -> { priority, promise, resolve, reject, started }
let running = 0;
function pump() {
  while (running < PARALLEL) {
    let next = null;
    for (const j of jobs.values()) if (!j.started && (!next || j.priority < next.priority)) next = j;
    if (!next) return;
    next.started = true;
    running += 1;
    analyzeOne(next.url)
      .then((res) => {
        store()[next.url] = res;
        save();
        next.resolve(res);
      })
      .catch(next.reject)
      .finally(() => {
        jobs.delete(next.url);
        running -= 1;
        pump();
      });
  }
}

// already measured? (no work, no waiting)
export const cachedAnalysis = (url) => (url ? store()[url] || null : null);

// priority: smaller = sooner (e.g. the songs you can see on screen first)
export function analyzePreview(previewUrl, priority = 100) {
  if (!previewUrl) return Promise.resolve(null);
  const s = store();
  if (s[previewUrl]) return Promise.resolve(s[previewUrl]);
  const existing = jobs.get(previewUrl);
  if (existing) {
    if (!existing.started) existing.priority = Math.min(existing.priority, priority);
    return existing.promise;
  }
  const job = { url: previewUrl, priority, started: false };
  job.promise = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }));
  jobs.set(previewUrl, job);
  pump();
  return job.promise;
}
