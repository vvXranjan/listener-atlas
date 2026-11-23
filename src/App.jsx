import React, { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import { GlobeBars, MapLabels, HoverTip, fmt } from './GlobeLayers.jsx';
import { attachPerf, usePerf, setPerfMode, getQuality, pixelRatioFor } from './perf.js';
import { useLiveData, timeAgo } from './useLiveData.js';
import CityCard from './CityCard.jsx';
import ArtistDrawer from './ArtistDrawer.jsx';
import Starfield from './Starfield.jsx';
import LiveTicker from './LiveTicker.jsx';
import Shazam from './Shazam.jsx';
import AutoDjFab from './AutoDjFab.jsx';
import NowPlaying from './NowPlaying.jsx';
import SongDrawer from './SongDrawer.jsx';
import Safe from './Safe.jsx';
// big panels load only when you first open them (faster start)
const MixLab = lazy(() => import('./MixLab.jsx'));
const ArtistGalaxy = lazy(() => import('./ArtistGalaxy.jsx'));
const GenreView = lazy(() => import('./GenreView.jsx'));
const AlbumsView = lazy(() => import('./AlbumsView.jsx'));
const LyricsView = lazy(() => import('./LyricsView.jsx'));
const MusicSearch = lazy(() => import('./MusicSearch.jsx'));
const Library = lazy(() => import('./Library.jsx'));
const FloatingSet = lazy(() => import('./FloatingSet.jsx'));
import { useNowItem } from './mixParts.jsx';
import { startSetSync } from './setSync.js';
import { startHabits } from './habits.js';
import { STYLES, SKY, PLACES, TERRAIN_SPEC, nightPolygon, graticule } from './mapStyles.js';
import { flag, countryName, countryZoom, distanceKm } from './countries.js';

const GLOBE_ZOOM = 2.6; // below this we are "in space"
const ALL = 'ALL';
const SERVER_HINT =
  "The data server isn't running the new code. In Terminal: press Ctrl+C, then run npm install and npm run dev.";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- data helpers ----------

// Live: merge the selected artists' top cities into map points
function buildLivePoints(artists, selected) {
  const list = selected === ALL ? artists : artists.filter((a) => a.id === selected);
  const map = new Map();
  for (const a of list) {
    for (const c of a.cities) {
      const key = `${c.city}|${c.country}`;
      let p = map.get(key);
      if (!p) {
        p = { key, city: c.city, country: c.country, position: c.position, listeners: 0, artists: [] };
        map.set(key, p);
      }
      p.listeners += c.listeners;
      p.artists.push({ name: a.name, image: a.image, listeners: c.listeners });
    }
  }
  return [...map.values()];
}

// Group points by country, with a listener-weighted centre
function groupByCountry(points) {
  const map = new Map();
  for (const p of points) {
    const cc = p.country || 'IN';
    let g = map.get(cc);
    if (!g) {
      g = { cc, listeners: 0, points: [], wx: 0, wy: 0 };
      map.set(cc, g);
    }
    g.listeners += p.listeners;
    g.points.push(p);
    g.wx += p.position[0] * p.listeners;
    g.wy += p.position[1] * p.listeners;
  }
  return [...map.values()]
    .map((g) => ({ ...g, center: [g.wx / g.listeners, g.wy / g.listeners] }))
    .sort((a, b) => b.listeners - a.listeners);
}

function loadExtras() {
  try {
    return JSON.parse(localStorage.getItem('extraArtists') || '[]');
  } catch {
    return [];
  }
}

export default function App() {
  const mapDiv = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const spinRef = useRef(true);
  const pilotRef = useRef({ on: false, token: 0 });
  const groupsRef = useRef([]);
  const inViewFn = useRef(() => {});
  const firstStyle = useRef(true);

  const mode = 'live'; // real data only
  const [extras, setExtras] = useState(loadExtras);
  const [selected, setSelected] = useState(ALL);
  const [status, setStatus] = useState(null);
  const [zoom, setZoom] = useState(1.6);
  const [styleKey, setStyleKey] = useState('satellite');
  const [spin, setSpin] = useState(true);
  const [autopilot, setAutopilot] = useState(false);
  const [inView, setInView] = useState(null);
  const [city, setCity] = useState(null); // { name, loading, error, data }
  const [cityMoves, setCityMoves] = useState({});
  const [drawer, setDrawer] = useState(null);
  const [song, setSong] = useState(null); // song drawer
  const [mixLab, setMixLab] = useState(null); // Mix Lab: { track } or null
  const [galaxy, setGalaxy] = useState(null); // artist name shown in the Artist Galaxy
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [albums, setAlbums] = useState(null); // { artist } or { albumId } shown in the albums page
  const [genre, setGenre] = useState(null); // { tag, artist, songs } shown in the genre page
  const [library, setLibrary] = useState(false); // your Spotify library popup
  const [nowTrack, setNowTrack] = useState(null); // what's playing on your Spotify
  const { mode: perfMode, quality } = usePerf();
  const nowItem = useNowItem(nowTrack);
  useEffect(() => {
    startSetSync();
    startHabits(); // learns what you play after what (from Spotify's recently played)
  }, []);
  const [floatSet, setFloatSetState] = useState(() => {
    try {
      return localStorage.getItem('floatSet') === '1';
    } catch {
      return false;
    }
  });
  const setFloatSet = (v) => {
    setFloatSetState(v);
    try {
      localStorage.setItem('floatSet', v ? '1' : '0');
    } catch {}
  };
  const [follow, setFollow] = useState(() => {
    try {
      return localStorage.getItem('followMusic') !== '0';
    } catch {
      return true;
    }
  });
  const followRef = useRef(follow);
  followRef.current = follow;
  const [, tick] = useState(0);
  const { data: liveData, deltas, checkedAt, server } = useLiveData();

  // re-render every 30 s so "x min ago" stays fresh
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const artists = useMemo(() => {
    const ids = new Set(liveData.artists.map((a) => a.id));
    return [...liveData.artists, ...extras.filter((a) => !ids.has(a.id))].sort(
      (a, b) => b.listeners - a.listeners
    );
  }, [extras, liveData]);
  const current = artists.find((a) => a.id === selected);

  // ---------- map setup (once) ----------
  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: STYLES.satellite,
      center: [60, 20],
      zoom: 1.6,
      maxPitch: 75,
      attributionControl: { compact: true },
      pixelRatio: pixelRatioFor(getQuality()),
      fadeDuration: 150, // labels fade in quicker
    });
    mapRef.current = map;
    window.__map = map; // handy for debugging
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
      map.setSky(SKY);
      // real-time day / night shadow
      // dusk band (sun just below the horizon) + full night on top of it
      const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol' || l.id.startsWith('border'))?.id;
      for (const [id, alt, opacity] of [['dusk', 0, 0.3], ['night', -12, 0.38]]) {
        if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: nightPolygon(new Date(), alt) });
        if (!map.getLayer(id)) {
          map.addLayer(
            { id, type: 'fill', source: id, paint: { 'fill-color': '#000615', 'fill-opacity': opacity, 'fill-antialias': false } },
            firstLabel
          );
        }
      }
      // holographic lat/long grid
      if (!map.getSource('grid')) map.addSource('grid', { type: 'geojson', data: graticule() });
      if (!map.getLayer('grid')) {
        map.addLayer(
          {
            id: 'grid',
            type: 'line',
            source: 'grid',
            maxzoom: 6,
            paint: {
              'line-color': ['case', ['==', ['get', 'kind'], 'equator'], 'rgba(30,215,96,0.5)', 'rgba(30,215,96,0.24)'],
              'line-width': ['case', ['==', ['get', 'kind'], 'equator'], 1.2, 0.7],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, 1, 5, 0.4, 6, 0],
            },
          },
          firstLabel
        );
      }
      // 3D mountains (satellite style only)
      try {
        if (map.getSource('dem')) map.setTerrain(TERRAIN_SPEC);
      } catch (e) {
        console.warn('Terrain not available', e);
      }
    });
    const nightTimer = setInterval(() => {
      map.getSource('dusk')?.setData(nightPolygon(new Date(), 0));
      map.getSource('night')?.setData(nightPolygon(new Date(), -12));
    }, 60000);

    const overlay = new MapLibreOverlay({ interleaved: true, layers: [] });
    overlayRef.current = overlay;
    map.addControl(overlay);

    // bar sizes only need quarter-zoom steps: same value = no re-render
    map.on('zoom', () => setZoom(Math.round(map.getZoom() * 4) / 4));

    // Which country is on screen?
    const updateInView = () => {
      if (map.getZoom() < GLOBE_ZOOM) return setInView(null);
      const c = map.getCenter();
      const here = [c.lng, c.lat];
      let best = null;
      for (const g of groupsRef.current) {
        for (const p of g.points) {
          const d = distanceKm(here, p.position);
          if (!best || d < best.d) best = { d, cc: g.cc };
        }
      }
      setInView(best && best.d < 2500 ? best.cc : null);
    };
    map.on('moveend', updateInView);
    inViewFn.current = updateInView;

    // Gentle spin when zoomed out
    const spinGlobe = () => {
      if (!spinRef.current || pilotRef.current.on || map.getZoom() > 3.2 || map.isMoving()) return;
      const c = map.getCenter();
      c.lng -= 6;
      map.easeTo({ center: c, duration: 1000, easing: (n) => n });
    };
    map.on('moveend', spinGlobe);

    // Any touch by the user stops spin and autopilot
    const userTook = () => {
      spinRef.current = false;
      setSpin(false);
      stopAutopilot();
    };
    map.on('mousedown', userTook);
    map.on('touchstart', userTook);
    map.on('wheel', userTook);

    // Intro: spin for a moment, then start autopilot
    map.once('style.load', () => {
      setTimeout(spinGlobe, 300);
      setTimeout(() => {
        if (spinRef.current) startAutopilot();
      }, 4000);
    });

    const offPerf = attachPerf(map); // watches frame rate, adjusts quality
    return () => {
      offPerf();
      clearInterval(nightTimer);
      map.remove();
    };
  }, []);

  // ---------- style switch (skip first render) ----------
  useEffect(() => {
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    mapRef.current?.setStyle(STYLES[styleKey]);
  }, [styleKey]);

  // ---------- points on the map ----------
  const points = useMemo(() => buildLivePoints(artists, selected), [artists, selected]);

  const groups = useMemo(() => groupByCountry(points), [points]);
  groupsRef.current = groups;

  // re-check what's in view when data changes
  useEffect(() => {
    inViewFn.current();
  }, [groups]);

  const max = Math.max(1, ...points.map((d) => d.listeners));

  // bar size follows zoom so bars look right from space and up close
  const live = mode === 'live';
  const zb = Math.round(zoom * 4) / 4;
  const k = Math.pow(2, (4.4 - zb) * 0.85);
  const radius = Math.min(90000, Math.max(1500, 20000 * k));
  const height = Math.min(3200000, Math.max(30000, 750000 * k));
  // ---------- city labels, chart pins, the open-city pin ----------
  const [chartPins, setChartPins] = useState([]); // where the song you're playing is charting
  const labelPoints = useMemo(
    () => (zoom >= 3.4 ? [...points].sort((a, b) => b.listeners - a.listeners).slice(0, 30) : []),
    [points, zoom >= 3.4]
  );
  const cityPos = city?.data?.position || city?.position || null;
  // stable handlers, so the globe pieces don't re-render when the app does
  const openCityRef = useRef(null);
  const openCityFromMap = useCallback((c) => openCityRef.current?.(c, false), []);
  const openCityPin = useCallback((c) => openCityRef.current?.(c), []);

  // ---------- "What is this city listening to?" ----------
  const cityReq = useRef(0);
  async function loadCity(c) {
    const qs = new URLSearchParams({ name: c.name });
    if (c.country) qs.set('cc', c.country);
    const res = await fetch(`/api/city?${qs}`);
    if (!res.headers.get('content-type')?.includes('json')) throw new Error(SERVER_HINT);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'City lookup failed');
    return body;
  }

  openCityRef.current = (c, fly) => openCity(c, fly);
  async function openCity(c, fly = true) {
    const req = ++cityReq.current;
    stopAutopilot();
    spinRef.current = false;
    setSpin(false);
    setCityMoves({});
    setCity({ name: c.name, position: c.position, loading: true });
    if (fly && c.position) {
      mapRef.current?.flyTo({ center: c.position, zoom: 8.5, pitch: 60, bearing: -15, speed: 0.7, essential: true });
    }
    try {
      const data = await loadCity(c);
      if (req !== cityReq.current) return;
      setCity({ name: data.city, data });
      if (fly && !c.position) {
        mapRef.current?.flyTo({ center: data.position, zoom: 8.5, pitch: 60, bearing: -15, speed: 0.7, essential: true });
      }
    } catch (e) {
      if (req === cityReq.current) setCity({ name: c.name, error: e.message });
    }
  }

  // keep the open city chart live: re-check every 5 minutes, show rank moves
  useEffect(() => {
    const d = city?.data;
    if (!d) return;
    const t = setInterval(async () => {
      try {
        const next = await loadCity({ name: d.city, country: d.country });
        const before = new Map(d.chart.tracks.map((x) => [x.id, x.rank]));
        const moves = {};
        for (const x of next.chart.tracks) {
          if (!before.has(x.id)) moves[x.id] = 'new';
          else if (before.get(x.id) !== x.rank) moves[x.id] = before.get(x.id) - x.rank;
        }
        setCityMoves(moves);
        setCity((cur) => (cur?.data?.city === d.city ? { name: d.city, data: next } : cur));
      } catch {
        /* keep showing the last good chart */
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [city?.data?.city, city?.data?.fetchedAt]);

  // Spotify artists in our data whose top-5 cities include this city
  const spotifyHere = useMemo(() => {
    const d = city?.data;
    if (!d) return [];
    const out = [];
    for (const a of artists) {
      const hit = a.cities.find((c) => c.country === d.country && distanceKm(c.position, d.position) < 40);
      if (hit) out.push({ name: a.name, listeners: hit.listeners, artist: a });
    }
    return out.sort((x, y) => y.listeners - x.listeners).slice(0, 8);
  }, [city?.data, artists]);

  // click any artist name anywhere → open their Galaxy
  useEffect(() => {
    const on = (e) => {
      if (!e.detail) return;
      setGenre(null);
      setAlbums(null);
      setGalaxy(e.detail);
    };
    const onGenre = (e) => e.detail?.tag && setGenre(e.detail);
    const onAlbums = (e) => e.detail && setAlbums(e.detail);
    const onLyrics = () => setLyricsOpen((v) => !v);
    window.addEventListener('open-lyrics', onLyrics);
    window.addEventListener('open-galaxy', on);
    window.addEventListener('open-genre', onGenre);
    window.addEventListener('open-albums', onAlbums);
    return () => {
      window.removeEventListener('open-galaxy', on);
      window.removeEventListener('open-genre', onGenre);
      window.removeEventListener('open-albums', onAlbums);
      window.removeEventListener('open-lyrics', onLyrics);
    };
  }, []);

  // open the artist page; artists from charts may not be in our Spotify data
  function openArtist(a) {
    if (!a) return;
    const known = a.id ? a : artists.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
    setDrawer(known || { name: a.name });
  }

  // ---------- camera helpers ----------
  function fly(opts, token) {
    const map = mapRef.current;
    return new Promise((resolve) => {
      if (!map || (token && token !== pilotRef.current.token)) return resolve();
      let t;
      const done = () => {
        clearTimeout(t);
        map.off('moveend', done);
        resolve();
      };
      t = setTimeout(done, 20000); // never hang
      map.on('moveend', done);
      map.flyTo({ essential: true, ...opts });
    });
  }
  function ease(opts, token) {
    const map = mapRef.current;
    return new Promise((resolve) => {
      if (!map || token !== pilotRef.current.token) return resolve();
      let t;
      const done = () => {
        clearTimeout(t);
        map.off('moveend', done);
        resolve();
      };
      t = setTimeout(done, (opts.duration || 1000) + 3000);
      map.on('moveend', done);
      map.easeTo(opts);
    });
  }

  function flyToPlace(place) {
    stopAutopilot();
    spinRef.current = false;
    setSpin(false);
    fly({
      center: place.center,
      zoom: place.zoom,
      pitch: place.pitch ?? 45,
      bearing: place.bearing ?? 0,
      speed: 0.6,
      curve: 1.6,
    });
  }

  // Frame an artist: one country -> fly there, many -> view from space
  // Frame an artist: zoom into the country where they have the most listeners,
  // fitting all their cities there on screen (other countries: use Autopilot to tour).
  function frameGroups(gs) {
    if (!gs.length) return;
    const map = mapRef.current;
    const main = gs[0];
    let center = main.center;
    let zoom = countryZoom(main.cc);
    if (map && main.points.length > 1) {
      const lngs = main.points.map((p) => p.position[0]);
      const lats = main.points.map((p) => p.position[1]);
      try {
        const cam = map.cameraForBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: { top: 140, bottom: 170, left: 380, right: 380 }, maxZoom: 7 }
        );
        if (cam?.center && Number.isFinite(cam.zoom)) {
          center = [cam.center.lng, cam.center.lat];
          zoom = cam.zoom;
        }
      } catch {
        /* fall back to the country view */
      }
    }
    zoom = Math.max(3.2, Math.min(zoom, 7));
    flyToPlace({ center, zoom, pitch: 52, bearing: -12 });
  }

  // ---------- autopilot ----------
  async function startAutopilot() {
    const token = ++pilotRef.current.token;
    pilotRef.current.on = true;
    setCity(null);
    spinRef.current = false;
    setSpin(false);
    setAutopilot(true);
    const alive = () => pilotRef.current.on && pilotRef.current.token === token;

    let i = 0;
    while (alive()) {
      const gs = groupsRef.current;
      // Many countries -> tour countries. One country -> tour its cities.
      const stops =
        gs.length > 1
          ? gs.map((g) => ({ center: g.center, zoom: countryZoom(g.cc) }))
          : [...(gs[0]?.points || [])]
              .sort((a, b) => b.listeners - a.listeners)
              .map((p) => ({ center: p.position, zoom: 7.5 }));
      if (!stops.length) break;

      // after each full loop, pull back to space for a moment
      if (i > 0 && i % stops.length === 0) {
        await fly({ zoom: 1.9, pitch: 0, bearing: 0, speed: 0.7 }, token);
        if (!alive()) break;
        await sleep(2500);
      }
      const s = stops[i % stops.length];
      await fly(
        { center: s.center, zoom: s.zoom, pitch: 55, bearing: Math.random() * 40 - 20, speed: 0.5, curve: 1.5 },
        token
      );
      if (!alive()) break;
      // slow orbit while we look around
      await ease({ bearing: mapRef.current.getBearing() + 25, duration: 7000, easing: (t) => t }, token);
      i++;
    }
  }

  function stopAutopilot() {
    if (!pilotRef.current.on) return;
    pilotRef.current.on = false;
    pilotRef.current.token++;
    setAutopilot(false);
  }

  function toggleAutopilot() {
    if (pilotRef.current.on) {
      stopAutopilot();
      mapRef.current?.stop();
    } else startAutopilot();
  }

  function toggleSpin() {
    stopAutopilot();
    const next = !spin;
    spinRef.current = next;
    setSpin(next);
    if (next) mapRef.current?.flyTo({ zoom: 1.8, pitch: 0, bearing: 0, speed: 0.8 });
  }

  // ---------- selecting / searching artists ----------
  function showArtistOnGlobe(a) {
    if (!a?.id) return;
    setExtras((prev) => {
      if (liveData.artists.some((x) => x.id === a.id) || prev.some((x) => x.id === a.id)) return prev;
      const next = [...prev, a];
      try {
        localStorage.setItem('extraArtists', JSON.stringify(next));
      } catch {}
      return next;
    });
    setSelected(a.id);
    stopAutopilot();
    frameGroups(groupByCountry(buildLivePoints([a], a.id)));
  }

  // find an artist we already have by name
  const findArtist = (name) => {
    const n = name.toLowerCase();
    return artists.find((a) => a.name.toLowerCase() === n) || null;
  };

  // fetch any artist's Spotify stats (needs APIFY_TOKEN on the server)
  async function fetchArtist(name) {
    const r = await fetch(`/api/artist?name=${encodeURIComponent(name)}`);
    if (!r.headers.get('content-type')?.includes('json')) throw new Error(SERVER_HINT);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    setExtras((prev) => {
      if (prev.some((x) => x.id === j.id)) return prev;
      const next = [...prev, j];
      try {
        localStorage.setItem('extraArtists', JSON.stringify(next));
      } catch {}
      return next;
    });
    return j;
  }

  // "Show on globe" for the song you're playing
  async function showSongOnGlobe(track) {
    const main = track.artists[0]?.name;
    if (!main) return;
    const known = findArtist(main);
    if (known) return showArtistOnGlobe(known);
    setStatus({ loading: true, text: `Getting ${main}'s listener cities from Spotify…` });
    try {
      const a = await fetchArtist(main);
      setStatus(null);
      showArtistOnGlobe(a);
    } catch (e) {
      // no token yet: a gentle hint, not an error
      const noToken = /APIFY_TOKEN/.test(e.message);
      setStatus({
        hint: noToken,
        error: !noToken,
        text: noToken
          ? `${main} isn't in your artist list yet. Add an Apify token to load any artist's cities.`
          : e.message,
      });
      setTimeout(() => setStatus((s) => (s?.text?.startsWith(main) ? null : s)), 10000);
    }
  }

  function selectArtist(id) {
    setSelected(id);
    setStatus(null);
    const gs = groupByCountry(buildLivePoints(artists, id));
    if (!pilotRef.current.on) frameGroups(gs);
  }

  // Put an artist on the globe (tracked ones instantly, others looked up live)
  async function lookupArtist(q) {
    if (!q) return;
    const lc = q.toLowerCase();
    const hit =
      artists.find((a) => a.name.toLowerCase() === lc) ||
      artists.find((a) => a.name.toLowerCase().includes(lc));
    if (hit) return selectArtist(hit.id);

    setStatus({ loading: true, text: `Looking up “${q}” on Spotify…` });
    try {
      const res = await fetch(`/api/artist?name=${encodeURIComponent(q)}`);
      if (!res.headers.get('content-type')?.includes('json')) throw new Error(SERVER_HINT);
      const body = await res.json();
      if (!res.ok) return setStatus({ error: true, text: body.error });
      const next = [...extras.filter((a) => a.id !== body.id), body];
      setExtras(next);
      try {
        localStorage.setItem('extraArtists', JSON.stringify(next));
      } catch {}
      setStatus({ text: `Added ${body.name} · live from Spotify` });
      setSelected(body.id);
      frameGroups(groupByCountry(buildLivePoints([body], body.id)));
    } catch (err) {
      setStatus({ error: true, text: err.message || 'Lookup failed. Is the dev server running?' });
    }
  }

  // Globe / Country / City buttons
  function goLevel(l) {
    const map = mapRef.current;
    if (!map) return;
    stopAutopilot();
    spinRef.current = false;
    setSpin(false);
    const c = map.getCenter();
    const here = [c.lng, c.lat];
    if (l === 'Globe') return map.flyTo({ zoom: 1.8, pitch: 0, bearing: 0, speed: 0.8, essential: true });
    // nearest country / city with data to where you're looking
    const g = [...groups].sort((a, b) => distanceKm(here, a.center) - distanceKm(here, b.center))[0];
    if (!g) return;
    if (l === 'Country') {
      return map.flyTo({ center: g.center, zoom: countryZoom(g.cc), pitch: 50, speed: 0.7, essential: true });
    }
    const p = [...g.points].sort((a, b) => distanceKm(here, a.position) - distanceKm(here, b.position))[0];
    if (p?.city) openCity({ name: p.city, country: p.country, position: p.position });
  }

  // ---------- derived UI data ----------
  const level = zoom < GLOBE_ZOOM ? 'Globe' : zoom < 5.8 ? 'Country' : 'City';
  const topCities = [...points].sort((a, b) => b.listeners - a.listeners).slice(0, 6);

  const view = inView ? groups.find((g) => g.cc === inView) : null;
  const viewArtists = useMemo(() => {
    if (!view) return [];
    const m = new Map();
    for (const p of view.points)
      for (const a of p.artists || [])
        m.set(a.name, { ...a, listeners: (m.get(a.name)?.listeners || 0) + a.listeners });
    return [...m.values()].sort((a, b) => b.listeners - a.listeners).slice(0, 6);
  }, [view]);

  const headline =
    selected === ALL
      ? artists.reduce((a, x) => a + x.listeners, 0)
      : current?.listeners || 0;

  return (
    <div className="app">
      <Starfield mapRef={mapRef} />
      <div ref={mapDiv} className="map" />

      <GlobeBars
        mapRef={mapRef}
        overlayRef={overlayRef}
        points={points}
        max={max}
        radius={radius}
        height={height}
        quality={quality}
        onPickCity={openCityFromMap}
      />
      <MapLabels
        mapRef={mapRef}
        labelPoints={labelPoints}
        chartPins={chartPins}
        cityPos={cityPos}
        cityName={city?.data?.city || city?.name}
        onOpenCity={openCityPin}
      />
      <HoverTip />

      {/* ---------- left panel ---------- */}
      <div className="panel">
        <div className="brand">
          <div className={`dot ${live ? '' : 'demo'}`} />
          <h1>Listener Atlas</h1>

        </div>
        <div className="sub muted">
          {live ? (
            <span className="live-line">
              <span className={`live-dot ${server.online ? '' : 'off'}`} />
              Spotify data · updated {timeAgo(liveData.updatedAt)}
              {server.online && <> · checked {timeAgo(checkedAt)}</>}
              {server.online && !server.autoRefresh && <span className="warn"> · add token for auto-refresh</span>}
              {server.online === false && <span className="warn"> · data server not running (run npm install, then npm run dev)</span>}
            </span>
          ) : (
            <span className="warn">Sample data · India state detail</span>
          )}
        </div>

        {live && (
          <NowPlaying
            follow={follow}
            setFollow={(v) => {
              setFollow(v);
              try {
                localStorage.setItem('followMusic', v ? '1' : '0');
              } catch {}
            }}
            onSongChange={(t) => {
              setNowTrack(t);
              setChartPins([]);
              if (followRef.current) showSongOnGlobe(t);
            }}
            onDetails={(t) => setSong(t)}
            onMixLab={(t) => setMixLab({ track: t })}
            onLibrary={(tab) => setLibrary(typeof tab === 'string' ? tab : 'liked')}
            onShowOnGlobe={(t) => showSongOnGlobe(t)}
          />
        )}

        {live ? (
          <Safe name="Search" quiet>
            <MusicSearch
              tracked={artists}
              onArtistMap={(name) => lookupArtist(name)}
              onCity={(c) => openCity(c)}
              onMixLab={(t) => setMixLab({ track: t })}
            />
          </Safe>
        ) : null}
        {status && (
          <div className={`status ${status.error ? 'err' : ''} ${status.hint ? 'hint' : ''} ${status.loading ? 'loading' : ''}`}>
            {status.text}
          </div>
        )}

        <div className="hero">
          {live && current?.image && (
            <img src={current.image} alt="" className="clickable" onClick={() => setDrawer(current)} />
          )}
          <div>
            <div className="big">{fmt(headline)}</div>
            <div className="muted">
              {selected === ALL
                ? `combined monthly listeners · ${artists.length} artists`
                : `monthly listeners · ${current?.name}${current?.worldRank ? ` · #${current.worldRank} worldwide` : ''}`}
            </div>
            {live && current && deltas[current.id] ? (
              <div className={`delta ${deltas[current.id] > 0 ? 'up' : 'down'}`}>
                {deltas[current.id] > 0 ? '▲' : '▼'} {fmt(Math.abs(deltas[current.id]))} since last update
              </div>
            ) : null}
            {live && current && (
              <span className="artist-links">
                <button className="link-btn" onClick={() => setDrawer(current)}>
                  View artist page ›
                </button>
                <button className="link-btn" onClick={() => setGalaxy(current.name)}>
                  ✦ Galaxy ›
                </button>
              </span>
            )}
          </div>
        </div>

        <div className="pill-row">
          {['Globe', 'Country', 'City'].map((l) => (
            <button key={l} className={`pill ${level === l ? 'on' : ''}`} onClick={() => goLevel(l)}>
              {l}
            </button>
          ))}
        </div>

        <h3>Top cities</h3>
        <List
          rows={topCities.map((c) => [`${flag(c.country)} ${c.city || c.state}`, c.listeners])}
          max={topCities[0]?.listeners}
          onPick={(i) => {
            const c = topCities[i];
            if (c?.city && live) openCity({ name: c.city, country: c.country, position: c.position });
            else if (c?.position) mapRef.current?.flyTo({ center: c.position, zoom: 6.5, pitch: 55, essential: true });
          }}
        />

        {live && (
          <>
            <h3>Artists</h3>
            <div className="artists">
              <button className={`artist ${selected === ALL ? 'on' : ''}`} onClick={() => selectArtist(ALL)}>
                <span className="av all">🌍</span>
                <span className="an">All artists</span>
                <span className="muted">{artists.length}</span>
              </button>
              {artists.map((a) => (
                <button
                  key={a.id}
                  className={`artist ${selected === a.id ? 'on' : ''}`}
                  onClick={() => selectArtist(a.id)}
                >
                  {a.image ? <img className="av" src={a.image} alt="" /> : <span className="av" />}
                  <span className="an">{a.name}</span>
                  {deltas[a.id] ? (
                    <span className={`delta sm ${deltas[a.id] > 0 ? 'up' : 'down'}`}>
                      {deltas[a.id] > 0 ? '▲' : '▼'}
                      {fmt(Math.abs(deltas[a.id]))}
                    </span>
                  ) : null}
                  <span className="muted">{fmt(a.listeners)}</span>
                  <span
                    className="info"
                    title="Artist page"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDrawer(a);
                    }}
                  >
                    ⓘ
                  </span>
                </button>
              ))}
            </div>
            <p className="foot">
              Spotify only shares each artist's top 5 cities. “All artists” adds them up, so one person can be
              counted more than once.
            </p>
          </>
        )}
      </div>

      {/* ---------- in-view card ---------- */}
      {city && (
        <CityCard
          state={city}
          moves={cityMoves}
          spotifyHere={spotifyHere}
          onClose={() => setCity(null)}
          onArtist={openArtist}
        />
      )}

      {!city && view && (
        <div className="inview" key={view.cc}>
          <div className="iv-head">
            <span className="iv-flag">{flag(view.cc)}</span>
            <div>
              <div className="iv-label">{autopilot ? 'Autopilot · now over' : 'In view'}</div>
              <div className="iv-name">{countryName(view.cc)}</div>
            </div>
          </div>
          <div className="iv-num">{fmt(view.listeners)}</div>
          <div className="muted">listeners in top cities here</div>

          {viewArtists.length > 0 && (
            <>
              <h3>Top artists here</h3>
              <ul className="list">
                {viewArtists.map((a) => (
                  <li key={a.name}>
                    <div className="row">
                      <span className="iv-artist clickable" onClick={() => openArtist({ name: a.name })}>
                        {a.image && <img src={a.image} alt="" />}
                        {a.name}
                      </span>
                      <span className="muted">{fmt(a.listeners)}</span>
                    </div>
                    <div className="bar">
                      <div style={{ width: `${(a.listeners / viewArtists[0].listeners) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>Cities</h3>
          <div className="chips">
            {[...view.points]
              .sort((a, b) => b.listeners - a.listeners)
              .slice(0, 8)
              .map((p) => (
                <button
                  key={p.key || p.city}
                  className="chip"
                  onClick={() => openCity({ name: p.city, country: p.country, position: p.position })}
                >
                  {p.city} <b>{fmt(p.listeners)}</b>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* ---------- travel bar ---------- */}
      <div className="travel">
        <button className={`pilot ${autopilot ? 'active' : ''}`} onClick={toggleAutopilot}>
          {autopilot ? '■ Stop autopilot' : '▶ Autopilot'}
        </button>
        <span className="sep" />
        {PLACES.map((p) => (
          <button key={p.name} onClick={() => flyToPlace(p)}>
            {p.name}
          </button>
        ))}
        <span className="sep" />
        <button onClick={() => setMixLab({ track: nowTrack })}>🎛 Mix Lab</button>
        <button className={floatSet ? 'active' : ''} onClick={() => setFloatSet(!floatSet)}>
          ⧉ Set
        </button>
        <button
          className={perfMode !== 'auto' ? 'active' : ''}
          title="Auto: lowers detail only if your Mac struggles · Smooth: always light · Quality: always full detail"
          onClick={() => setPerfMode(perfMode === 'auto' ? 'smooth' : perfMode === 'smooth' ? 'quality' : 'auto')}
        >
          {perfMode === 'auto' ? `⚡ Auto${quality === 'smooth' ? ' · smooth' : ''}` : perfMode === 'smooth' ? '⚡ Smooth' : '✨ Quality'}
        </button>
        <span className="sep" />
        <button className={spin ? 'active' : ''} onClick={toggleSpin}>
          {spin ? '⏸ Spinning' : '🌍 Globe'}
        </button>
        <button onClick={() => setStyleKey(styleKey === 'satellite' ? 'dark' : 'satellite')}>
          {styleKey === 'satellite' ? '🌑 Dark' : '🛰 Satellite'}
        </button>
      </div>

      {autopilot && <div className="pilot-badge">● AUTOPILOT</div>}

      <Safe name="Live ticker" quiet>
        <LiveTicker onArtist={openArtist} />
      </Safe>
      <Safe name="Shazam" quiet>
        <Shazam onArtist={openArtist} />
      </Safe>
      <Safe name="Auto-DJ switch" quiet>
        <AutoDjFab onOpenSet={() => setMixLab({ track: nowTrack })} />
      </Safe>

      <SongDrawer
        track={song}
        findArtist={findArtist}
        fetchArtist={fetchArtist}
        onArtist={(a) => openArtist(a)}
        onShowArtist={(a) => {
          setSong(null);
          showArtistOnGlobe(a);
        }}
        onCity={(c) => {
          setSong(null);
          openCity({ name: c.city, country: c.country, position: c.position });
        }}
        onChartPins={setChartPins}
        onMixLab={(t) => {
          setSong(null);
          setMixLab({ track: t });
        }}
        onClose={() => setSong(null)}
      />

      {mixLab && (
        <Safe name="Mix Lab" onClose={() => setMixLab(null)}>
          <MixLab
            track={nowTrack || mixLab.track}
            onArtist={(a) => openArtist(a)}
            onLibrary={(tab) => setLibrary(typeof tab === 'string' ? tab : 'liked')}
            onFloat={() => setFloatSet(true)}
            floatingSet={floatSet}
            onDock={() => setFloatSet(false)}
            onClose={() => setMixLab(null)}
          />
        </Safe>
      )}
      {floatSet && (
        <Safe name="Your set" onClose={() => setFloatSet(false)} quiet>
          <FloatingSet
            start={nowItem}
            onClose={() => setFloatSet(false)}
            onDock={mixLab ? () => setFloatSet(false) : null}
            onLibrary={(tab) => setLibrary(typeof tab === 'string' ? tab : 'liked')}
          />
        </Safe>
      )}
      {library && (
        <Safe name="Library" onClose={() => setLibrary(false)}>
          <Library
            initialTab={library}
            onClose={() => setLibrary(false)}
            onMixLab={(t) => {
              setLibrary(false);
              setMixLab({ track: t });
            }}
          />
        </Safe>
      )}

      <ArtistDrawer
        artist={drawer}
        onClose={() => setDrawer(null)}
        onShowOnMap={(a) => {
          setDrawer(null);
          showArtistOnGlobe(a);
        }}
        onGalaxy={(n) => {
          setDrawer(null);
          setGalaxy(n);
        }}
      />

      {galaxy && (
        <Safe name="Artist Galaxy" onClose={() => setGalaxy(null)}>
          <ArtistGalaxy
            key={galaxy}
            name={galaxy}
            onClose={() => setGalaxy(null)}
            onMixLab={(t) => {
              setGalaxy(null);
              setMixLab({ track: t });
            }}
          />
        </Safe>
      )}

      {lyricsOpen && (
        <Safe name="Lyrics" onClose={() => setLyricsOpen(false)}>
          <LyricsView onClose={() => setLyricsOpen(false)} />
        </Safe>
      )}

      {albums && (
        <Safe name="Albums" onClose={() => setAlbums(null)}>
          <AlbumsView
            key={`${albums.artist}|${albums.albumId}`}
            artist={albums.artist}
            albumId={albums.albumId}
            onClose={() => setAlbums(null)}
            onMixLab={(t) => {
              setAlbums(null);
              setGalaxy(null);
              setMixLab({ track: t });
            }}
          />
        </Safe>
      )}

      {genre && (
        <Safe name="Genre" onClose={() => setGenre(null)}>
          <GenreView
            key={genre.tag}
            tag={genre.tag}
            artist={genre.artist}
            artistSongs={genre.songs}
            onClose={() => setGenre(null)}
            onMixLab={(t) => {
              setGenre(null);
              setGalaxy(null);
              setMixLab({ track: t });
            }}
          />
        </Safe>
      )}
    </div>
  );
}

function List({ rows, max, onPick }) {
  return (
    <ul className="list">
      {rows.map(([name, v], i) => (
        <li key={name} className={onPick ? 'clickable' : ''} onClick={() => onPick?.(i)}>
          <div className="row">
            <span>
              <span className="rank">{i + 1}</span>
              {name}
            </span>
            <span className="muted">{fmt(v)}</span>
          </div>
          <div className="bar">
            <div style={{ width: `${(v / (max || 1)) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
