// "Up next" — what to play after the current song.
//
// 1. Real listening data: ListenBrainz (open source) learns which songs real people play
//    in the same listening session. We use two views of it: the last 6 months (what's
//    hot now) and long-term (lasting favourites).
// 2. Ranking: combine both, keep artist variety, explain why each pick fits.
// 3. Optional AI: with ANTHROPIC_API_KEY set, Claude picks the best 4 *from these real
//    candidates only* and writes the reasons. Without a key, a transparent rule-based
//    ranking does it.

import { cleanTitle, findRecordingIds, acrLookupFull, artistMbid } from './song.mjs';
import { strip } from './api.mjs';
import { fetchT as fetch } from './http.mjs';

const LABS = 'https://labs.api.listenbrainz.org/similar-recordings/json';
const ARTIST_ALGO = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
export const ALGOS = {
  recent: 'session_based_days_180_session_300_contribution_5_threshold_15_limit_50_skip_30',
  longTerm: 'session_based_days_7500_session_300_contribution_5_threshold_15_limit_50_skip_30',
};

const cache = new Map();
const mainArtist = (credit) => strip(credit.split(/,|&| feat\.? | with | x /i)[0] || credit);

async function similar(mbid, algorithm) {
  const r = await fetch(`${LABS}?recording_mbids=${mbid}&algorithm=${algorithm}`);
  if (!r.ok) throw new Error(`ListenBrainz labs ${r.status}`);
  return r.json();
}

// Merge recent + long-term results into one scored list (exported for tests)
export function mergeCandidates({ recent = [], longTerm = [] }, current) {
  const curTitle = cleanTitle(current.title);
  const curArtists = current.artists.map(strip);
  const isCurrent = (row) =>
    cleanTitle(row.recording_name || '') === curTitle && curArtists.some((a) => strip(row.artist_credit_name || '').includes(a));
  // leave the current song out before scaling, or it would shrink every other score
  recent = recent.filter((r) => !isCurrent(r));
  longTerm = longTerm.filter((r) => !isCurrent(r));
  const maxR = Math.max(1, ...recent.map((x) => x.score));
  const maxL = Math.max(1, ...longTerm.map((x) => x.score));
  const map = new Map();
  const add = (row, kind, max) => {
    const title = row.recording_name;
    const artist = row.artist_credit_name;
    if (!title || !artist) return;
    const key = `${cleanTitle(title)}|${mainArtist(artist)}`;
    const c = map.get(key) || {
      key,
      title,
      artist,
      album: row.release_name || null,
      cover: row.caa_release_mbid && row.caa_id ? `https://coverartarchive.org/release/${row.caa_release_mbid}/${row.caa_id}-250.jpg` : null,
      recent: 0,
      longTerm: 0,
    };
    c[kind] = Math.max(c[kind], Math.round((row.score / max) * 100));
    map.set(key, c);
  };
  recent.forEach((r) => add(r, 'recent', maxR));
  longTerm.forEach((r) => add(r, 'longTerm', maxL));

  return [...map.values()]
    .map((c) => ({
      ...c,
      sameArtist: curArtists.some((a) => strip(c.artist).includes(a)),
      // what's hot now counts a bit more than long-term
      match: Math.round(0.6 * c.recent + 0.4 * c.longTerm),
    }))
    .sort((a, b) => b.match - a.match);
}

// Pick n with variety: at most 1 song per artist (2 if we run short)
export function diversePicks(cands, n = 4) {
  const out = [];
  const perArtist = new Map();
  for (const limit of [1, 2]) {
    for (const c of cands) {
      if (out.length >= n) break;
      if (out.includes(c)) continue;
      const a = mainArtist(c.artist);
      if ((perArtist.get(a) || 0) >= limit) continue;
      perArtist.set(a, (perArtist.get(a) || 0) + 1);
      out.push(c);
    }
  }
  return out;
}

export function explain(c, current) {
  const song = current.title.replace(/\s*[([].*?[)\]]/g, '').trim();
  if (c.source === 'similar-artist') {
    return { why: `Fans of ${current.artists[0]} also play ${c.viaArtist} a lot. This is one of their biggest songs.`, tags: ['Similar artist'] };
  }
  if (c.catalogue) {
    return { why: `More from ${current.artists[0]}. Open listening data is thin for this song, so these come from the artist's catalogue.`, tags: ['Same artist'] };
  }
  if (c.source === 'same-artist') {
    return { why: `One of ${current.artists[0]}'s most played songs. A safe, smooth follow-up.`, tags: ['Same artist'] };
  }
  const tags = [];
  if (c.recent >= 60 && c.recent >= c.longTerm + 15) tags.push('Trending now');
  if (c.longTerm >= 60 && c.longTerm >= c.recent) tags.push('Fan favourite');
  if (c.recent >= 40 && c.longTerm >= 40) tags.push('Strong match');
  if (c.sameArtist) tags.push('Same artist');
  let why;
  if (c.sameArtist) why = `More from ${current.artists[0]}: fans of ${song} often keep going with this one.`;
  else if (tags.includes('Trending now')) why = `Lately, lots of people play this in the same session as ${song}.`;
  else if (tags.includes('Fan favourite')) why = `For years, ${song} listeners have paired it with this track.`;
  else why = `Often played in the same listening session as ${song}.`;
  return { why, tags: tags.length ? tags : ['Played together'] };
}

