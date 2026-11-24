// Your Mix Lab set, shared by Mix Lab, the floating window and the Library.
// Saved in this browser and kept in sync between tabs.
const KEY = 'mixlab-set-v1';
const PLAYED_KEY = 'mixlab-played-v1';
const PREFS_KEY = 'mixlab-set-prefs-v1';
const subs = new Set();
const playedSubs = new Set();
const prefSubs = new Set();

// same song even if the artists are written differently ("A, B" vs "A & B") or with "(feat. …)"
export const songId = (s) =>
  `${(s.title || '').toLowerCase().replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim()}|${(s.artist || '')
    .toLowerCase()
    .split(/,|&| with | feat\.? | x /)[0]
    .trim()}`;
const idOf = songId;

const read = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null') ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
};
const slim = (s) => ({
  title: s.title,
  artist: s.artist,
  cover: s.cover || null,
  preview: s.preview || null,
  uri: s.uri || null,
  appleUrl: s.appleUrl || null,
  auto: !!s.auto,
  queued: !!s.queued,
  habit: s.habit || null,
  by: s.by || null, // added by a friend in your Jam
});

// ---- the set
export const getSet = () => read(KEY, []);
export function saveSet(list) {
  write(KEY, list);
  subs.forEach((fn) => fn(list));
}
export function addToSet(s) {
  const cur = getSet();
  if (cur.some((x) => idOf(x) === idOf(s))) return false;
  saveSet([...cur, slim(s)]);
  return true;
}
export function onSetChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// ---- songs that already played (newest first, last 20)
export const getPlayed = () => read(PLAYED_KEY, []);
export function addPlayed(list) {
  if (!list.length) return;
  const ids = new Set(list.map(idOf));
  const next = [...list.map((s) => ({ ...slim(s), playedAt: Date.now() })).reverse(), ...getPlayed().filter((x) => !ids.has(idOf(x)))].slice(0, 20);
  write(PLAYED_KEY, next);
  playedSubs.forEach((fn) => fn(next));
}
export function clearPlayed() {
  write(PLAYED_KEY, []);
  playedSubs.forEach((fn) => fn([]));
}
export function onPlayedChange(fn) {
  playedSubs.add(fn);
  return () => playedSubs.delete(fn);
}

// ---- set options
export const DEFAULT_PREFS = { dropPlayed: true, autoFill: false, syncQueue: false, radio: true, habitWeight: 0.5, djMode: 'auto', djBars: 'auto' };
export const getPrefs = () => ({ ...DEFAULT_PREFS, ...read(PREFS_KEY, {}) });
export function setPref(k, v) {
  const p = { ...getPrefs(), [k]: v };
  write(PREFS_KEY, p);
  prefSubs.forEach((fn) => fn(p));
}
export function onPrefsChange(fn) {
  prefSubs.add(fn);
  return () => prefSubs.delete(fn);
}

// another tab changed the set: update this one too
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) subs.forEach((fn) => fn(getSet()));
    if (e.key === PLAYED_KEY) playedSubs.forEach((fn) => fn(getPlayed()));
    if (e.key === PREFS_KEY) prefSubs.forEach((fn) => fn(getPrefs()));
  });
}
