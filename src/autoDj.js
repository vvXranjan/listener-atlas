import { useEffect, useState } from 'react';
import { currentPlayback, fadeVolume, ensureDevice } from './spotifyPlayer.js';
import { findTrackUri, playUris, getQueue, nextTrack, seekTo } from './spotify.js';
import { getSet, saveSet, songId, getPrefs } from './setStore.js';
import { after } from './ticker.js';
import { getNow, setNow } from './nowStore.js';
import { analyzePreview, cachedAnalysis } from './audioAnalysis.js';
import { planTransition, planText } from './djModes.js';

// Auto-DJ: plays your set on your own Spotify and fades each song into the next.
//
// It always follows your LIVE set: reorder, add or remove songs while it runs and the
// next mix follows the change. Its clock runs in a background worker, so it stays on
// time when this tab is hidden.
//
// Spotify always plays its own queue before anything else:
//  - songs that were already in your Spotify queue when Auto-DJ started are "old": if one
//    starts right as your song ends, Auto-DJ skips it and stays on your set;
//  - songs you queue WHILE it runs (from your phone, Mac, anywhere) are yours: they join the
//    set and play next, then the set carries on.
// If YOU pick a different song in the middle of one, Auto-DJ pauses instead of fighting you.
// When the set runs out, radio mode keeps going with your habits + recommendations.

const TICK_MS = 1000;
const LEAK_WINDOW_MS = 15000; // a different song starting this close to the end = Spotify's queue, not you

const firstArtist = (a = '') => a.split(/,|&| with | feat\.? /i)[0].trim();

let st = {
  on: false,
  paused: false,
  mixing: false,
  status: '',
  error: '',
  current: null, // { title, artist }
  next: null, // { title, artist }
  secondsLeft: null,
  skipped: 0, // stray queue songs skipped
  queuedByYou: 0, // songs you queued from another device while it ran
  plan: null, // how the next transition will go (mode, fade lengths, why)
};
const subs = new Set();
const emit = (patch) => {
  st = { ...st, ...patch };
  subs.forEach((fn) => fn(st));
};

export const autoDjState = () => st;
export function useAutoDj() {
  const [s, set] = useState(st);
  useEffect(() => {
    subs.add(set);
    return () => subs.delete(set);
  }, []);
  return s;
}

let opts = { fadeOutMs: 7000, fadeInMs: 4000, skipIntroMs: 0 };
let expected = null; // the track we put on: { uri, id }
let lastSeen = null; // last poll: { uri, leftMs, at }
let baseVolume = null;
let run = 0; // bumps on stop, so old loops quit
let cancelTick = null;
const uriCache = new Map(); // songId -> Spotify uri
let prevCounts = new Map(); // how many times each uri was in Spotify's queue at the last look
let startOld = new Set(); // what was in Spotify's queue when Auto-DJ started
let lastFront = new Set(); // songs at the front of the queue at the last look (your queued songs live here)
let context = new Set(); // uris we gave Spotify as the play list
// tell the app "Spotify just changed song", so it refreshes right away instead of at its next poll
const spotifyChanged = () => typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('spotify-changed'));
let lastScanAt = 0; // last look at Spotify's queue
let lastPb = null; // last answer from Spotify, and when
let lastPbAt = 0;

// How often Auto-DJ asks Spotify (it stays well under Spotify's limits):
//  - what's playing: every 2 s mid-song, every 1 s in the last 30 s (free with "Play here")
//  - your queue:     every 5 s mid-song, every 1 s in the last 25 s, and once more right at the switch
const NEAR_END_MS = 30000;
const QUEUE_NEAR_MS = 25000;
async function readPlayback(force = false) {
  const now = Date.now();
  if (!force && lastPbAt) {
    const age = now - lastPbAt;
    // nothing playing: look every 3 s
    if ((!lastPb || !lastPb.isPlaying) && !lastPb?.inPage) {
      if (age < 3000) return lastPb;
    } else if (!lastPb.inPage) {
      // mid-song: every 2 s, guessing the position in between
      const pos = lastPb.positionMs + age;
      if (lastPb.durationMs - pos > NEAR_END_MS && age < 2000) return { ...lastPb, positionMs: pos };
    }
  }
  const pb = await currentPlayback().catch(() => null);
  lastPb = pb;
  lastPbAt = now;
  // share what we just learned, so the whole app stays in step with Spotify
  const n = getNow();
  if (pb && n.track?.id && String(pb.uri || '').endsWith(n.track.id)) setNow({ progressMs: pb.positionMs, playing: !!pb.isPlaying, fetchedAt: now });
  else if (pb && n.track?.id && pb.uri && !String(pb.uri).endsWith(n.track.id)) spotifyChanged();
  return pb;
}
let radioFor = null; // the song radio last found a follow-up for

