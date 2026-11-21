// Pulls fresh Spotify numbers for every artist in artists.txt via Apify.
//
//   npm run fetch-data            -> refresh once
//   npm run fetch-data -- --watch -> refresh every 24 hours (leave it running)
//
// Needs APIFY_TOKEN in a .env file (see .env.example).
// Apify's free plan includes $5/month; one refresh of 60 artists costs about $0.21.

import fs from 'node:fs';
import { refreshLive } from './fetch-data-lib.mjs';

const WATCH_HOURS = 24;

function loadToken() {
  if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN;
  if (fs.existsSync('.env')) {
    const m = fs.readFileSync('.env', 'utf8').match(/^APIFY_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error('Missing APIFY_TOKEN. Copy .env.example to .env and paste your token.');
  process.exit(1);
}

async function runOnce() {
  const token = loadToken();
  console.log('Fetching artists from Spotify (via Apify)…');
  const { count, updatedAt } = await refreshLive(token);
  console.log(`✓ ${count} artists saved at ${updatedAt}. Cost ≈ $${(count * 0.0035).toFixed(2)}`);
}

await runOnce();
if (process.argv.includes('--watch')) {
  console.log(`Watching: refreshing every ${WATCH_HOURS} hours. Press Ctrl+C to stop.`);
  setInterval(() => runOnce().catch((e) => console.error(e.message)), WATCH_HOURS * 3600 * 1000);
}
