import { describe, it, expect, vi, afterEach } from 'vitest';
import { artistGalaxy, pickSectors } from '../server/galaxy.mjs';

afterEach(() => vi.unstubAllGlobals());
const ok = (j) => Promise.resolve(Response.json(j));

describe('Artist Galaxy data', () => {
  it('groups similar artists into genre sectors, main artist first', () => {
    const artists = [
      { name: 'Travis Scott', genres: ['trap', 'hip hop'] },
      { name: 'Drake', genres: ['hip hop', 'pop rap'] },
      { name: 'Sade', genres: ['soul'] },
    ];
    const sectors = pickSectors(['trap', 'southern hip hop'], artists, 3);
    expect(sectors.slice(0, 2)).toEqual(['trap', 'southern hip hop']);
    expect(artists[0].sector).toBe('trap');
    expect(artists[1].sector).toBe('hip hop');
    expect(artists[2].sector).toBe('other');
    expect(sectors).toContain('other');
  });

  it('builds songs with previews, similar artists and genres', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        const u = String(url);
        if (u.includes('musicbrainz.org/ws/2/artist')) return ok({ artists: [{ id: 'fut', name: 'Future', score: 100 }] });
        if (u.includes('top-recordings-for-artist/fut'))
          return ok([
            { recording_name: 'Mask Off', artist_name: 'Future', total_listen_count: 900 },
            { recording_name: 'Mask Off (Remix)', artist_name: 'Future', total_listen_count: 100 },
            { recording_name: 'Low Life', artist_name: 'Future feat. The Weeknd', total_listen_count: 450 },
          ]);
        if (u.includes('top-recordings-for-artist/trav')) return ok([{ recording_name: 'SICKO MODE', artist_name: 'Travis Scott' }]);
        if (u.includes('similar-artists')) return ok([{ name: 'Travis Scott', artist_mbid: 'trav', score: 50 }]);
        if (u.includes('/metadata/artist/'))
          return ok([
            { artist_mbid: 'fut', tag: { artist: [{ tag: 'trap', count: 4, genre_mbid: 'x' }, { tag: 'english', count: 9 }, { tag: 'hip hop', count: 7, genre_mbid: 'y' }] } },
            { artist_mbid: 'trav', tag: { artist: [{ tag: 'trap', count: 6, genre_mbid: 'x' }] } },
          ]);
        if (u.includes('itunes.apple.com/search'))
          return ok({ results: [{ trackName: 'Mask Off', artistName: 'Future', previewUrl: 'https://audio-ssl.itunes.apple.com/m.m4a', artworkUrl100: 'a/100x100bb.jpg' }] });
        if (u.includes('wikipedia')) return ok({ title: 'Future', extract: 'Rapper', originalimage: { source: 'https://img/future.jpg' } });
        return Promise.resolve(new Response('nope', { status: 404 }));
      })
    );
    const g = await artistGalaxy('Future');
    expect(g.songs.map((s) => s.title)).toEqual(['Mask Off', 'Low Life']); // remix folded into the original
    expect(g.songs[0].preview).toMatch(/m4a/);
    expect(g.songs[0].popularity).toBe(1);
    expect(g.artist.genres).toEqual(['hip hop', 'trap']); // "english" dropped
    expect(g.artists[0]).toMatchObject({ name: 'Travis Scott', sector: 'trap', similarity: 1 });
    expect(g.artists[0].topSong.title).toBe('SICKO MODE');
  });
});

describe('Galaxy layout', async () => {
  const { arcs } = await import('../src/ArtistGalaxy.jsx');
  it('gives busy genres a bigger slice, and slices fill the circle', () => {
    const items = [{ g: 'hip hop' }, { g: 'hip hop' }, { g: 'hip hop' }, { g: 'trap' }];
    const s = arcs(['hip hop', 'trap', 'pop'], items, (x) => x.g);
    expect(s.get('hip hop').width).toBeGreaterThan(s.get('trap').width);
    expect(s.get('trap').width).toBeGreaterThan(s.get('pop').width);
    const total = [...s.values()].reduce((a, x) => a + x.width, 0);
    expect(total).toBeCloseTo(Math.PI * 2, 5);
  });
});

describe('Galaxy when MusicBrainz is busy', () => {
  it('still finds the artist through ListenBrainz using one of their songs', async () => {
    const { artistGalaxy } = await import('../server/galaxy.mjs');
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        const u = String(url);
        if (u.includes('musicbrainz.org')) return Promise.resolve(new Response('busy', { status: 503 }));
        if (u.includes('itunes.apple.com/search'))
          return Promise.resolve(Response.json({ results: [{ trackName: 'Busy Song', artistName: 'Busy Artist', previewUrl: 'https://audio-ssl.itunes.apple.com/b.m4a' }] }));
        if (u.includes('/acr-lookup/')) return Promise.resolve(Response.json([{ recording_mbid: 'r1', artist_mbids: ['busy-mbid'] }]));
        if (u.includes('similar-artists')) return Promise.resolve(Response.json([{ name: 'Friend', artist_mbid: 'f1', score: 10 }]));
        if (u.includes('/metadata/artist/')) return Promise.resolve(Response.json([{ artist_mbid: 'busy-mbid', tag: { artist: [{ tag: 'trap', count: 3, genre_mbid: 'g' }] } }]));
        if (u.includes('top-recordings-for-artist')) return Promise.resolve(Response.json([]));
        return Promise.resolve(new Response('nope', { status: 404 }));
      })
    );
    const g = await artistGalaxy('Busy Artist');
    expect(g.artist.mbid).toBe('busy-mbid');
    expect(g.artists.map((a) => a.name)).toEqual(['Friend']);
    expect(g.artist.genres).toEqual(['trap']);
  }, 20000);
});