// ---------- listening ahead (runs alongside playback) ----------
// Measures tempo / key / energy of the playing and next songs from their previews, in the
// background, so the transition can be planned before it's needed.
const feats = new Map(); // songId -> analysis (or null while measuring / unknown)
const canAnalyze = () => typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext || window.OfflineAudioContext);
async function prepare(song) {
  const id = songId(song);
  if (feats.has(id)) return;
  feats.set(id, null);
  try {
    let preview = song.preview;
    if (!preview && typeof fetch === 'function') {
      const qs = new URLSearchParams({ title: song.title, artist: firstArtist(song.artist) });
      const r = await fetch(`/api/preview?${qs}`);
      preview = r.ok ? (await r.json())?.preview : null;
    }
    if (!preview) return;
    const hit = cachedAnalysis(preview);
    if (hit) return feats.set(id, hit);
    if (!canAnalyze()) return;
    feats.set(id, await analyzePreview(preview, 2));
  } catch {
    /* no preview or can't measure: the plan falls back to a safe blend */
  }
}
function featuresOf(song) {
  if (!song) return null;
  const id = songId(song);
  if (!feats.has(id)) prepare(song);
  return feats.get(id) || (song.preview ? cachedAnalysis(song.preview) : null);
}
export const djMode = () => getPrefs().djMode || 'auto';
function planFor(fromSong, toSong) {
  return planTransition(djMode(), featuresOf(fromSong), featuresOf(toSong));
}
const playingSong = (pb) => getSet().find((s) => isPlayingSong(pb, s)) || (pb ? { title: pb.name, artist: pb.artist, uri: pb.uri } : null);

const isPlayingSong = (pb, song) =>
  !!pb && !!song && ((song.uri && (pb.uri === song.uri || pb.linked === song.uri)) || songId({ title: pb.name, artist: pb.artist }) === songId(song));

// ---------- reading the live set ----------
// The song after the one playing now (or the first song if what's playing isn't in the set)
export function nextInSet(pb, set = getSet()) {
  const i = set.findIndex((s) => isPlayingSong(pb, s));
  return i >= 0 ? set[i + 1] || null : set.find((s) => !isPlayingSong(pb, s)) || null;
}
function upcomingFrom(song, set = getSet()) {
  const i = set.findIndex((s) => songId(s) === songId(song));
  return i >= 0 ? set.slice(i) : [song];
}

async function uriFor(song) {
  if (song.uri) return song.uri;
  const id = songId(song);
  if (uriCache.has(id)) return uriCache.get(id);
  const { uri } = await findTrackUri(song.title, firstArtist(song.artist));
  uriCache.set(id, uri);
  // remember it in the set, so next time it's instant and matching is exact
  const set = getSet();
  if (set.some((s) => songId(s) === id && !s.uri)) saveSet(set.map((s) => (songId(s) === id ? { ...s, uri } : s)));
  return uri;
}

