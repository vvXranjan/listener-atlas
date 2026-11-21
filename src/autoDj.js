import { useEffect, useState } from 'react';
import { currentPlayback, fadeVolume, ensureDevice } from './spotifyPlayer.js';
import { findTrackUri, playUris, getQueue, nextTrack } from './spotify.js';
import { getSet, saveSet, songId, getPrefs } from './setStore.js';
import { after } from './ticker.js';

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
let oldQueue = new Set(); // uris in Spotify's queue that aren't yours-from-now (old queue, playlist/album songs)
let context = new Set(); // uris we gave Spotify as the play list
const handled = new Set(); // queued songs we've already added to the set
let ticks = 0;
let radioFor = null; // the song radio last found a follow-up for

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
  if (!set.length) return stopAutoDj('Add songs to your set first.', true);
  // whatever is in Spotify's queue right now is "old"
  const q = await getQueue().catch(() => null);
  oldQueue = new Set((q?.queue || []).map((t) => t.uri));
  handled.clear();
  context = new Set();
  radioFor = null;

  const pb = await currentPlayback().catch(() => null);
  if (my !== run) return;
  if (pb?.isPlaying && !set.some((s) => isPlayingSong(pb, s))) {
    // let the current song play, then mix into your set near its end
    expected = { uri: pb.uri };
    baseVolume = pb.volume;
    emit({ current: { title: pb.name, artist: pb.artist }, next: set[0], status: `Mixing into "${set[0].title}" near the end of "${pb.name}"` });
  } else if (pb?.isPlaying) {
    expected = { uri: pb.uri };
    baseVolume = pb.volume;
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

// Songs at the FRONT of Spotify's queue that weren't there before = queued by you just now
// (Spotify puts your queued songs before the playlist/album's own next songs).
export function newlyQueued(queue, old, ctx) {
  const front = [];
  let i = 0;
  for (; i < queue.length; i++) {
    const t = queue[i];
    if (old.has(t.uri) || ctx.has(t.uri)) break;
    front.push(t);
  }
  return { front, rest: queue.slice(i) };
}

async function scanQueue(pb) {
  const q = await getQueue().catch(() => null);
  if (!q) return;
  const { front, rest } = newlyQueued(q.queue || [], oldQueue, context);
  rest.forEach((t) => oldQueue.add(t.uri)); // playlist/album songs further down: not yours
  const fresh = front.filter((t) => !handled.has(t.uri));
  if (!fresh.length) return;
  const set = getSet();
  const at = set.findIndex((s) => isPlayingSong(pb, s));
  const before = set.slice(0, at + 1);
  const after_ = set.slice(at + 1).filter((s) => !fresh.some((t) => songId(t) === songId(s)));
  const added = fresh.map((t) => ({ title: t.title, artist: t.artist, cover: t.cover || null, uri: t.uri, preview: null, queued: true }));
  fresh.forEach((t) => handled.add(t.uri));
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
  const pb = await currentPlayback().catch(() => null);
  if (my !== run) return;
  if (!pb) return emit({ status: 'Waiting for Spotify…' });
  if (++ticks % 3 === 0 && !st.paused) await scanQueue(pb); // every ~3 s
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
    } else if (nearEnd && !st.paused) {
      // our song ended and Spotify jumped to something from its own queue: get back on the set
      const target = nextInSet({ uri: expected.uri, name: st.current?.title, artist: st.current?.artist }) || getSet()[0];
      if (target) {
        emit({ skipped: st.skipped + 1, status: `Skipped "${pb.name}" (from your Spotify queue) to stay on your set` });
        lastSeen = null;
        return mixTo(target, { pb, fadeOutMs: 1200 });
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
    if (leftMs < 2500 && !pb.isPlaying) return stopAutoDj('Set finished. 🎧');
    return;
  }
  if (pb.isPlaying && leftMs <= opts.fadeOutMs + TICK_MS + 500) {
    const fadeOutMs = Math.max(1500, Math.min(opts.fadeOutMs, leftMs - 400));
    // a song you queued is already first in Spotify's queue: skip into it (no duplicate copy)
    return next.queued ? skipInto(next, { pb, fadeOutMs }) : mixTo(next, { pb, fadeOutMs });
  }
  emit({ status: `Next: "${next.title}" in ${Math.max(0, Math.round((leftMs - opts.fadeOutMs) / 1000))}s` });
}

async function mixTo(song, { pb = null, fadeOut = true, fadeOutMs = opts.fadeOutMs } = {}) {
  const my = run;
  emit({ mixing: true, paused: false, status: `Mixing into "${song.title}"…` });
  try {
    pb = pb || (await currentPlayback().catch(() => null));
    const vol = baseVolume ?? pb?.volume ?? 80;
    baseVolume = vol;
    const low = Math.round(vol * 0.12);
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
    if (fadeOut && canFade && pb.isPlaying) await fadeVolume(vol, low, fadeOutMs, pb.deviceId, pb.inPage);
    if (my !== run) return;
    if (canFade && !fadeOut) await fadeVolume(pb.volume ?? vol, low, 200, pb.deviceId, pb.inPage);
    // play the rest of your set as a list: if we're ever late, Spotify carries on in your order
    const deviceId = pb?.deviceId || (await ensureDevice());
    await playUris(uris, { deviceId, positionMs: opts.skipIntroMs });
    context = new Set(uris); // these are ours, not "queued by you"
    expected = { uri: uris[0] };
    lastSeen = null;
    emit({ current: { title: song.title, artist: song.artist } });
    await new Promise((r) => after(400, r));
    const now = await currentPlayback().catch(() => null);
    if (canFade && my === run) await fadeVolume(low, vol, opts.fadeInMs, now?.deviceId || deviceId, now?.inPage ?? pb?.inPage);
  } catch (e) {
    await stopAutoDj(e.message, true);
  } finally {
    if (my === run) emit({ mixing: false });
  }
}

// Fade out, let Spotify play the song you queued (it's first in its queue), fade back in
async function skipInto(song, { pb, fadeOutMs = opts.fadeOutMs } = {}) {
  const my = run;
  emit({ mixing: true, status: `Mixing into "${song.title}" (you queued it)…` });
  try {
    const vol = baseVolume ?? pb?.volume ?? 80;
    baseVolume = vol;
    const low = Math.round(vol * 0.12);
    const canFade = !!pb?.supportsVolume;
    if (canFade && pb.isPlaying) await fadeVolume(vol, low, fadeOutMs, pb.deviceId, pb.inPage);
    if (my !== run) return;
    await nextTrack();
    await new Promise((r) => after(700, r));
    // make sure Spotify really moved to your queued song; if not, start it directly
    const now = await currentPlayback().catch(() => null);
    if (now && song.uri && now.uri !== song.uri && now.linked !== song.uri) {
      await playUris([song.uri, ...upcomingFrom(song).slice(1).map((s) => s.uri).filter(Boolean)], { deviceId: now.deviceId || pb.deviceId });
    }
    expected = { uri: song.uri };
    lastSeen = null;
    emit({ current: { title: song.title, artist: song.artist } });
    if (canFade && my === run) await fadeVolume(low, vol, opts.fadeInMs, pb.deviceId, pb.inPage);
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
  if (next) await (next.queued ? skipInto(next, { pb, fadeOutMs: 3500 }) : mixTo(next, { pb, fadeOutMs: 3500 }));
}

// Jump the mix to a song in the set (clicking a song while Auto-DJ runs)
export async function mixToSong(song) {
  if (!st.on || st.mixing || !song) return;
  await mixTo(song, { fadeOutMs: 3500 });
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
