import { useEffect, useState } from 'react';
import { accessToken, canLibrary, isLoggedIn, recentPlays } from './spotify.js';
import { emptyDoc, mergePlays, habitStrength, habitCount, habitsAfter, playedWithin } from './habitsCore.js';
import { getPrefs, setPref, onPrefsChange } from './setStore.js';
import { onNow } from './nowStore.js';
import { after } from './ticker.js';

// Learns which songs you play after which, from Spotify's "recently played" (every device).
// Saved in the cloud (/api/habits) so all your devices share it; falls back to this
// browser if the cloud database isn't set up.

const LOCAL_KEY = 'listener-habits-v1';
let doc = loadLocal();
let state = { mode: 'unknown', syncing: false, lastSync: 0, error: '' }; // mode: cloud | local | unknown
const subs = new Set();
const emit = () => subs.forEach((fn) => fn({ doc, ...state }));

function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null') || emptyDoc();
  } catch {
    return emptyDoc();
  }
}
function saveLocal(d) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(d));
  } catch {
    /* storage full or blocked */
  }
}

export const getHabits = () => doc;

// How much your own habits count vs community data: 0.25, 0.5 or 0.75
export const habitWeight = () => {
  const w = Number(getPrefs().habitWeight);
  return [0.25, 0.5, 0.75].includes(w) ? w : 0.5;
};
export const setHabitWeight = (w) => setPref('habitWeight', w);

async function cloud(method, payload) {
  const token = await accessToken();
  const r = await fetch('/api/habits', {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (r.status === 503) return null; // no cloud database: use this browser
  if (!r.ok || !r.headers.get('content-type')?.includes('json')) throw new Error(`Habits sync failed (${r.status})`);
  return r.json();
}

let running = null;
export function syncHabits() {
  if (running) return running;
  if (!isLoggedIn() || !canLibrary()) return Promise.resolve(doc);
  state = { ...state, syncing: true, error: '' };
  emit();
  running = (async () => {
    try {
      const plays = await recentPlays();
      const fromCloud = await cloud('POST', { plays }).catch((e) => {
        state.error = e.message;
        return null;
      });
      if (fromCloud) {
        doc = { ...fromCloud };
        delete doc.cloud;
        state.mode = 'cloud';
      } else {
        doc = mergePlays(doc, plays);
        state.mode = 'local';
      }
      saveLocal(doc); // a copy here too, so it works offline
      state.lastSync = Date.now();
    } catch (e) {
      state.error = e.message;
    } finally {
      state.syncing = false;
      running = null;
      emit();
    }
    return doc;
  })();
  return running;
}

export async function clearHabits() {
  try {
    await cloud('DELETE');
  } catch {
    /* clear this browser anyway */
  }
  doc = emptyDoc();
  saveLocal(doc);
  emit();
}

let started = false;
export function startHabits() {
  if (started) return;
  started = true;
  after(3000, () => syncHabits());
  // a song just changed: the one before it is now in "recently played"
  let lastId = null;
  let cancel = null;
  onNow((n) => {
    const id = n.track?.id;
    if (!id || id === lastId) return;
    lastId = id;
    cancel?.();
    cancel = after(20000, () => syncHabits());
  });
  const loop = () =>
    after(10 * 60 * 1000, async () => {
      await syncHabits();
      loop();
    });
  loop();
}

export function useHabits() {
  const [s, set] = useState({ doc, ...state, weight: habitWeight() });
  useEffect(() => {
    const fn = (v) => set({ ...v, weight: habitWeight() });
    subs.add(fn);
    const off = onPrefsChange(() => set((cur) => ({ ...cur, weight: habitWeight() })));
    return () => {
      subs.delete(fn);
      off();
    };
  }, []);
  return s;
}

// ---------- scoring helpers used by Mix Lab, auto-fill and radio ----------
// Blend your habit with community "played together" data: 0..1
export function blendedMatch(from, to, communityMatch = 0, w = habitWeight()) {
  const h = habitStrength(doc, from, to);
  return w * h + (1 - w) * (Math.max(0, Math.min(100, communityMatch)) / 100);
}
export const habitTimes = (from, to) => habitCount(doc, from, to);
export const usualNext = (song, limit = 6) => habitsAfter(doc, song, Date.now(), limit);
export const playedRecently = (song, ms = 60 * 60 * 1000) => playedWithin(doc, song, ms);
