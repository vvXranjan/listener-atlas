// Turns raw Apify "spotify-artist-scraper" records into the shape the app uses,
// and adds map coordinates to each city (offline, via the all-the-cities package).

import cities from 'all-the-cities';

// Spotify city names that don't match the city database directly
const OVERRIDES = {
  'Kochi|IN': [76.2673, 9.9312],
  'Gurugram|IN': [77.0266, 28.4595],
  'Quezon City|PH': [121.0509, 14.6488],
};

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// name|country -> best match (largest population)
const index = new Map();
for (const c of cities) {
  for (const n of [c.name, ...(c.altName ? c.altName.split(',') : [])]) {
    const key = `${strip(n)}|${c.country}`;
    const prev = index.get(key);
    if (!prev || prev.population < c.population) index.set(key, c);
  }
}

export function geocode(city, country) {
  if (OVERRIDES[`${city}|${country}`]) return OVERRIDES[`${city}|${country}`];
  const variants = [city, city.replace(/ City$/, ''), city.replace(/ am Main$/, '')];
  for (const v of variants) {
    const hit = index.get(`${strip(v)}|${country}`);
    if (hit) return hit.loc.coordinates.map((n) => +n.toFixed(4));
  }
  return null;
}

export function normalizeArtist(raw) {
  const cityList = (raw.topCities || [])
    .map((c) => ({
      city: c.city,
      country: c.country,
      region: c.region || '',
      listeners: c.listeners,
      position: geocode(c.city, c.country),
    }))
    .filter((c) => {
      if (!c.position) console.warn(`  ! no coordinates for ${c.city}, ${c.country} — skipped`);
      return c.position;
    });

  const img = (x) => (typeof x === 'string' ? x : x?.url || x?.sources?.[0]?.url || null);

  return {
    id: raw.id,
    name: raw.name,
    listeners: raw.monthlyListeners ?? 0,
    followers: raw.followers ?? 0,
    worldRank: raw.worldRank ?? null,
    image: raw.avatarImage || null,
    updatedAt: raw.scrapedAt || new Date().toISOString(),
    cities: cityList,
    // Spotify page details (present when fetched through Apify)
    verified: raw.verified ?? null,
    header: img(raw.headerImage),
    bio: raw.biography ? raw.biography.replace(/<[^>]+>/g, '').trim() : null,
    topTracks: (raw.topTracks || []).slice(0, 10).map((t) => ({ name: t.name, id: t.id, plays: t.playcount ?? null })),
    related: (raw.relatedArtists || []).slice(0, 10).map((a) => ({ name: a.name, id: a.id, image: img(a.image) })),
    releases: (raw.popularReleases || []).slice(0, 8).map((r) => ({
      name: r.name,
      date: r.date,
      type: r.type,
      cover: img(r.coverArt),
      url: r.url,
    })),
    concerts: (raw.upcomingConcerts || []).slice(0, 5).map((c) => ({ title: c.title, date: c.date, venue: c.venue, city: c.city })),
    links: (raw.externalLinks || []).slice(0, 6).map((l) => ({ name: l.name, url: l.url })),
  };
}
