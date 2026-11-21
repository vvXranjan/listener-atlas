// Free data sources used by the dev server (no keys needed):
//  - City charts:   Apple Music public "Top 25: <City>" charts (fallback: "Top 100: <Country>")
//  - Song previews: iTunes Lookup API
//  - Artist bios:   Wikipedia REST API
//  - Albums/songs:  iTunes Search API
// Everything is cached in memory so we stay polite to these services.

import cities from 'all-the-cities';

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' };
const regionName = new Intl.DisplayNames(['en'], { type: 'region' });

export const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const slugify = (s) => strip(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- tiny cache ----------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

async function getText(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.text();
}
async function getJSON(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json();
}

// ---------- city search (offline) ----------
const byPop = [...cities].filter((c) => c.population >= 50000).sort((a, b) => b.population - a.population);

export function searchCities(q, limit = 8) {
  const s = strip(q);
  if (!s) return [];
  const out = [];
  for (const c of byPop) {
    if (strip(c.name).startsWith(s)) {
      out.push({
        name: c.name,
        country: c.country,
        countryName: regionName.of(c.country) || c.country,
        population: c.population,
        position: c.loc.coordinates,
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// ---------- Apple Music charts ----------
async function searchPlaylists(storefront, term) {
  const html = await getText(`https://music.apple.com/${storefront}/search?term=${encodeURIComponent(term)}&l=en-US`);
  const seen = new Map();
  for (const m of html.matchAll(/music\.apple\.com\/[a-z]{2}\/playlist\/([a-z0-9-]+)\/(pl\.[a-f0-9]+)/g)) {
    if (!seen.has(m[1])) seen.set(m[1], m[2]);
  }
  return seen; // slug -> id
}

async function findChart(city, cc) {
  const sf = cc.toLowerCase();
  const wanted = new Set([`top-25-${slugify(city)}`, `top-25-${slugify(city.replace(/ city$/i, ''))}`]);
  const found = await searchPlaylists(sf, `Top 25: ${city}`);
  for (const [slug, id] of found) if (wanted.has(slug)) return { sf, slug, id, scope: 'city' };

  // No city chart -> country chart
  const country = regionName.of(cc) || cc;
  const found2 = await searchPlaylists(sf, `Top 100: ${country}`);
  for (const [slug, id] of found2) {
    if (slug.startsWith('top-100-') && slug !== 'top-100-global') return { sf, slug, id, scope: 'country' };
  }
  for (const [slug, id] of found2) if (slug === 'top-100-global') return { sf, slug, id, scope: 'global' };
  return null;
}

function art(dict, size = 200) {
  const u = dict?.dictionary?.url || dict?.url;
  return u ? u.replace('{w}x{h}cc.{f}', `${size}x${size}bb.jpg`).replace('{w}x{h}bb.{f}', `${size}x${size}bb.jpg`) : null;
}

async function fetchChart({ sf, slug, id }) {
  const url = `https://music.apple.com/${sf}/playlist/${slug}/${id}`;
  const html = await getText(`${url}?l=en-US`);
  const m = html.match(/<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Apple Music page format changed');
  const data = JSON.parse(m[1]);
  let items = null;
  let header = null;
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (!items && o.itemKind === 'trackLockup' && Array.isArray(o.items)) items = o.items;
    if (!header && typeof o.id === 'string' && o.id.startsWith('playlist-detail-header')) header = o;
    for (const v of Object.values(o)) walk(v);
  })(data);
  if (!items) throw new Error('No tracks found in chart');

  const tracks = items.map((it, i) => ({
    rank: Number(it.rankingText) || i + 1,
    id: it.contentDescriptor?.identifiers?.storeAdamID || null,
    title: it.title,
    artist: it.artistName,
    artwork: art(it.artwork),
    url: it.contentDescriptor?.url || null,
    explicit: !!it.showExplicitBadge,
    durationMs: it.duration || null,
  }));

  // 30-second previews + genre (iTunes Lookup, free)
  const ids = tracks.map((t) => t.id).filter(Boolean);
  if (ids.length) {
    try {
      const look = await getJSON(`https://itunes.apple.com/lookup?id=${ids.join(',')}&country=${sf}`);
      const byId = new Map(look.results.map((r) => [String(r.trackId), r]));
      for (const t of tracks) {
        const r = byId.get(String(t.id));
        if (r) {
          t.preview = r.previewUrl || null;
          t.genre = r.primaryGenreName || null;
        }
      }
    } catch {
      /* previews are a bonus */
    }
  }
  const pretty = slug.replace(/^top-(\d+)-/, (m, n) => `Top ${n}: `).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { title: header?.title || pretty, url, artwork: art(header?.artwork, 400), tracks };
}

export async function getCityChart(name, cc) {
  let city = null;
  if (cc) {
    city = byPop.find((c) => c.country === cc.toUpperCase() && strip(c.name) === strip(name));
  }
  city ||= byPop.find((c) => strip(c.name) === strip(name)) || byPop.find((c) => strip(c.name).startsWith(strip(name)));
  if (!city) throw new Error(`Couldn't find a city called "${name}"`);

  const key = `chart|${city.country}|${city.name}`;
  return cached(key, 10 * 60 * 1000, async () => {
    const where = await findChart(city.name, city.country);
    if (!where) throw new Error(`No Apple Music chart for ${city.name}`);
    const chart = await fetchChart(where);

    // which artists dominate this chart?
    const counts = new Map();
    for (const t of chart.tracks) {
      for (const a of t.artist.split(/,|&| x | feat\.? /i).map((s) => s.trim()).filter(Boolean)) {
        counts.set(a, (counts.get(a) || 0) + 1);
      }
    }
    const topArtists = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, songs]) => ({ name, songs }));

    return {
      city: city.name,
      country: city.country,
      countryName: regionName.of(city.country) || city.country,
      position: city.loc.coordinates,
      scope: where.scope,
      chart,
      topArtists,
      source: 'Apple Music charts (updated daily)',
      fetchedAt: new Date().toISOString(),
    };
  });
}

// ---------- artist info (Wikipedia + iTunes) ----------
const MUSIC_WORDS = /singer|rapper|musician|band|composer|songwriter|music|dj|producer|duo|group|vocalist|artist/i;

async function wiki(name) {
  const tries = [name, `${name} (musician)`, `${name} (singer)`, `${name} (rapper)`, `${name} (band)`, `${name} (composer)`, `${name} (DJ)`];
  for (const t of tries) {
    try {
      const j = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`);
      if (j.type === 'standard' && MUSIC_WORDS.test(`${j.description} ${j.extract}`)) {
        return {
          description: j.description || null,
          bio: j.extract || null,
          image: j.originalimage?.source || j.thumbnail?.source || null,
          url: j.content_urls?.desktop?.page || null,
        };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

async function itunesArtist(name) {
  const s = await getJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=1`);
  const a = s.results?.[0];
  if (!a) return null;
  const [albums, songs] = await Promise.all([
    getJSON(`https://itunes.apple.com/lookup?id=${a.artistId}&entity=album&limit=12&sort=recent`),
    getJSON(`https://itunes.apple.com/lookup?id=${a.artistId}&entity=song&limit=10`),
  ]);
  return {
    genre: a.primaryGenreName || null,
    appleUrl: a.artistLinkUrl || null,
    albums: albums.results
      .filter((r) => r.wrapperType === 'collection')
      .slice(0, 10)
      .map((r) => ({
        name: r.collectionName,
        year: r.releaseDate?.slice(0, 4),
        date: r.releaseDate,
        tracks: r.trackCount,
        artwork: r.artworkUrl100?.replace('100x100bb', '300x300bb'),
        url: r.collectionViewUrl,
      })),
    songs: songs.results
      .filter((r) => r.wrapperType === 'track')
      .map((r) => ({
        name: r.trackName,
        album: r.collectionName,
        artwork: r.artworkUrl100,
        preview: r.previewUrl,
        durationMs: r.trackTimeMillis,
      })),
  };
}

export async function getArtistInfo(name) {
  return cached(`artist|${strip(name)}`, 6 * 3600 * 1000, async () => {
    const [w, it] = await Promise.all([wiki(name).catch(() => null), itunesArtist(name).catch(() => null)]);
    return { name, wiki: w, itunes: it, fetchedAt: new Date().toISOString() };
  });
}
