import { useEffect, useState } from 'react';

// What's playing on your Spotify right now, shared by every part of the app
// (Now Playing card, Mix Lab, floating set, sync engine).
let now = { track: null, playing: false, progressMs: 0, fetchedAt: 0 };
const subs = new Set();

export const getNow = () => now;
export function setNow(next) {
  now = { ...now, ...next };
  subs.forEach((fn) => fn(now));
}
export function onNow(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function useNow() {
  const [n, set] = useState(now);
  useEffect(() => onNow(set), []);
  return n;
}
