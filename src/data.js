// Data layer. Today it returns SAMPLE data.
// Later, replace getArtistCities() with a call to your backend
// (Chartmetric "where-people-listen" or an Apify scraper).

import { CITIES, STATES } from './geo.js';

const NORTH = ['Punjab', 'Haryana', 'Delhi', 'Chandigarh', 'Himachal Pradesh', 'Jammu and Kashmir'];
const HINDI = ['Uttar Pradesh', 'Bihar', 'Madhya Pradesh', 'Rajasthan', 'Delhi', 'Uttarakhand', 'Jharkhand', 'Chhattisgarh'];
const SOUTH = ['Tamil Nadu', 'Kerala', 'Karnataka', 'Telangana', 'Andhra Pradesh'];

// Sample artist profiles: total India monthly listeners + regional boost
export const SAMPLE_ARTISTS = {
  'Arijit Singh': { total: 38_000_000, boost: { 'West Bengal': 1.8, ...each(HINDI, 1.3) } },
  'Diljit Dosanjh': { total: 16_000_000, boost: each(NORTH, 2.6) },
  'Karan Aujla': { total: 12_000_000, boost: each(NORTH, 3) },
  'AP Dhillon': { total: 11_000_000, boost: each(NORTH, 2.8) },
  'Shreya Ghoshal': { total: 22_000_000, boost: { 'West Bengal': 1.6, ...each(SOUTH, 1.3) } },
  'Anirudh Ravichander': { total: 20_000_000, boost: each(SOUTH, 3.2) },
  'Sid Sriram': { total: 14_000_000, boost: each(SOUTH, 3.5) },
  'Anuv Jain': { total: 9_000_000, boost: { Delhi: 1.8, Karnataka: 1.5, Maharashtra: 1.4 } },
  'Pritam': { total: 30_000_000, boost: each(HINDI, 1.4) },
  'Badshah': { total: 15_000_000, boost: { ...each(NORTH, 1.8), ...each(HINDI, 1.2) } },
};

function each(list, v) {
  return Object.fromEntries(list.map((s) => [s, v]));
}

// Small seeded random so the same artist always gives the same numbers
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// Returns [{ city, state, position, listeners }]
export async function getArtistCities(artistName) {
  const name = artistName.trim();
  const profile = SAMPLE_ARTISTS[name] || {
    total: 2_000_000 + Math.floor(seeded(name)() * 10_000_000),
    boost: {},
  };
  const rand = seeded(name.toLowerCase());

  const weights = CITIES.map(([, state, , pop]) => {
    const noise = 0.6 + rand() * 0.8;
    return pop * (profile.boost[state] || 1) * noise;
  });
  const sum = weights.reduce((a, b) => a + b, 0);

  return CITIES.map(([city, state, position], i) => ({
    city,
    state,
    position,
    listeners: Math.round((weights[i] / sum) * profile.total),
  }));
}

// Sum cities into states
export function toStates(cities) {
  const map = {};
  for (const c of cities) {
    map[c.state] = (map[c.state] || 0) + c.listeners;
  }
  return Object.entries(map).map(([state, listeners]) => ({
    state,
    position: STATES[state],
    listeners,
  }));
}
