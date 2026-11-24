// Jam, the host side: start a Jam, show its link, and every few seconds
//  1. tell the Jam page what's playing and what's next,
//  2. take the songs friends added and put them in your set right after the song playing now
//     (in the order they were added), so Auto-DJ plays them next.
import { useEffect, useState } from 'react';
import { getSet, saveSet, songId } from './setStore.js';
import { getNow } from './nowStore.js';
import { after } from './ticker.js';

const KEY = 'jam-host-v1';
const SYNC_MS = 3000;

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
};
const write = (v) => {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
};

let st = { jam: read(), guests: 0, added: [], error: '', busy: false };
const subs = new Set();
const emit = (p) => {
  st = { ...st, ...p };
  subs.forEach((fn) => fn(st));
};
export const jamState = () => st;
export function useJam() {
  const [s, set] = useState(st);
  useEffect(() => {
    subs.add(set);
    return () => subs.delete(set);
  }, []);
  return s;
}

export async function jamApi(body) {
  const r = await fetch('/api/jam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error || `Jam error ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

export const jamLink = (code, origin = location.origin) => `${origin}/?jam=${code}`;

// ---------- putting guests' songs in the set ----------
const nowSong = (n = getNow()) =>
  n?.track ? { title: n.track.name, artist: (n.track.artists || []).map((a) => a.name).join(', '), cover: n.track.cover || null } : null;

// Insert guests' songs right after the song playing now, after any guest songs already waiting there
// (first added, first played). A song already further down your set moves up instead of doubling.
export function insertJamSongs(set, adds, playing) {
  if (!adds?.length) return set;
  let list = [...set];
  const at = playing ? list.findIndex((s) => songId(s) === songId(playing)) : -1;
  const playingId = playing ? songId(playing) : null;
  const fresh = [];
  for (const a of adds) {
    const id = songId(a);
    if (id === playingId || fresh.some((f) => songId(f) === id)) continue;
    const old = list.findIndex((s, i) => i > at && songId(s) === id);
    if (old >= 0) list.splice(old, 1);
    fresh.push({ title: a.title, artist: a.artist, cover: a.cover || null, preview: a.preview || null, uri: a.uri || null, by: a.by || 'Guest' });
  }
  if (!fresh.length) return set;
  let pos = at + 1;
  while (pos < list.length && list[pos].by) pos++; // after the guest songs already waiting
  list.splice(pos, 0, ...fresh);
  return list;
}

// what the Jam page shows as "Up next"
function upNext(set, playing) {
  const at = playing ? set.findIndex((s) => songId(s) === songId(playing)) : -1;
  return set.slice(at + 1, at + 11).map(({ title, artist, cover, uri, by }) => ({ title, artist, cover, uri, by: by || null }));
}

// ---------- the loop ----------
let run = 0;
let cancel = null;

async function syncOnce(my) {
  const jam = st.jam;
  if (!jam) return;
  const n = getNow();
  const playing = nowSong(n);
  const set = getSet();
  const cur = playing && set.find((s) => songId(s) === songId(playing));
  try {
    const r = await jamApi({
      action: 'sync',
      code: jam.code,
      hostKey: jam.hostKey,
      now: playing ? { ...playing, uri: n.track.id ? `spotify:track:${n.track.id}` : null, playing: !!n.playing, by: cur?.by || null } : null,
      next: upNext(set, playing),
    });
    if (my !== run) return;
    if (r.adds?.length) {
      saveSet(insertJamSongs(getSet(), r.adds, playing));
      emit({ added: [...r.adds.map((a) => ({ ...a, at: Date.now() })), ...st.added].slice(0, 30) });
    }
    emit({ guests: r.guests || 0, error: '' });
  } catch (e) {
    if (my !== run) return;
    if (e.status === 403 || e.status === 404) {
      write(null);
      emit({ jam: null, error: 'Your Jam ended (it expires after 8 hours without you).' });
      return;
    }
    emit({ error: e.status === 503 ? e.message : 'Jam: connection lost, retrying…' });
  }
}

function loop(my) {
  cancel?.();
  cancel = after(SYNC_MS, async () => {
    if (my !== run || !st.jam) return;
    await syncOnce(my);
    if (my === run && st.jam) loop(my);
  });
}

export async function startJam(host = 'Jam') {
  emit({ busy: true, error: '' });
  try {
    const r = await jamApi({ action: 'create', host });
    const jam = { code: r.code, hostKey: r.hostKey, host: r.host, startedAt: Date.now() };
    write(jam);
    emit({ jam, guests: 0, added: [] });
    const my = ++run;
    await syncOnce(my);
    loop(my);
    return jam;
  } catch (e) {
    emit({ error: e.message });
    throw e;
  } finally {
    emit({ busy: false });
  }
}

export async function endJam() {
  const jam = st.jam;
  run++;
  cancel?.();
  write(null);
  emit({ jam: null, guests: 0, added: [] });
  if (jam) await jamApi({ action: 'end', code: jam.code, hostKey: jam.hostKey }).catch(() => {});
}

// after a refresh, carry on with the Jam you were hosting
export function resumeJam() {
  if (!st.jam || cancel) return;
  const my = ++run;
  syncOnce(my).then(() => my === run && st.jam && loop(my));
}

export const openJam = () => window.dispatchEvent(new CustomEvent('open-jam'));