// ---------- artist-level fallback (new or niche songs) ----------
async function similarArtists(mbid) {
  const r = await fetch(`https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=${mbid}&algorithm=${ARTIST_ALGO}`);
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j) ? j.filter((a) => a.artist_mbid && a.name) : [];
}

async function topRecordings(mbid, n) {
  const r = await fetch(`https://api.listenbrainz.org/1/popularity/top-recordings-for-artist/${mbid}`);
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j) ? j.slice(0, n) : [];
}

const fromTop = (rec, extra) => ({
  key: `${cleanTitle(rec.recording_name)}|${mainArtist(rec.artist_name)}`,
  title: rec.recording_name,
  artist: rec.artist_name,
  album: rec.release_name || null,
  cover: rec.caa_release_mbid && rec.caa_id ? `https://coverartarchive.org/release/${rec.caa_release_mbid}/${rec.caa_id}-250.jpg` : null,
  plays: rec.total_listen_count || 0,
  recent: 0,
  longTerm: 0,
  ...extra,
});

// Songs from artists that fans of this artist play, plus the artist's own hits
export async function artistCandidates(current, mbid) {
  const out = [];
  const [sims, own] = await Promise.all([similarArtists(mbid), topRecordings(mbid, 5)]);
  const top = sims.slice(0, 6);
  const best = Math.max(1, ...top.map((a) => a.score));
  const lists = await Promise.all(top.map((a) => topRecordings(a.artist_mbid, 3).catch(() => [])));
  top.forEach((a, i) =>
    lists[i].forEach((rec, j) =>
      out.push(fromTop(rec, { source: 'similar-artist', viaArtist: a.name, match: Math.round(72 * (a.score / best) * (1 - j * 0.12)) }))
    )
  );
  const cur = cleanTitle(current.title);
  own
    .filter((rec) => cleanTitle(rec.recording_name) !== cur)
    .slice(0, 3)
    .forEach((rec, j) => out.push(fromTop(rec, { source: 'same-artist', sameArtist: true, match: 58 - j * 6 })));
  return out;
}

// 30-second preview + Apple link + genre from iTunes (free; cached because iTunes rate-limits)
const enrichCache = new Map();
async function enrich(c) {
  if (c.preview) return c; // already has everything (catalogue songs)
  const hit = enrichCache.get(c.key);
  if (hit) return { ...c, ...hit };
  const extra = await itunesSong(c.title, c.artist);
  if (extra) enrichCache.set(c.key, extra);
  return { ...c, ...(extra || {}) };
}

export async function itunesSong(title, artist) {
  try {
    const q = encodeURIComponent(`${cleanTitle(title)} ${artist.split(/,|&| with | feat\.? /i)[0]}`);
    const r = await fetch(`https://itunes.apple.com/search?term=${q}&entity=song&limit=1`);
    if (!r.ok) return null;
    const t = (await r.json()).results?.[0];
    if (!t) return null;
    return {
      coverHq: t.artworkUrl100?.replace('100x100bb', '300x300bb') || null,
      preview: t.previewUrl || null,
      appleUrl: t.trackViewUrl || null,
      genre: t.primaryGenreName || null,
      year: t.releaseDate?.slice(0, 4) || null,
      durationMs: t.trackTimeMillis || null,
    };
  } catch {
    return null; // extras only
  }
}

// Optional: let Claude choose and explain, strictly from the real candidates
async function aiPick(current, cands, env) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const list = cands.slice(0, 12).map((c, i) => ({
    id: i,
    title: c.title,
    artist: c.artist,
    genre: c.genre || undefined,
    year: c.year || undefined,
    played_together_recently: c.recent,
    played_together_long_term: c.longTerm,
  }));
  const prompt = `You are a DJ choosing what to play next.
Now playing: "${current.title}" by ${current.artists.join(', ')}.
Candidates come from real listening data: how strongly real people play each song in the same session as the current one (0-100), recently and long-term.
Pick exactly 4 candidate ids that would flow best next. Prefer strong data, keep artist variety, and include one fresher discovery if it fits.
Reply with JSON only: {"picks":[{"id":0,"why":"max 18 words, friendly, mention the vibe or the data","tag":"2-3 word label"}]}
Candidates: ${JSON.stringify(list)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const text = j.content?.find((b) => b.type === 'text')?.text || '';
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const picks = (parsed.picks || [])
      .filter((p) => Number.isInteger(p.id) && cands[p.id])
      .slice(0, 4)
      .map((p) => ({ ...cands[p.id], why: String(p.why || '').slice(0, 160), tags: [String(p.tag || 'AI pick').slice(0, 24)] }));
    return picks.length >= 3 ? picks : null;
  } catch {
    return null; // fall back to the rule-based ranking
  } finally {
    clearTimeout(t);
  }
}

const shape = (c) => ({
  title: c.title,
  artist: c.artist,
  album: c.album || null,
  cover: c.coverHq || c.cover || null,
  preview: c.preview || null,
  appleUrl: c.appleUrl || null,
  spotifySearch: `https://open.spotify.com/search/${encodeURIComponent(`${cleanTitle(c.title)} ${c.artist.split(/,|&/)[0]}`)}`,
  genre: c.genre || null,
  year: c.year || null,
  match: c.match,
  source: c.source || 'session',
  signals: { recent: c.recent || 0, longTerm: c.longTerm || 0 },
  why: c.why,
  tags: c.tags,
  aiPick: !!c.aiPick,
});

