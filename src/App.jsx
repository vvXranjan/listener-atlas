import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import { ColumnLayer, ScatterplotLayer } from '@deck.gl/layers';
import { useLiveData, timeAgo } from './useLiveData.js';
import CitySearch from './CitySearch.jsx';
import CityCard from './CityCard.jsx';
import ArtistDrawer from './ArtistDrawer.jsx';
import Starfield from './Starfield.jsx';
import LiveTicker from './LiveTicker.jsx';
import Shazam from './Shazam.jsx';
import NowPlaying from './NowPlaying.jsx';
import SongDrawer from './SongDrawer.jsx';
import { getArtistCities, toStates, SAMPLE_ARTISTS } from './data.js';
import { STYLES, SKY, PLACES, TERRAIN_SPEC, nightPolygon, graticule } from './mapStyles.js';
import { flag, countryName, countryZoom, distanceKm } from './countries.js';

const CITY_ZOOM = 5.8; // demo mode: zoom past this for city bars
const GLOBE_ZOOM = 2.6; // below this we are "in space"
const ALL = 'ALL';
const SERVER_HINT =
  "The data server isn't running the new code. In Terminal: press Ctrl+C, then run npm install and npm run dev.";

const fmt = (n) =>
  n >= 1e9
    ? (n / 1e9).toFixed(2) + 'B'
    : n >= 1e6
    ? (n / 1e6).toFixed(1) + 'M'
    : n >= 1e3
    ? Math.round(n / 1e3) + 'K'
    : String(n);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deep green -> Spotify green -> neon mint -> white-hot (futuristic Spotify palette)
