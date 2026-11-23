import { it, expect, vi } from 'vitest';

const album = (id, name, count, date, explicit = 'explicit') => ({ wrapperType: 'collection', collectionId: id, collectionName: name, artistName: 'Future', trackCount: count, releaseDate: `${date}T00:00:00Z`, collectionExplicitness: explicit, artworkUrl100: 'https://x/100x100bb.jpg' });

it('artist albums: newest first, EP/single labels, duplicates merged', async () => {
  globalThis.fetch = vi.fn(async (url) => {
    if (url.includes('entity=musicArtist')) return Response.json({ results: [{ artistId: 1, artistName: 'Future' }] });
    if (url.includes('/lookup?id=1&entity=album'))
      return Response.json({
        results: [
          { wrapperType: 'artist' },
          album(10, 'HNDRXX', 17, '2017-02-24'),
          album(11, 'HNDRXX', 17, '2017-02-24', 'cleaned'),
          album(12, 'Mask Off - Single', 1, '2017-04-01'),
          album(13, 'Beast Mode', 9, '2015-01-16'),
          album(14, 'Save Me - EP', 7, '2019-06-07'),
        ],
      });
    return new Response('no', { status: 404 });
  });
  const { artistAlbums } = await import('../server/music.mjs');
  const r = await artistAlbums('Future');
  expect(r.albums.map((a) => [a.title, a.kind])).toEqual([
    ['Save Me', 'EP'],
    ['Mask Off', 'Single'],
    ['HNDRXX', 'Album'],
    ['Beast Mode', 'Album'],
  ]);
  expect(r.albums[2].explicit).toBe(true);
  expect(r.albums[0].cover).toBe('https://x/400x400bb.jpg');
});

it('album tracks come back in track order', async () => {
  globalThis.fetch = vi.fn(async () =>
    Response.json({
      results: [
        album(20, 'Pluto', 3, '2012-04-17'),
        { wrapperType: 'track', kind: 'song', trackName: 'B', artistName: 'Future', trackNumber: 2, discNumber: 1, previewUrl: 'p2' },
        { wrapperType: 'track', kind: 'song', trackName: 'A', artistName: 'Future', trackNumber: 1, discNumber: 1, previewUrl: 'p1' },
      ],
    })
  );
  const { albumTracks } = await import('../server/music.mjs');
  const r = await albumTracks('20');
  expect(r.album.title).toBe('Pluto');
  expect(r.tracks.map((t) => t.title)).toEqual(['A', 'B']);
  await expect(albumTracks('../etc')).rejects.toThrow();
});

it('search ranking: the real song before slowed/cover versions, popular first', async () => {
  const { rankSongs } = await import('../server/music.mjs');
  const list = [
    { title: 'No Pole - Slowed and Reverb', artist: 'x', rank: 900000 },
    { title: 'No Pole (Cover)', artist: 'y', rank: 100000 },
    { title: 'No Pole', artist: 'David Shannon', rank: 20000 },
    { title: 'No Pole', artist: 'Don Toliver', rank: 850000 },
  ];
  expect(rankSongs(list, 'no pole').map((s) => s.artist)).toEqual(['Don Toliver', 'David Shannon', 'x', 'y']);
  expect(rankSongs(list, 'no pole slowed')[0].artist).toBe('x');
});
