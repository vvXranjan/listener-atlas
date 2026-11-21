import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mergeCandidates, diversePicks, explain, recommend } from '../server/recommend.mjs';
import { handle } from '../server/handlers.mjs';

const current = { title: 'No Pole', artists: ['Don Toliver'] };
const row = (name, artist, score) => ({ recording_name: name, artist_credit_name: artist, score, release_name: 'X', caa_id: 1, caa_release_mbid: 'r' });

describe('ranking', () => {
  const rows = {
    recent: [row('luther', 'Kendrick Lamar with SZA', 70), row('tv off', 'Kendrick Lamar feat. Lefty Gunplay', 48), row('No Pole', 'Don Toliver', 99), row('FE!N', 'Travis Scott feat. Playboi Carti', 30)],
    longTerm: [row('FE!N', 'Travis Scott feat. Playboi Carti', 45), row('luther', 'Kendrick Lamar with SZA', 51), row('Bandit', 'Don Toliver', 40), row('Timeless', 'The Weeknd feat. Playboi Carti', 20)],
  };

  it('merges both views, scores 0-100 and skips the current song', () => {
    const m = mergeCandidates(rows, current);
    expect(m.find((c) => c.title === 'No Pole')).toBeUndefined();
    const luther = m.find((c) => c.title === 'luther');
    expect(luther.recent).toBe(100);
    expect(luther.longTerm).toBe(100);
    expect(luther.match).toBe(100);
    expect(m[0].title).toBe('luther');
    expect(luther.cover).toBe('https://coverartarchive.org/release/r/1-250.jpg');
  });

  it('keeps artist variety (one song per artist first)', () => {
    const picks = diversePicks(mergeCandidates(rows, current), 4);
    const artists = picks.map((p) => p.artist.split(/ with | feat\./)[0].trim());
    expect(new Set(artists).size).toBe(picks.length);
    expect(picks).toHaveLength(4);
  });

  it('explains each pick in plain words', () => {
    const m = mergeCandidates(rows, current);
    const bandit = m.find((c) => c.title === 'Bandit');
    expect(explain(bandit, current).tags).toContain('Same artist');
    expect(explain(m[0], current).why).toMatch(/No Pole/);
  });
});

// ---------- end to end with fake services ----------
const labs = {
  recent: [row('luther', 'Kendrick Lamar with SZA', 70), row('CAN’T SAY', 'Travis Scott', 49), row('tv off', 'Kendrick Lamar', 48), row('See You Again', 'Tyler, The Creator feat. Kali Uchis', 43), row('Timeless', 'The Weeknd feat. Playboi Carti', 42)],
  longTerm: [row('luther', 'Kendrick Lamar with SZA', 51), row('FE!N', 'Travis Scott feat. Playboi Carti', 45), row('Trance', 'Metro Boomin feat. Travis Scott & Young Thug', 32)],
};
let claudeReply = null;
function fakeFetch(url, opts = {}) {
  const u = String(url);
  const ok = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (u.includes('/acr-lookup/')) {
    if (u.includes('Brand%20New%20Song')) return ok([]); // unknown song
    return ok([{ recording_mbid: 'c44742a1-ef4a-4493-84d6-969ef837d125', recording_name: 'No Pole', artist_mbids: ['don-mbid'] }]);
  }
  if (u.includes('/similar-artists/')) return ok([{ name: 'Travis Scott', artist_mbid: 'travis', score: 2000 }, { name: 'Future', artist_mbid: 'future', score: 1500 }]);
  if (u.includes('top-recordings-for-artist/travis')) return ok([{ recording_name: 'SICKO MODE', artist_name: 'Travis Scott', total_listen_count: 89940, caa_id: 2, caa_release_mbid: 'a' }, { recording_name: 'goosebumps', artist_name: 'Travis Scott feat. Kendrick Lamar', total_listen_count: 85291 }]);
  if (u.includes('top-recordings-for-artist/future')) return ok([{ recording_name: 'Mask Off', artist_name: 'Future', total_listen_count: 50000 }]);
  if (u.includes('top-recordings-for-artist/don-mbid')) return ok([{ recording_name: 'No Pole', artist_name: 'Don Toliver', total_listen_count: 9 }, { recording_name: 'Bandit', artist_name: 'Don Toliver', total_listen_count: 8 }]);
  if (u.includes('musicbrainz.org/ws/2/artist')) return ok({ artists: [{ id: 'don-mbid', name: 'Don Toliver', score: 100 }] });
  if (u.includes('musicbrainz.org')) return Promise.resolve(new Response('busy', { status: 503 }));
  if (u.includes('labs.api.listenbrainz.org')) return ok(u.includes('days_180') ? labs.recent : labs.longTerm);
  if (u.includes('itunes.apple.com/search')) return ok({ results: [{ previewUrl: 'https://p.m4a', trackViewUrl: 'https://apple/x', primaryGenreName: 'Hip-Hop/Rap', releaseDate: '2024-11-22', artworkUrl100: 'https://a/100x100bb.jpg' }] });
  if (u.includes('api.anthropic.com')) {
    if (!claudeReply) return Promise.resolve(new Response('{}', { status: 500 }));
    return ok({ content: [{ type: 'text', text: claudeReply }] });
  }
  return Promise.resolve(new Response('nope', { status: 404 }));
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn(fakeFetch)));
afterEach(() => {
  vi.unstubAllGlobals();
  claudeReply = null;
});

