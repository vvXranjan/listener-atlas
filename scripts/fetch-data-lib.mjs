// Shared Apify calls (used by fetch-data.mjs and the dev server).

import fs from 'node:fs';
import { normalizeArtist } from './normalize.mjs';

const ACTOR = 'khadinakbar~spotify-artist-scraper';
export const LIVE_FILE = 'src/data/live.json';

export async function fetchArtists(names, token) {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artistNames: names, maxResults: names.length, responseFormat: 'concise' }),
  });
  if (!res.ok) throw new Error(`Apify error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export function readArtistList() {
  return fs
    .readFileSync('artists.txt', 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}

// Pull every artist in artists.txt and save to src/data/live.json
export async function refreshLive(token) {
  const names = readArtistList();
  const raw = await fetchArtists(names, token);
  const artists = raw.map(normalizeArtist);
  const updatedAt = new Date().toISOString();
  fs.writeFileSync(LIVE_FILE, JSON.stringify({ source: 'Spotify via Apify', updatedAt, artists }, null, 1));
  return { count: artists.length, updatedAt };
}