// ---------- the loop ----------
export async function startAutoDj(options = {}) {
  await stopAutoDj('');
  const my = ++run;
  opts = { ...opts, ...options };
  emit({ on: true, paused: false, error: '', status: 'Starting…', skipped: 0, queuedByYou: 0 });
  const set = getSet();
  // switched on by itself (always-on): an empty set is fine, radio picks the next songs
  if (!set.length && !options.passive) return stopAutoDj('Add songs to your set first.', true);
  // whatever is in Spotify's queue right now is "old"
  const q = await getQueue().catch(() => null);
  prevCounts = countUris(q?.queue || []);
  startOld = new Set(prevCounts.keys());
  lastFront = new Set();
  context = new Set();
  lastPb = null;
  lastPbAt = 0;
  lastScanAt = Date.now();
  radioFor = null;

  const pb = await currentPlayback().catch(() => null);
  if (my !== run) return;
  if (pb?.isPlaying && !set.some((s) => isPlayingSong(pb, s))) {
    // let the current song play, then mix into your set near its end
    expected = { uri: pb.uri };
    baseVolume = pb.volume;
    emit({
      current: { title: pb.name, artist: pb.artist },
      next: set[0] || null,
      status: set[0] ? `Mixing into "${set[0].title}" near the end of "${pb.name}"` : `Listening along to "${pb.name}"`,
    });
  } else if (pb?.isPlaying) {
    expected = { uri: pb.uri };
    baseVolume = pb.volume;
  } else if (options.passive) {
    // switched on by itself (app start): don't start music, just be ready
    emit({
      next: set[0] || null,
      status: set[0]
        ? `Ready: play anything on Spotify and Auto-DJ takes over at the end of the song, or press "⇄ Mix to next now" to start your set`
        : 'Ready: play anything on Spotify and Auto-DJ keeps the music going',
    });
  } else {
    await mixTo(set[0], { fadeOut: false });
  }
  tick(my);
}

function tick(my) {
  cancelTick?.();
  cancelTick = after(TICK_MS, async () => {
    if (my !== run) return;
    try {
      if (!st.mixing) await check(my);
    } finally {
      if (my === run) tick(my);
    }
  });
}

function countUris(list) {
  const m = new Map();
  for (const t of list) if (t?.uri) m.set(t.uri, (m.get(t.uri) || 0) + 1);
  return m;
}

// Which songs did you just queue in Spotify (phone, Mac, anywhere)?
// Spotify puts your queued songs FIRST, before the play list's own next songs. So a song at the front
// that now shows up more often than at the last look was queued by you, even if the same song was
// already further down (e.g. in the playlist you were playing before).
export function newlyQueued(queue, prev, ctx) {
  let i = 0;
  while (i < queue.length && !ctx.has(queue[i].uri)) i++;
  const front = queue.slice(0, i);
  const anchored = i < queue.length; // our play list is still in the queue
  const now = countUris(queue);
  const seen = new Set();
  const grown = [];
  front.forEach((t, idx) => {
    if (seen.has(t.uri)) return;
    seen.add(t.uri);
    if ((now.get(t.uri) || 0) > (prev.get(t.uri) || 0)) grown.push({ t, idx });
  });
  // Spotify's autoplay fills in a batch of songs when your list runs out: that's not you
  if (!anchored && grown.length > 3) return { front, fresh: [], counts: now };
  // without our list as an anchor, new songs showing up at the END are just the playlist scrolling on
  const fresh = grown.filter(({ idx }) => anchored || idx < Math.max(1, Math.floor(queue.length / 2))).map(({ t }) => t);
  return { front, fresh, counts: now };
}

let lateAdded = null; // songs the last scan found
async function scanQueue(pb) {
  lastScanAt = Date.now();
  lateAdded = null;
  const q = await getQueue().catch(() => null);
  if (!q) return;
  const { front, fresh: found, counts } = newlyQueued(q.queue || [], prevCounts, context);
  prevCounts = counts;
  lastFront = new Set(front.map((t) => t.uri));
  const set0 = getSet();
  const at0 = set0.findIndex((s) => isPlayingSong(pb, s));
  // already waiting in the set as a queued song? nothing to do
  const fresh = found.filter((t) => !set0.slice(at0 + 1).some((s) => s.queued && (s.uri === t.uri || songId(s) === songId(t))));
  if (!fresh.length) return;
  const set = set0;
  const at = at0;
  const before = set.slice(0, at + 1);
  const after_ = set.slice(at + 1).filter((s) => !fresh.some((t) => songId(t) === songId(s)));
  const added = fresh.map((t) => ({ title: t.title, artist: t.artist, cover: t.cover || null, uri: t.uri, preview: null, queued: true }));
  lateAdded = added;
  // keep the order you queued them in, right after the song playing now
  const already = after_.filter((s) => s.queued);
  const others = after_.filter((s) => !s.queued);
  saveSet([...before, ...already, ...added, ...others]);
  emit({
    queuedByYou: st.queuedByYou + added.length,
    status: `📱 You queued "${added[0].title}"${added.length > 1 ? ` +${added.length - 1}` : ''}: playing it next`,
  });
}