export async function recommend(title, artists, env = process.env) {
  const key = `rec|${strip(title)}|${artists.map(strip).join(',')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 30 * 60 * 1000) return hit.v;

  const current = { title, artists };
  const sources = [];

  // 1) songs people play in the same listening session
  let merged = [];
  const ids = (await findRecordingIds(title, artists[0], { quick: true }).catch(() => [])).slice(0, 2);
  if (ids.length) {
    const rows = { recent: [], longTerm: [] };
    await Promise.all(
      ids.flatMap((id) =>
        Object.entries(ALGOS).map(async ([kind, algo]) => {
          try {
            rows[kind].push(...(await similar(id, algo)));
          } catch {
            /* one view failing is fine */
          }
        })
      )
    );
    merged = mergeCandidates(rows, current).map((c) => ({ ...c, source: 'session' }));
    if (merged.length) sources.push('session');
  }

  // 2) not enough? use similar artists' biggest songs + the artist's own hits
  if (merged.length < 10) {
    try {
      const acr = await acrLookupFull(title, artists[0]).catch(() => null);
      const mbid = acr?.artistMbids?.[0] || (await artistMbid(artists[0]));
      if (mbid) {
        const extra = await artistCandidates(current, mbid);
        const seen = new Set(merged.map((c) => c.key));
        for (const c of extra) {
          if (!seen.has(c.key)) {
            seen.add(c.key);
            merged.push(c);
          }
        }
        if (extra.length) sources.push('artists');
      }
    } catch {
      /* fallback is best-effort */
    }
  }

  // 3) still nothing (artist missing from open data)? use their catalogue on Apple Music
  if (!merged.length) {
    try {
      const { itunesArtistSongs } = await import('./galaxy.mjs');
      const cur = cleanTitle(title);
      let j = 0;
      for (const [k, t] of await itunesArtistSongs(artists[0])) {
        if (k === cur) continue;
        merged.push({
          key: `${k}|${mainArtist(t.artistName)}`,
          title: t.trackName,
          artist: t.artistName,
          album: t.collectionName,
          cover: t.artworkUrl100?.replace('100x100bb', '300x300bb') || null,
          coverHq: t.artworkUrl100?.replace('100x100bb', '300x300bb') || null,
          preview: t.previewUrl,
          appleUrl: t.trackViewUrl,
          genre: t.primaryGenreName,
          year: t.releaseDate?.slice(0, 4),
          source: 'same-artist',
          catalogue: true,
          sameArtist: true,
          match: 50 - Math.min(20, j * 2),
          recent: 0,
          longTerm: 0,
        });
        if (++j >= 10) break;
      }
      if (j) sources.push('catalogue');
    } catch {
      /* best-effort */
    }
  }

  merged.sort((a, b) => b.match - a.match);
  if (!merged.length) {
    return { current, picks: [], pool: [], engine: 'none', note: `Not enough open listening data for "${title}" yet.` };
  }

  // enrich a varied shortlist (previews power the tempo/key analysis in the browser)
  const shortlist = diversePicks(merged, 10);
  const top = await Promise.all(shortlist.map(enrich));
  const explained = top.map((c) => ({ ...c, ...explain(c, current) }));
  const ai = await aiPick(current, explained, env);
  if (ai) {
    for (const p of ai) {
      const c = explained.find((x) => x.key === p.key);
      if (c) Object.assign(c, { why: p.why, tags: p.tags, aiPick: true });
    }
  }
  const pool = explained.map(shape);
  const picks = (ai || diversePicks(explained, 4)).map((c) => shape(explained.find((x) => x.key === c.key) || c));

  const v = {
    current,
    picks,
    pool,
    engine: ai ? 'claude' : 'listenbrainz',
    sources,
    candidates: merged.length,
    source: 'ListenBrainz listening sessions + similar artists (open source)',
    fetchedAt: new Date().toISOString(),
  };
  cache.set(key, { t: Date.now(), v });
  return v;
}
