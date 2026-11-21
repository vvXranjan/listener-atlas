import { useEffect, useState } from 'react';
import { stopPreview, stopOthers } from './player.js';
import { setAppAudio } from './spotifyPlayer.js';

// Live sound effects on a 30-second preview (Web Audio).
// The audio comes through our own /api/audio proxy so the browser lets us process it.

export const EFFECTS = [
  { id: 'reverb', label: 'Reverb', hint: 'Big, spacey room' },
  { id: 'slowed', label: 'Slowed', hint: '85% speed, lower pitch' },
  { id: 'sped', label: 'Sped up', hint: '120% speed, higher pitch' },
  { id: 'eightD', label: '8D', hint: 'Sound circles your head (use headphones)' },
  { id: 'bass', label: 'Bass boost', hint: 'Louder 808s' },
  { id: 'lofi', label: 'Lo-fi', hint: 'Muffled, old-radio feel' },
];

let ctx = null;
let nodes = null;
let el = null;
let state = { id: null, playing: false, fx: { reverb: false, slowed: false, sped: false, eightD: false, bass: false, lofi: false }, t: 0, d: 30 };
const subs = new Set();
const emit = () => subs.forEach((fn) => fn({ ...state }));

function impulse(c, seconds = 3.2, decay = 2.6) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

function setup() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  el = new Audio();
  el.crossOrigin = 'anonymous';
  const src = ctx.createMediaElementSource(el);
  const bass = ctx.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 110;
  const lofi = ctx.createBiquadFilter();
  lofi.type = 'lowpass';
  lofi.frequency.value = 20000;
  // very old Safari has no stereo panner: then 8D just does nothing
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.16;
  const depth = ctx.createGain();
  depth.gain.value = 0;
  if (pan.pan) lfo.connect(depth).connect(pan.pan);
  lfo.start();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 0;
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx);
  src.connect(bass).connect(lofi).connect(pan);
  pan.connect(dry).connect(ctx.destination);
  pan.connect(verb).connect(wet).connect(ctx.destination);
  nodes = { bass, lofi, depth, dry, wet };
  el.addEventListener('timeupdate', () => {
    state.t = el.currentTime;
    state.d = el.duration || 30;
    emit();
  });
  el.addEventListener('ended', () => {
    state.playing = false;
    setAppAudio('fx', false);
    emit();
  });
}

function apply() {
  if (!ctx) return;
  const f = state.fx;
  const now = ctx.currentTime;
  const ramp = (p, v) => p.setTargetAtTime(v, now, 0.08);
  ramp(nodes.wet.gain, f.reverb ? 0.55 : 0);
  ramp(nodes.dry.gain, f.reverb ? 0.75 : 1);
  ramp(nodes.bass.gain, f.bass ? 9 : 0);
  ramp(nodes.lofi.frequency, f.lofi ? 2400 : 20000);
  ramp(nodes.depth.gain, f.eightD ? 1 : 0);
  // "slowed" and "sped up" change pitch on purpose, like the TikTok edits
  el.preservesPitch = false;
  el.mozPreservesPitch = false;
  el.webkitPreservesPitch = false;
  el.playbackRate = f.slowed ? 0.85 : f.sped ? 1.2 : 1;
}

export function playFx(id, previewUrl) {
  if (!previewUrl) return;
  stopPreview();
  stopOthers.forEach((fn) => fn !== stopFx && fn());
  setup();
  ctx.resume();
  if (state.id === id && state.playing) {
    el.pause();
    state.playing = false;
    setAppAudio('fx', false);
    return emit();
  }
  if (state.id !== id) {
    el.src = `/api/audio?u=${encodeURIComponent(previewUrl)}`;
    state.t = 0;
  }
  state.id = id;
  apply();
  el.play()
    .then(() => {
      state.playing = true;
      setAppAudio('fx', true);
      emit();
    })
    .catch(() => {
      state.playing = false;
      setAppAudio('fx', false);
      emit();
    });
}

export function stopFx() {
  if (el) el.pause();
  setAppAudio('fx', false);
  if (state.playing) {
    state.playing = false;
    emit();
  }
}
stopOthers.add(stopFx);

export function toggleFx(name) {
  const fx = { ...state.fx, [name]: !state.fx[name] };
  if (name === 'slowed' && fx.slowed) fx.sped = false;
  if (name === 'sped' && fx.sped) fx.slowed = false;
  state.fx = fx;
  apply();
  emit();
}

export function useFx() {
  const [s, set] = useState({ ...state });
  useEffect(() => {
    subs.add(set);
    return () => subs.delete(set);
  }, []);
  return s;
}