describe('Up next', () => {
  it('without AI: 4 data-driven picks with previews and reasons', async () => {
    const r = await recommend('No Pole', ['Don Toliver'], {});
    expect(r.engine).toBe('listenbrainz');
    expect(r.picks).toHaveLength(4);
    expect(r.picks[0]).toMatchObject({ title: 'luther', preview: 'https://p.m4a', genre: 'Hip-Hop/Rap', year: '2024' });
    for (const p of r.picks) {
      expect(p.why.length).toBeGreaterThan(10);
      expect(p.match).toBeGreaterThanOrEqual(0);
      expect(p.spotifySearch).toMatch(/^https:\/\/open\.spotify\.com\/search\//);
    }
  });

  it('with AI: Claude chooses, but only from real candidates', async () => {
    claudeReply = 'Here you go: {"picks":[{"id":1,"why":"Same late-night energy","tag":"Vibe match"},{"id":0,"why":"Huge with No Pole fans","tag":"Top pick"},{"id":99,"why":"invented","tag":"x"},{"id":3,"why":"Smooth turn","tag":"Discovery"}]}';
    const r = await recommend('No Pole (Remix)', ['Don Toliver'], { ANTHROPIC_API_KEY: 'test' });
    expect(r.engine).toBe('claude');
    expect(r.picks).toHaveLength(3); // the made-up id 99 is dropped
    expect(r.picks[0].why).toBe('Same late-night energy');
    const sent = JSON.parse(globalThis.fetch.mock.calls.find(([u]) => String(u).includes('anthropic'))[1].body);
    expect(sent.messages[0].content).toMatch(/Candidates:/);
  });

  it('falls back to the rules if the AI reply is unusable', async () => {
    claudeReply = 'sorry, no JSON';
    const r = await recommend('No Pole - Live', ['Don Toliver'], { ANTHROPIC_API_KEY: 'test' });
    expect(r.engine).toBe('listenbrainz');
    expect(r.picks).toHaveLength(4);
  });

  it('finds the song via ListenBrainz even when MusicBrainz is busy', async () => {
    const r = await recommend('No Pole', ['Don Toliver'], {});
    expect(r.picks.length).toBeGreaterThan(0);
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes('musicbrainz.org'))).toBe(false);
  });

  it('new / niche song: falls back to similar artists and the artist\'s own hits', { timeout: 15000 }, async () => {
    const r = await recommend('Brand New Song', ['Don Toliver'], {});
    expect(r.sources).toEqual(['artists']);
    expect(r.pool.map((p) => p.title)).toEqual(expect.arrayContaining(['SICKO MODE', 'Mask Off', 'Bandit']));
    expect(r.pool.find((p) => p.title === 'Brand New Song')).toBeUndefined();
    const sicko = r.pool.find((p) => p.title === 'SICKO MODE');
    expect(sicko.source).toBe('similar-artist');
    expect(sicko.why).toMatch(/Travis Scott/);
    expect(r.picks.length).toBeGreaterThan(0);
  });

  it('returns a bigger pool for the transition ranking', async () => {
    const r = await recommend('No Pole', ['Don Toliver'], {});
    expect(r.pool.length).toBeGreaterThanOrEqual(r.picks.length);
    expect(r.sources).toContain('session');
  });

  it('API route validates input', async () => {
    expect((await handle({ route: 'recommend', query: { title: 'x' } })).status).toBe(400);
  });
});
