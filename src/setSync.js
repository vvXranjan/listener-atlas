import { useEffect, useState } from 'react';
import { onNow, getNow } from './nowStore.js';
import { getSet, saveSet, addToSet, addPlayed, getPlayed, getPrefs, onPrefsChange, onSetChange, songId } from './setStore.js';
import { findTrackUri, getQueue, queueUri, canQueue, isLoggedIn } from './spotify.js';
import { autoDjState } from './autoDj.js';
import { everyWhileVisible } from './visibility.js';
import { blendedMatch, usualNext, playedRecently, habitTimes } from './habits.js';
import { after } from './ticker.js';

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

// Best songs to play after `anchor`: your own habits and community "played together" data,
// blended by your Mine/Discovery setting. Skips songs already in the set, playing now,
// or played in the last hour.
export async function bestNextFor(anchor, count = 1) {
  const skip = taken();
  const byId = new Map();
  for (const h of usualNext(anchor, 8)) byId.set(songId(h), { ...h, match: 0, source: 'habit' });
  for (const r of await suggestionsAfter(anchor)) {
    const id = songId(r);
    byId.set(id, { ...r, ...(byId.has(id) ? { source: 'habit+data' } : {}) });
  }
  return [...byId.values()]
    .filter((s) => !skip.has(songId(s)) && !playedRecently(s))
    .map((s) => {
      const n = habitTimes(anchor, s);
      return { ...s, habit: n ? `You play this after ${anchor.title} (${n}×)` : null, score: blendedMatch(anchor, s, s.match || 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

// Radio: make sure there's a song after `current`; add the best one if not. Returns it.
export async function ensureNext(current) {
  const set = getSet();
  const at = set.findIndex((s) => (s.uri && s.uri === current.uri) || songId(s) === songId(current));
  if (at >= 0 ? set[at + 1] : set.some((s) => songId(s) !== songId(current))) return null;
  const [pick] = await bestNextFor(current, 1);
  if (!pick) return null;
  addToSet({ ...pick, auto: true });
  return getSet().find((s) => songId(s) === songId(pick)) || null;
}

// ---------- engine ----------
let started = false;
let stopLoop = null;
let lastTrackId = null;
let filling = false;

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

// "Keep Spotify's queue in sync", just in time: the next set song goes into Spotify's
// queue only in the last 25 s of the current song. Spotify has no way to take a song
// back out of its queue, so adding it late means your set changes before then still count.
export const QUEUE_LEAD_MS = 25000;
const queuedFor = new Set(); // `${playing track}>${next song}` already queued

export function msLeft(n = getNow(), now = Date.now()) {
  const t = n.track;
  if (!t?.durationMs) return Infinity;
  return t.durationMs - (n.progressMs + (n.playing ? now - n.fetchedAt : 0));
}

async function syncQueue() {
  if (!getPrefs().syncQueue || !isLoggedIn() || !canQueue() || autoDjState().on) return;
  const n = getNow();
  if (!n.track?.id || !n.playing || msLeft(n) > QUEUE_LEAD_MS) return;
  const set = getSet();
  const playing = nowSong(n.track);
  const at = set.findIndex((s) => songId(s) === songId(playing));
  const next = at >= 0 ? set[at + 1] : set[0];
  if (!next) return;
  const key = `${n.track.id}>${songId(next)}`;
  if (queuedFor.has(key)) return;
  queuedFor.add(key);
  try {
    const q = await getQueue().catch(() => null);
    if (q?.queue?.[0] && songId(q.queue[0]) === songId(next)) return; // already next in Spotify
    const uri = next.uri || (await findTrackUri(next.title, firstArtist(next.artist))).uri;
    await queueUri(uri);
  } catch {
    queuedFor.delete(key); // try again on the next check
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
  // check every 4 s (on time even in a background tab) whether it's time to queue the next song
  const loop = () => {
    stopLoop = after(4000, async () => {
      await syncQueue().catch(() => {});
      if (started) loop();
    });
  };
  loop();
}

// Stop the background checks (used by tests; the app keeps it running)
export function stopSetSync() {
  started = false;
  stopLoop?.();
  stopLoop = null;
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
