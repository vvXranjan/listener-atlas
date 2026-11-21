import { useEffect, useState } from 'react';
import { onNow, getNow } from './nowStore.js';
import { getSet, saveSet, addToSet, addPlayed, getPlayed, getPrefs, onPrefsChange, onSetChange, songId } from './setStore.js';
import { findTrackUri, getQueue, queueUri, canQueue, isLoggedIn } from './spotify.js';
import { autoDjState } from './autoDj.js';
import { everyWhileVisible } from './visibility.js';

// Keeps "Your set" in step with what's actually playing on your Spotify:
//  - songs drop off once they play (they go to "Played")
//  - optionally tops the set up to 3 upcoming songs with the best matches
//  - optionally puts the next set song into Spotify's own queue, so Spotify follows your set

export const UP_NEXT = 3;
const firstArtist = (a) => a.split(/,|&| with | feat\.? /i)[0].trim();

export const nowSong = (t) =>
  t ? { title: t.name, artist: t.artists.map((a) => a.name).join(', '), uri: t.id ? `spotify:track:${t.id}` : null, cover: t.cover } : null;

// ---------- suggestions (best matches after a song) ----------
const recCache = new Map();
export async function suggestionsAfter(song) {
  if (!song) return [];
  const k = songId(song);
  if (recCache.has(k)) return recCache.get(k);
  const qs = new URLSearchParams({ title: song.title, artists: song.artist.split(/,|&/).map((x) => x.trim()).filter(Boolean).join('|') });
  const p = fetch(`/api/recommend?${qs}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => [...(j?.picks || []), ...(j?.pool || [])])
    .catch(() => []);
  recCache.set(k, p);
  const list = await p;
  if (!list.length) recCache.delete(k); // try again later
  return list;
}

// songs we shouldn't suggest: already in the set, playing now, or played recently
function taken() {
  const n = nowSong(getNow().track);
  return new Set([...getSet(), ...getPlayed(), ...(n ? [n] : [])].map(songId));
}

export async function bestNextFor(anchor, count = 1) {
  const skip = taken();
  const out = [];
  for (const s of await suggestionsAfter(anchor)) {
    const id = songId(s);
    if (skip.has(id)) continue;
    skip.add(id);
    out.push(s);
    if (out.length >= count) break;
  }
  return out;
}

// ---------- engine ----------
let started = false;
let lastTrackId = null;
let filling = false;
const queued = new Set(); // set songs we've already put in Spotify's queue

// The song now playing is in the set? Then it (and anything before it) has played.
export function dropPlayed(track) {
  const n = nowSong(track);
  if (!n) return false;
  const set = getSet();
  const idx = set.findIndex((s) => (s.uri && s.uri === n.uri) || songId(s) === songId(n));
  if (idx < 0) return false;
  addPlayed(set.slice(0, idx + 1));
  saveSet(set.slice(idx + 1));
  return true;
}

async function fill() {
  if (filling || !getPrefs().autoFill) return;
  filling = true;
  try {
    for (let guard = 0; guard < UP_NEXT && getSet().length < UP_NEXT; guard++) {
      const set = getSet();
      const anchor = set[set.length - 1] || nowSong(getNow().track);
      const [pick] = await bestNextFor(anchor, 1);
      if (!pick) break;
      addToSet({ ...pick, auto: true });
    }
  } finally {
    filling = false;
  }
}

async function syncQueue() {
  if (!getPrefs().syncQueue || !isLoggedIn() || !canQueue() || autoDjState().on) return;
  const next = getSet()[0];
  if (!next) return;
  const id = songId(next);
  if (queued.has(id)) return;
  try {
    const q = await getQueue().catch(() => null);
    if (q?.queue?.slice(0, 5).some((t) => songId(t) === id)) {
      queued.add(id);
      return;
    }
    const uri = next.uri || (await findTrackUri(next.title, firstArtist(next.artist))).uri;
    await queueUri(uri);
    queued.add(id);
  } catch {
    /* nothing playing yet: try again on the next song change */
  }
}

let timer = null;
const soon = () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await fill();
    await syncQueue();
  }, 800);
};

export function startSetSync() {
  if (started) return;
  started = true;
  onNow((n) => {
    const id = n.track?.id || null;
    if (!id || id === lastTrackId) return;
    lastTrackId = id;
    if (getPrefs().dropPlayed) dropPlayed(n.track);
    soon();
  });
  onSetChange(soon);
  onPrefsChange(soon);
}

// ---------- Spotify's real queue, for the "On Spotify next" strip ----------
export function useSpotifyQueue(enabled) {
  const [q, setQ] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      getQueue()
        .then((r) => alive && setQ(r))
        .catch(() => alive && setQ(null));
    const stopPoll = everyWhileVisible(load, 20000);
    let lastId = getNow().track?.id;
    const off = onNow((n) => {
      if (n.track?.id === lastId) return;
      lastId = n.track?.id;
      setTimeout(load, 1200); // give Spotify a moment to update its queue
    });
    return () => {
      alive = false;
      stopPoll();
      off();
    };
  }, [enabled]);
  return q;
}