const STOPS = [
  [0, [8, 70, 48]],
  [0.4, [30, 215, 96]],
  [0.75, [110, 255, 170]],
  [1, [225, 255, 238]],
];
function colorFor(value, max, alpha = 235) {
  const t = Math.sqrt(value / max);
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const k = (t - t0) / (t1 - t0);
      return [...c0.map((v, j) => Math.round(v + (c1[j] - v) * k)), alpha];
    }
  }
  return [...STOPS[STOPS.length - 1][1], alpha];
}

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

  const [mode, setMode] = useState('live'); // 'live' | 'demo'
  const [extras, setExtras] = useState(loadExtras);
  const [selected, setSelected] = useState(ALL);
  const [demoArtist, setDemoArtist] = useState('Arijit Singh');
  const [demoCities, setDemoCities] = useState([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState(null);
  const [zoom, setZoom] = useState(1.6);
  const [viewCenter, setViewCenter] = useState([60, 20]);
  const [styleKey, setStyleKey] = useState('satellite');
  const [spin, setSpin] = useState(true);
  const [autopilot, setAutopilot] = useState(false);
  const [inView, setInView] = useState(null);
  const [hover, setHover] = useState(null);
  const [labels, setLabels] = useState([]);
  const [searchMode, setSearchMode] = useState('artist'); // 'artist' | 'city'
  const [city, setCity] = useState(null); // { name, loading, error, data }
  const [cityMoves, setCityMoves] = useState({});
  const [drawer, setDrawer] = useState(null);
  const [song, setSong] = useState(null); // song drawer
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

    map.on('zoom', () => setZoom(map.getZoom()));

    // Track where the camera looks (every ~120 ms) so bars on the far side / edge of the
    // globe can fade out and rise smoothly when they turn toward you.
    let lastView = 0;
    const trackView = () => {
      const now = performance.now();
      if (now - lastView < 120) return;
      lastView = now;
      const c = map.getCenter();
      setViewCenter([Math.round(c.lng * 2) / 2, Math.round(c.lat * 2) / 2]);
    };
    map.on('move', trackView);
    map.on('moveend', () => {
      const c = map.getCenter();
      setViewCenter([Math.round(c.lng * 2) / 2, Math.round(c.lat * 2) / 2]);
    });

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

    return () => {
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

  // ---------- demo data ----------
  useEffect(() => {
    getArtistCities(demoArtist).then((cs) => setDemoCities(cs.map((c) => ({ ...c, country: 'IN' }))));
  }, [demoArtist]);

  // ---------- points on the map ----------
  const showDemoCities = zoom >= CITY_ZOOM;
  const points = useMemo(() => {
    if (mode === 'live') return buildLivePoints(artists, selected);
    return showDemoCities
      ? demoCities
      : toStates(demoCities).map((s) => ({ ...s, country: 'IN', city: null }));
  }, [mode, artists, selected, demoCities, showDemoCities]);

  const groups = useMemo(
    () => groupByCountry(mode === 'live' ? points : demoCities),
    [points, demoCities, mode]
  );
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
  const kDemo = Math.min(4, Math.max(1, k));
  const radius = live
    ? Math.min(90000, Math.max(1500, 20000 * k))
    : showDemoCities
    ? 9000
    : 26000 * kDemo;
  const height = live
    ? Math.min(3200000, Math.max(30000, 750000 * k))
    : showDemoCities
    ? 220000
    : 700000 * kDemo;
  // 1 = facing you, 0 = on the far side / edge of the globe (smooth in between)
  const FULL_KM = 4200;
  const ZERO_KM = 6400;
  const visible = useMemo(() => {
    const out = [];
    for (const d of points) {
      const dist = distanceKm(viewCenter, d.position);
      let w = (ZERO_KM - dist) / (ZERO_KM - FULL_KM);
      if (w <= 0) continue;
      w = Math.min(1, w);
      out.push({ ...d, w: w * w * (3 - 2 * w) });
    }
    return out;
  }, [points, viewCenter]);
  const elev = (d) => (d.listeners / max) * height * (d.w ?? 1);

  // ---------- layers ----------
  useEffect(() => {
    if (!overlayRef.current) return;
    overlayRef.current.setProps({
      layers: [
        new ScatterplotLayer({
          id: 'glow',
          data: visible,
          getPosition: (d) => d.position,
          getRadius: (d) => radius * (1.6 + Math.sqrt(d.listeners / max) * 1.6),
          getFillColor: (d) => colorFor(d.listeners, max, Math.round(80 * d.w)),
          stroked: true,
          getLineColor: (d) => [30, 215, 96, Math.round(160 * d.w)],
          lineWidthMinPixels: 1,
          transitions: { getFillColor: 300 },
          parameters: { depthWriteEnabled: false },
          updateTriggers: { getRadius: [max, radius], getFillColor: [max, viewCenter], getLineColor: [viewCenter] },
        }),
        new ColumnLayer({
          id: 'bars',
          data: visible,
          diskResolution: 32,
          radius,
          extruded: true,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 120],
          material: { ambient: 0.7, diffuse: 0.5, shininess: 64, specularColor: [190, 255, 220] },
          getPosition: (d) => d.position,
          getElevation: elev,
          getFillColor: (d) => colorFor(d.listeners, max, Math.round(240 * d.w)),
          onHover: (info) => setHover(info.object ? { ...info.object, x: info.x, y: info.y } : null),
          onClick: (info) => {
            const d = info.object;
            if (d?.city && d.country) openCity({ name: d.city, country: d.country, position: d.position }, false);
          },
          transitions: { getElevation: { duration: 600, enter: () => [0] }, getFillColor: 300 },
          updateTriggers: { getElevation: [max, height, viewCenter], getFillColor: [max, viewCenter] },
        }),
      ],
    });
  }, [visible, max, radius, height]);

  // ---------- HTML city labels (follow the map) ----------
  const labelSrc = useRef([]);
  const cityPos = useRef(null);
  cityPos.current = city?.data?.position || city?.position || null;
  const [pin, setPin] = useState(null);
  const [chartPins, setChartPins] = useState([]); // where the song you're playing is charting
  const chartSrc = useRef([]);
  chartSrc.current = chartPins;
  const [chartPinPos, setChartPinPos] = useState([]);
  labelSrc.current = zoom >= 3.4 ? [...points].sort((a, b) => b.listeners - a.listeners).slice(0, 30) : [];
  // labels only for cities clearly facing you
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let raf = 0;
    const place = () => {
      raf = 0;
      const c = map.getCenter();
      const here = [c.lng, c.lat];
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      const out = [];
      for (const d of labelSrc.current) {
        if (distanceKm(here, d.position) > 4300) continue; // only cities facing you
        const pt = map.project(d.position);
        if (pt.x < -50 || pt.y < -50 || pt.x > w + 50 || pt.y > h + 50) continue;
        // skip if it would overlap a bigger city's label
        if (out.some((o) => Math.abs(o.x - pt.x) < 70 && Math.abs(o.y - pt.y) < 30)) continue;
        out.push({ key: d.key || d.state, x: pt.x, y: pt.y, name: d.city || d.state, value: d.listeners });
      }
      setLabels(out);
      setChartPinPos(
        chartSrc.current
          .filter((c) => distanceKm(here, c.position) < 4300)
          .map((c) => ({ ...c, ...map.project(c.position) }))
      );
      if (cityPos.current && distanceKm(here, cityPos.current) < 7000) {
        const p = map.project(cityPos.current);
        setPin({ x: p.x, y: p.y });
      } else setPin(null);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    map.on('move', schedule);
    schedule();
    return () => {
      map.off('move', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [points, zoom >= 3.4, city?.data?.position, city?.position, chartPins]);

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
  function frameGroups(gs) {
    if (!gs.length) return;
    if (gs.length === 1) flyToPlace({ center: gs[0].center, zoom: countryZoom(gs[0].cc), pitch: 50 });
    else flyToPlace({ center: gs[0].center, zoom: 1.9, pitch: 0 });
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
    setMode('live');
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
      setStatus({ error: true, text: e.message });
    }
  }

  function selectArtist(id) {
    setSelected(id);
    setStatus(null);
    const gs = groupByCountry(buildLivePoints(artists, id));
    if (!pilotRef.current.on) frameGroups(gs);
  }

  async function onSearch(e) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    if (mode === 'demo') {
      setDemoArtist(q);
      return flyToPlace(PLACES[0]);
    }
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
    mode === 'demo'
      ? demoCities.reduce((a, c) => a + c.listeners, 0)
      : selected === ALL
      ? artists.reduce((a, x) => a + x.listeners, 0)
      : current?.listeners || 0;

  return (
    <div className="app">
      <Starfield mapRef={mapRef} />
      <div ref={mapDiv} className="map" />

      <div className="labels">
        {labels.map((l) => (
          <div key={l.key} className="label" style={{ transform: `translate(${l.x}px, ${l.y}px)` }}>
            <span>{l.name}</span>
            <b>{fmt(l.value)}</b>
          </div>
        ))}
      </div>

      {chartPinPos.map((c) => (
        <div
          key={c.city}
          className="chart-pin"
          style={{ transform: `translate(${c.x}px, ${c.y}px)` }}
          onClick={() => openCity({ name: c.city, country: c.country, position: c.position })}
        >
          <span className="cp-dot" />
          <span className="cp-text">
            #{c.rank} {c.city}
          </span>
        </div>
      ))}

      {pin && (
        <div className="city-pin" style={{ transform: `translate(${pin.x}px, ${pin.y}px)` }}>
          <span className="ring" />
          <span className="ring r2" />
          <span className="dot-c" />
          <span className="pin-name">{city?.data?.city || city?.name}</span>
        </div>
      )}

      {hover && (
        <div className="tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <b>
            {flag(hover.country)} {hover.city || hover.state}
          </b>
          <div className="tipnum">{fmt(hover.listeners)}</div>
          <div className="muted">monthly listeners{hover.artists?.length > 1 ? ' (sum)' : ''}</div>
          {hover.city && <div className="tip-hint">Click to see what {hover.city} is playing</div>}
          {hover.artists?.length > 1 && (
            <div className="tip-artists">
              {[...hover.artists]
                .sort((a, b) => b.listeners - a.listeners)
                .slice(0, 4)
                .map((a) => (
                  <div key={a.name} className="row">
                    <span>{a.name}</span>
                    <span className="muted">{fmt(a.listeners)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- left panel ---------- */}
      <div className="panel">
        <div className="brand">
          <div className={`dot ${live ? '' : 'demo'}`} />
          <h1>Listener Atlas</h1>
          <div className="seg">
            <button className={live ? 'on' : ''} onClick={() => setMode('live')}>
              Live
            </button>
            <button className={!live ? 'on' : ''} onClick={() => setMode('demo')}>
              Demo
            </button>
          </div>
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
              setChartPins([]);
              if (followRef.current) showSongOnGlobe(t);
            }}
            onDetails={(t) => setSong(t)}
            onShowOnGlobe={(t) => showSongOnGlobe(t)}
          />
        )}

        {live && (
          <div className="seg wide">
            <button className={searchMode === 'artist' ? 'on' : ''} onClick={() => setSearchMode('artist')}>
              🎤 Artist
            </button>
            <button className={searchMode === 'city' ? 'on' : ''} onClick={() => setSearchMode('city')}>
              🏙 City
            </button>
          </div>
        )}

        {live && searchMode === 'city' ? (
          <CitySearch onPick={(c) => openCity(c)} loading={city?.loading} />
        ) : (
        <form onSubmit={onSearch}>
          <input
            list="artist-names"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={live ? 'Search any artist…' : 'Type an artist…'}
          />
          <datalist id="artist-names">
            {(live ? artists.map((a) => a.name) : Object.keys(SAMPLE_ARTISTS)).map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <button disabled={status?.loading}>{status?.loading ? '…' : 'Go'}</button>
        </form>
        )}
        {status && (
          <div className={`status ${status.error ? 'err' : ''} ${status.loading ? 'loading' : ''}`}>
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
              {mode === 'demo'
                ? `monthly listeners in India · ${demoArtist}`
                : selected === ALL
                ? `combined monthly listeners · ${artists.length} artists`
                : `monthly listeners · ${current?.name}${current?.worldRank ? ` · #${current.worldRank} worldwide` : ''}`}
            </div>
            {live && current && deltas[current.id] ? (
              <div className={`delta ${deltas[current.id] > 0 ? 'up' : 'down'}`}>
                {deltas[current.id] > 0 ? '▲' : '▼'} {fmt(Math.abs(deltas[current.id]))} since last update
              </div>
            ) : null}
            {live && current && (
              <button className="link-btn" onClick={() => setDrawer(current)}>
                View artist page ›
              </button>
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
        <button className={spin ? 'active' : ''} onClick={toggleSpin}>
          {spin ? '⏸ Spinning' : '🌍 Globe'}
        </button>
        <button onClick={() => setStyleKey(styleKey === 'satellite' ? 'dark' : 'satellite')}>
          {styleKey === 'satellite' ? '🌑 Dark' : '🛰 Satellite'}
        </button>
      </div>

      {autopilot && <div className="pilot-badge">● AUTOPILOT</div>}

      <LiveTicker onArtist={openArtist} />
      <Shazam onArtist={openArtist} />

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
        onClose={() => setSong(null)}
      />

      <ArtistDrawer
        artist={drawer}
        onClose={() => setDrawer(null)}
        onShowOnMap={(a) => {
          setDrawer(null);
          showArtistOnGlobe(a);
        }}
      />
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