async function check(my) {
  const pb = await readPlayback();
  if (my !== run) return;
  if (!pb) return emit({ status: 'Waiting for Spotify…' });
  const left0 = pb.durationMs - pb.positionMs;
  // look at your Spotify queue: every 5 s, every 1 s near the end (so a late add still makes it)
  if (!st.paused && Date.now() - lastScanAt >= (left0 < QUEUE_NEAR_MS ? 900 : 5000)) await scanQueue(pb);
  if (my !== run) return;
  const now = Date.now();
  const leftMs = pb.durationMs - pb.positionMs;
  let next = nextInSet(pb);
  // radio: set ran out, so add the best follow-up (your habits first, then recommendations)
  if (!next && !st.paused && radioOn() && radioFor !== pb.uri) {
    radioFor = pb.uri;
    const { ensureNext } = await import('./setSync.js');
    next = (await ensureNext({ title: pb.name, artist: pb.artist, uri: pb.uri }).catch(() => null)) || null;
    if (my !== run) return;
  }

  if (expected && pb.uri !== expected.uri && pb.linked !== expected.uri) {
    const inSet = getSet().some((s) => isPlayingSong(pb, s));
    const nearEnd = lastSeen && lastSeen.uri === expected.uri && lastSeen.leftMs - (now - lastSeen.at) < LEAK_WINDOW_MS;
    if (inSet) {
      // a set song is playing (you clicked it, or Spotify moved on in order): follow it
      expected = { uri: pb.uri };
      if (st.paused) emit({ paused: false });
    } else if (nearEnd && !st.paused && lastFront.has(pb.uri) && !startOld.has(pb.uri)) {
      // our song ended and Spotify played a song YOU queued: keep it, then carry on with the set
      const set = getSet();
      const prevAt = set.findIndex((s) => s.uri === expected.uri || songId(s) === songId(st.current || {}));
      const song = { title: pb.name, artist: pb.artist, cover: pb.cover || null, uri: pb.uri, preview: null, queued: true };
      saveSet(prevAt >= 0 ? [...set.slice(0, prevAt + 1), song, ...set.slice(prevAt + 1)] : [song, ...set]);
      expected = { uri: pb.uri };
      lastFront.delete(pb.uri);
      emit({ queuedByYou: st.queuedByYou + 1, status: `📱 Playing "${pb.name}" (you queued it), then back to your set` });
      next = nextInSet(pb);
    } else if (nearEnd && !st.paused) {
      // our song ended and Spotify jumped to something from its own queue: get back on the set
      const target = nextInSet({ uri: expected.uri, name: st.current?.title, artist: st.current?.artist }) || getSet()[0];
      if (target) {
        emit({ skipped: st.skipped + 1, status: `Skipped "${pb.name}" (from your Spotify queue) to stay on your set` });
        lastSeen = null;
        return mixTo(target, { pb, fadeOutMs: 1200, plan: planTransition('quick') });
      }
    } else if (!st.paused) {
      // you picked something else mid-song: step aside
      emit({ paused: true, status: `Paused: you chose "${pb.name}". Press Resume to go back to your set.` });
    }
  }

  lastSeen = { uri: pb.uri, leftMs, at: now };
  emit({ current: { title: pb.name, artist: pb.artist }, next, secondsLeft: Math.max(0, Math.round(leftMs / 1000)) });
  if (st.paused) return;
  if (!next) {
    emit({ status: `Last song: "${pb.name}". Add more songs to keep going.` });
    if (leftMs < 2500 && !pb.isPlaying && !opts.passive) return stopAutoDj('Set finished. 🎧');
    return;
  }
  let plan = planFor(playingSong(pb), next);
  if (pb.isPlaying && leftMs <= plan.fadeOutMs + TICK_MS + 500) {
    // one last look at Spotify's queue, so a song you just queued isn't missed
    if (Date.now() - lastScanAt > 600) {
      await scanQueue(pb);
      if (my !== run) return;
      next = nextInSet(pb) || next;
      plan = planFor(playingSong(pb), next);
    }
    const fadeOutMs = Math.max(plan.kind === 'quick' ? 800 : 1500, Math.min(plan.fadeOutMs, leftMs - 400));
    // a song you queued is already first in Spotify's queue: skip into it (no duplicate copy)
    return next.queued ? skipInto(next, { pb, fadeOutMs, plan }) : mixTo(next, { pb, fadeOutMs, plan });
  }
  emit({ plan, status: `Next: "${next.title}" in ${Math.max(0, Math.round((leftMs - plan.fadeOutMs) / 1000))}s · ${plan.icon} ${plan.label}` });
}

