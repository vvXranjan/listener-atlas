import { useEffect, useState } from 'react';
import { currentPlayback, fadeVolume, ensureDevice } from './spotifyPlayer.js';
import { findTrackUri, playUris } from './spotify.js';

// Auto-DJ: plays your set on your own Spotify and mixes each song into the next.
// Near the end of a song it fades it out, starts the next one, and fades that in.
// Spotify plays one song at a time, so this is a smooth fade, not two songs overlapping.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = 1500;

let st = { on: false, status: '', error: '', index: -1, titles: [], secondsLeft: null, mixing: false };
const subs = new Set();
const emit = (patch) => {
  st = { ...st, ...patch };
  subs.forEach((fn) => fn(st));
};

let items = [];
let opts = { fadeOutMs: 7000, fadeInMs: 4000, skipIntroMs: 0 };
let expected = null; // uri we expect to be playing
let timer = null;
let baseVolume = null;
let run = 0; // bumps on stop so old loops quit

export const autoDjState = () => st;

export function useAutoDj() {
  const [s, set] = useState(st);
  useEffect(() => {
    subs.add(set);
    return () => subs.delete(set);
  }, []);
  return s;
}

const same = (pb, uri) => pb && uri && (pb.uri === uri || pb.linked === uri);

export async function startAutoDj(songs, options = {}) {
  stopAutoDj('');
  const my = ++run;
  opts = { ...opts, ...options };
  emit({ on: true, error: '', status: 'Finding your songs on Spotify…', index: -1, titles: songs.map((s) => s.title), mixing: false });
  items = [];
  for (const [i, s] of songs.entries()) {
    emit({ status: `Finding songs on Spotify… ${i + 1}/${songs.length}` });
    try {
      items.push({ ...s, uri: s.uri || (await findTrackUri(s.title, s.artist)).uri });
    } catch {
      /* skip songs Spotify doesn't have */
    }
    if (my !== run) return;
  }
  if (!items.length) return stopAutoDj('None of these songs were found on Spotify.', true);
  emit({ titles: items.map((s) => s.title) });

  const pb = await currentPlayback();
  if (my !== run) return;
  if (pb?.isPlaying) {
    // let the current song play, then mix into song 1 near its end
    expected = pb.uri;
    baseVolume = pb.volume;
    emit({ index: -1, status: `Mixing into "${items[0].title}" near the end of "${pb.name}"` });
  } else {
    await mixTo(0, { fadeOut: false });
  }
  loop(my);
}

function loop(my) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (my !== run) return;
    if (!st.mixing) {
      const pb = await currentPlayback().catch(() => null);
      if (my !== run) return;
      if (!pb) {
        emit({ status: 'Waiting for Spotify…' });
      } else {
        const next = st.index + 1;
        if (!same(pb, expected)) {
          if (items[next] && same(pb, items[next].uri)) {
            // Spotify moved on by itself (we were late): carry on from there
            expected = items[next].uri;
            emit({ index: next });
          } else {
            return stopAutoDj('You changed the song, so Auto-DJ stopped.');
          }
        }
        const left = pb.durationMs - pb.positionMs;
        emit({ secondsLeft: Math.max(0, Math.round(left / 1000)) });
        if (st.index + 1 >= items.length) {
          emit({ status: `Last song: "${items[st.index]?.title || pb.name}"` });
          if (left < 2000) return stopAutoDj('Set finished. 🎧');
        } else if (pb.isPlaying && left <= opts.fadeOutMs + POLL_MS) {
          await mixTo(st.index + 1, { pb, fadeOutMs: Math.max(1500, Math.min(opts.fadeOutMs, left - 500)) });
        } else {
          emit({ status: `Next: "${items[st.index + 1].title}"` });
        }
      }
    }
    loop(my);
  }, POLL_MS);
}

async function mixTo(i, { pb = null, fadeOut = true, fadeOutMs = opts.fadeOutMs } = {}) {
  const my = run;
  emit({ mixing: true, status: `Mixing into "${items[i].title}"…` });
  try {
    pb = pb || (await currentPlayback());
    const vol = baseVolume ?? pb?.volume ?? 80;
    baseVolume = vol;
    const low = Math.round(vol * 0.12);
    const canFade = pb && pb.supportsVolume;
    if (fadeOut && canFade && pb.isPlaying) await fadeVolume(vol, low, fadeOutMs, pb.deviceId, pb.inPage);
    if (my !== run) return;
    if (canFade && !fadeOut) await fadeVolume(vol, low, 200, pb.deviceId, pb.inPage);
    // play the rest of the set as a list: if we're ever late, Spotify still moves on by itself
    const deviceId = pb?.deviceId || (await ensureDevice());
    await playUris(items.slice(i).map((x) => x.uri), { deviceId, positionMs: opts.skipIntroMs });
    expected = items[i].uri;
    emit({ index: i });
    await sleep(400);
    const now = await currentPlayback().catch(() => null);
    if (canFade && my === run) await fadeVolume(low, vol, opts.fadeInMs, now?.deviceId || pb.deviceId, now?.inPage ?? pb.inPage);
    emit({ status: items[i + 1] ? `Next: "${items[i + 1].title}"` : `Last song: "${items[i].title}"` });
  } catch (e) {
    stopAutoDj(e.message, true);
  } finally {
    emit({ mixing: false });
  }
}

// Mix into the next song right now, from wherever the current song is
export async function mixNow() {
  if (!st.on || st.mixing) return;
  const next = st.index + 1;
  if (!items[next]) return;
  await mixTo(next, { fadeOutMs: 3500 });
}

// Jump the mix to a specific song in the set, right now
export async function mixToIndex(i) {
  if (!st.on || st.mixing || !items[i] || i === st.index) return;
  await mixTo(i, { fadeOutMs: 3500 });
}

export async function stopAutoDj(message = '', isError = false) {
  run++;
  clearTimeout(timer);
  const restore = baseVolume;
  baseVolume = null;
  expected = null;
  emit({ on: false, mixing: false, status: isError ? '' : message, error: isError ? message : '', secondsLeft: null });
  // put the volume back if we stopped halfway through a fade
  if (restore != null) {
    const pb = await currentPlayback().catch(() => null);
    if (pb?.supportsVolume && Math.abs(pb.volume - restore) > 3) await fadeVolume(pb.volume, restore, 600, pb.deviceId, pb.inPage);
  }
}
