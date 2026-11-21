// Builds src/data/live.json from the bundled snapshot (data/seed-compact.json).
// Run: npm run build-seed

import fs from 'node:fs';
import { normalizeArtist } from './normalize.mjs';

const seed = JSON.parse(fs.readFileSync('data/seed-compact.json', 'utf8'));

const raw = seed.artists.map(([name, id, monthlyListeners, followers, worldRank, img, cities]) => ({
  name,
  id,
  monthlyListeners,
  followers,
  worldRank,
  avatarImage: img ? seed.imgPrefix + img : null,
  scrapedAt: seed.scrapedAt,
  topCities: cities.map(([city, country, region, listeners]) => ({ city, country, region, listeners })),
}));

const artists = raw.map(normalizeArtist);
fs.mkdirSync('src/data', { recursive: true });
fs.writeFileSync(
  'src/data/live.json',
  JSON.stringify({ source: 'Spotify via Apify', updatedAt: seed.scrapedAt, artists }, null, 1)
);
console.log(`Wrote ${artists.length} artists to src/data/live.json`);