const wait = (ms) => new Promise((r) => after(ms, r));

// Fade the playing song out the way the plan says; returns the volume it ended at
async function fadeOutByPlan(plan, vol, fadeOutMs, pb) {
  const low = Math.round(vol * plan.lowPct);
  if (plan.kind === 'echo' && plan.beatMs) {
    // step down on each beat, like an echo trailing off
    let v = vol;
    for (let i = 0; i < (plan.beats || 8); i++) {
      const to = Math.max(low, Math.round(v * 0.68));
      await fadeVolume(v, to, 90, pb.deviceId, pb.inPage);
      v = to;
      await wait(Math.max(0, plan.beatMs - 90));
    }
    return v;
  }
  await fadeVolume(vol, low, fadeOutMs, pb.deviceId, pb.inPage);
  return low;
}
// a breath of silence between songs (Chill, Echo out)
async function gapByPlan(plan, from, pb) {
  if (!plan.gapMs) return from;
  await fadeVolume(from, 0, 150, pb.deviceId, pb.inPage);
  await wait(plan.gapMs);
  return 0;
}

async function mixTo(song, { pb = null, fadeOut = true, fadeOutMs, plan } = {}) {
  const my = run;
  emit({ mixing: true, paused: false, status: `Mixing into "${song.title}"…` });
  try {
    pb = pb || (await currentPlayback().catch(() => null));
    plan = plan || planFor(playingSong(pb), song);
    fadeOutMs = fadeOutMs ?? plan.fadeOutMs;
    emit({ plan, status: `${plan.icon} ${plan.label} into "${song.title}"…` });
    const vol = baseVolume ?? pb?.volume ?? 80;
    baseVolume = vol;
    let low = Math.round(vol * plan.lowPct);
    const canFade = !!pb?.supportsVolume;
    // look up the songs first, so the switch itself is instant
    const list = upcomingFrom(song);
    const uris = [];
    for (const s of list.slice(0, 50)) {
      try {
        uris.push(await uriFor(s));
      } catch {
        /* Spotify doesn't have this one: skip it */
      }
      if (my !== run) return;
    }
    if (!uris.length) throw new Error(`"${song.title}" isn't on Spotify`);
    if (fadeOut && canFade && pb.isPlaying) {
      low = await fadeOutByPlan(plan, vol, fadeOutMs, pb);
      if (my !== run) return;
      low = await gapByPlan(plan, low, pb);
    }
    if (my !== run) return;
    // last look right at the switch: a song you queued during the fade plays first
    if (fadeOut && pb) {
      await scanQueue(pb);
      if (my !== run) return;
      const late = lateAdded?.[0];
      if (late) {
        emit({ status: `📱 Just in time: "${late.title}" (you queued it)` });
        return await enterQueued(late, { pb, plan, low, vol, canFade, my });
      }
    }
    if (canFade && !fadeOut) await fadeVolume(pb.volume ?? vol, low, 200, pb.deviceId, pb.inPage);
    // play the rest of your set as a list: if we're ever late, Spotify carries on in your order
    const deviceId = pb?.deviceId || (await ensureDevice());
    await playUris(uris, { deviceId, positionMs: plan.startAtMs || opts.skipIntroMs });
    spotifyChanged();
    context = new Set(uris); // these are ours, not "queued by you"
    lastPb = null;
    lastPbAt = 0;
  lastPbAt = 0;
    expected = { uri: uris[0] };
    lastSeen = null;
    emit({ current: { title: song.title, artist: song.artist } });
    await new Promise((r) => after(400, r));
    const now = await currentPlayback().catch(() => null);
    if (canFade && my === run) await fadeVolume(low, vol, plan.fadeInMs, now?.deviceId || deviceId, now?.inPage ?? pb?.inPage);
  } catch (e) {
    await stopAutoDj(e.message, true);
  } finally {
    if (my === run) emit({ mixing: false });
  }
}

