import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSet, onSetChange, songId } from './setStore.js';
import { isLoggedIn, searchSpotify } from './spotify.js';
import { flag } from './countries.js';
import SongRow from './SongRow.jsx';
import { openGalaxy } from './ArtistLink.jsx';
import { openAlbums } from './AlbumsView.jsx';

const strip = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const mainOf = (a) => String(a || '').split(/,|&| feat\.? | with /i)[0].trim();

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Search failed (${r.status})`);
  return r.json();
}

// One search box for everything: songs, artists, albums and cities
export default function MusicSearch({ tracked = [], onArtistMap, onCity, onMixLab }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [inSet, setInSet] = useState(() => new Set(getSet().map(songId)));
  const box = useRef(null);
  const pop = useRef(null);
  useEffect(() => onSetChange((s) => setInSet(new Set(s.map(songId)))), []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setRes(null);
    let alive = true;
    const qk = strip(term);
    // artists already on the map: instant
    const onMap = tracked.filter((a) => strip(a.name).includes(qk) || (qk.length > 3 && qk.includes(strip(a.name)))).slice(0, 4);
    setRes((r) => ({ ...(r || {}), onMap, loading: true }));
    const t = setTimeout(async () => {
      try {
        const [apple, sp, cities] = await Promise.all([
          getJson(`/api/music?q=${encodeURIComponent(term)}`).catch(() => ({ songs: [], albums: [], artists: [] })),
          isLoggedIn() ? searchSpotify(term).catch(() => []) : Promise.resolve([]),
          getJson(`/api/cities?q=${encodeURIComponent(term)}`).catch(() => []),
        ]);
        // songs: Spotify ranks best; Apple adds previews
        const key = (s) => `${strip(s.title)}|${strip(mainOf(s.artist))}`;
        const byKey = new Map(apple.songs.map((s) => [key(s), s]));
        const songs = [];
        const seen = new Set();
        for (const s of sp) {
          const m = byKey.get(key(s));
          songs.push({ ...(m || {}), ...s, preview: m?.preview || null, cover: s.cover || m?.cover });
          seen.add(key(s));
        }
        for (const [k, s] of byKey) if (!seen.has(k)) songs.push(s);

        // artists: names matching what you typed, then the artists of the top songs
        const names = [];
        const add = (n) => n && !names.some((x) => strip(x) === strip(n)) && names.push(n);
        onMap.forEach((a) => add(a.name));
        apple.artists.filter((a) => strip(a.name) === qk || strip(a.name).startsWith(qk)).forEach((a) => add(a.name));
        songs.slice(0, 5).forEach((s) => add(mainOf(s.artist)));

        const cityList = (Array.isArray(cities) ? cities : []).slice(0, 5);
        // what did you most likely mean?
        const exactArtist = names.find((n) => strip(n) === qk);
        const exactCity = cityList.find((c) => strip(c.name) === qk);
        const exactSong = songs.find((s) => strip(s.title) === qk);
        const exactAlbum = apple.albums.find((a) => strip(a.title) === qk);
        const best = exactArtist
          ? { type: 'artist', name: exactArtist }
          : exactSong
            ? { type: 'song', song: exactSong }
            : exactCity
              ? { type: 'city', city: exactCity }
              : exactAlbum
                ? { type: 'album', album: exactAlbum }
                : songs[0]
                  ? { type: 'song', song: songs[0] }
                  : cityList[0]
                    ? { type: 'city', city: cityList[0] }
                    : null;
        if (alive) setRes({ onMap, best, songs: songs.slice(0, 10), albums: apple.albums, artists: names.slice(0, 6), cities: cityList });
      } catch (e) {
        if (alive) setRes({ error: e.message });
      }
    }, 280);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, tracked]);

  useEffect(() => {
    if (!res) return;
    const onDoc = (e) => !box.current?.contains(e.target) && !pop.current?.contains(e.target) && !e.target.closest?.('.gn-wrap, .gx-wrap, .drawer') && setQ('');
    const onKey = (e) => e.key === 'Escape' && setQ('');
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [res]);

  const done = () => setQ('');
  const onMapName = (n) => res?.onMap?.some((a) => strip(a.name) === strip(n)) || tracked.some((a) => strip(a.name) === strip(n));
  function open(best) {
    if (!best) return;
    if (best.type === 'artist') {
      onArtistMap?.(best.name);
      done();
    } else if (best.type === 'city') {
      onCity?.(best.city);
      done();
    } else if (best.type === 'album') openAlbums({ albumId: best.album.id });
    else if (best.type === 'song' && onMixLab) {
      const s = best.song;
      onMixLab({ id: `${s.title}|${s.artist}`, name: s.title, artists: [{ name: mainOf(s.artist) }], cover: s.cover });
      done();
    }
  }

  const ArtistActions = ({ name }) => (
    <span className="ms-acts">
      <button className="ms-act" onClick={() => (onArtistMap?.(name), done())} title={`Show ${name}'s listeners on the map`}>
        🌍 Map
      </button>
      <button className="ms-act" onClick={() => openGalaxy(name)} title={`Open ${name}'s Galaxy`}>
        🌌 Galaxy
      </button>
      <button className="ms-act" onClick={() => openAlbums({ artist: name })} title={`${name}'s albums`}>
        💿 Albums
      </button>
    </span>
  );

  const b = res?.best;
  return (
    <div className="ms" ref={box}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          open(res?.best);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search songs, artists, albums, cities…" aria-label="Search" />
        {q && (
          <button type="button" className="ms-clear" onClick={() => setQ('')} aria-label="Clear">
            ×
          </button>
        )}
      </form>
      {res &&
        createPortal(
          <div className="ms-results" ref={pop}>
            {res.loading && !res.best && !res.onMap?.length && <div className="muted">Searching…</div>}
            {res.error && <div className="status err">{res.error}</div>}
            {!res.loading && !res.best && !res.artists?.length && !res.albums?.length && <div className="muted">Nothing found for “{q.trim()}”.</div>}

            {b && (
              <section className="ms-best">
                <h3 className="ml-h">Top result {b.type !== 'song' && <span className="muted">· Enter to open</span>}</h3>
                {b.type === 'artist' && (
                  <div className="ms-best-card">
                    <div>
                      <b>{b.name}</b>
                      <small>Artist{onMapName(b.name) ? ' · on the map' : ''}</small>
                    </div>
                    <ArtistActions name={b.name} />
                  </div>
                )}
                {b.type === 'city' && (
                  <button className="ms-best-card" onClick={() => open(b)}>
                    <div>
                      <b>
                        {flag(b.city.country)} {b.city.name}
                      </b>
                      <small>City · {b.city.countryName} · see what it's playing</small>
                    </div>
                  </button>
                )}
                {b.type === 'album' && (
                  <button className="ms-best-card" onClick={() => open(b)}>
                    {b.album.cover && <img src={b.album.cover} alt="" />}
                    <div>
                      <b>{b.album.title}</b>
                      <small>
                        {b.album.kind} · {b.album.artist} · {b.album.year}
                      </small>
                    </div>
                  </button>
                )}
                {b.type === 'song' && <SongRow s={b.song} inSet={inSet} onMixLab={onMixLab} />}
              </section>
            )}

            {res.artists?.length > 0 && (
              <section>
                <h3 className="ml-h">Artists</h3>
                {res.artists.map((n) => (
                  <div key={n} className="ms-artist-row">
                    <b>
                      {n}
                      {onMapName(n) && <span className="ms-tag">on map</span>}
                    </b>
                    <ArtistActions name={n} />
                  </div>
                ))}
              </section>
            )}

            {res.songs?.length > 0 && (
              <section>
                <h3 className="ml-h">Songs</h3>
                {res.songs
                  .filter((s) => !(b?.type === 'song' && b.song === s))
                  .map((s, i) => (
                    <SongRow key={`${s.uri || s.title}|${i}`} s={s} inSet={inSet} onMixLab={onMixLab} compact />
                  ))}
              </section>
            )}

            {res.albums?.length > 0 && (
              <section>
                <h3 className="ml-h">Albums</h3>
                <div className="al-row">
                  {res.albums.map((a) => (
                    <button key={a.id} className="al-card sm" onClick={() => openAlbums({ albumId: a.id })} title={`${a.title} · ${a.artist}`}>
                      {a.cover ? <img src={a.cover} alt="" loading="lazy" /> : <span className="ph" />}
                      <b>{a.title}</b>
                      <small>
                        {a.artist} · {a.year}
                      </small>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {res.cities?.length > 0 && (
              <section>
                <h3 className="ml-h">Cities</h3>
                <div className="ms-cities">
                  {res.cities.map((c) => (
                    <button key={`${c.name}|${c.country}`} className="genre-chip" onClick={() => (onCity?.(c), done())}>
                      {flag(c.country)} {c.name} <span className="muted">· {c.countryName}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