// Spotify's next song is one you queued: step into it (no second copy), then fade back in
async function enterQueued(song, { pb, plan, low, vol, canFade, my }) {
  await nextTrack();
  // make sure Spotify really moved to your queued song (it can take a moment to report it)
  let now = null;
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => after(i ? 500 : 350, r));
    now = await currentPlayback().catch(() => null);
    if (!now || !song.uri || now.uri === song.uri || now.linked === song.uri) break;
  }
  if (now && song.uri && now.uri !== song.uri && now.linked !== song.uri) {
    await playUris([song.uri, ...upcomingFrom(song).slice(1).map((s) => s.uri).filter(Boolean)], { deviceId: now.deviceId || pb.deviceId });
  }
  if (plan.startAtMs) await seekTo(plan.startAtMs, now?.deviceId || pb.deviceId).catch(() => {});
  spotifyChanged();
  expected = { uri: song.uri };
  lastSeen = null;
  lastPb = null;
  lastPbAt = 0;
  emit({ current: { title: song.title, artist: song.artist } });
  if (canFade && my === run) await fadeVolume(low, vol, plan.fadeInMs, pb.deviceId, pb.inPage);
}

// Fade out, let Spotify play the song you queued (it's first in its queue), fade back in
async function skipInto(song, { pb, fadeOutMs, plan } = {}) {
  const my = run;
  plan = plan || planFor(playingSong(pb), song);
  fadeOutMs = fadeOutMs ?? plan.fadeOutMs;
  emit({ mixing: true, plan, status: `${plan.icon} ${plan.label} into "${song.title}" (you queued it)…` });
  try {
    const vol = baseVolume ?? pb?.volume ?? 80;
    baseVolume = vol;
    let low = Math.round(vol * plan.lowPct);
    const canFade = !!pb?.supportsVolume;
    if (canFade && pb.isPlaying) {
      low = await fadeOutByPlan(plan, vol, fadeOutMs, pb);
      if (my !== run) return;
      low = await gapByPlan(plan, low, pb);
    }
    if (my !== run) return;
    await enterQueued(song, { pb, plan, low, vol, canFade, my });
  } catch (e) {
    await stopAutoDj(e.message, true);
  } finally {
    if (my === run) emit({ mixing: false });
  }
}

const radioOn = () => getPrefs().radio !== false;

// Mix into the next song right now, from wherever the current song is
export async function mixNow() {
  if (!st.on || st.mixing) return;
  const pb = await currentPlayback().catch(() => null);
  const next = nextInSet(pb) || getSet()[0];
  if (!next) return;
  const plan = planFor(playingSong(pb), next);
  const fadeOutMs = Math.min(plan.fadeOutMs, 3500);
  await (next.queued ? skipInto(next, { pb, fadeOutMs, plan }) : mixTo(next, { pb, fadeOutMs, plan }));
}

// Jump the mix to a song in the set (clicking a song while Auto-DJ runs)
export async function mixToSong(song) {
  if (!st.on || st.mixing || !song) return;
  const pb = await currentPlayback().catch(() => null);
  const plan = planFor(playingSong(pb), song);
  await mixTo(song, { pb, fadeOutMs: Math.min(plan.fadeOutMs, 3500), plan });
}

// After you picked your own song: go back to the set
export async function resumeSet() {
  if (!st.on) return;
  emit({ paused: false });
  await mixNow();
}

export async function stopAutoDj(message = '', isError = false) {
  run++;
  cancelTick?.();
  cancelTick = null;
  const restore = baseVolume;
  baseVolume = null;
  expected = null;
  lastSeen = null;
  emit({ on: false, paused: false, mixing: false, status: isError ? '' : message, error: isError ? message : '', secondsLeft: null });
  // put the volume back if we stopped halfway through a fade
  if (restore != null) {
    const pb = await currentPlayback().catch(() => null);
    if (pb?.supportsVolume && Math.abs(pb.volume - restore) > 3) await fadeVolume(pb.volume, restore, 600, pb.deviceId, pb.inPage);
  }
}

export { planText };
