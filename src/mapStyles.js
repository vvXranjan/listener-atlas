// Free basemaps, no keys:
//  - Satellite photos: Esri World Imagery (attribution required)
//  - 3D terrain + relief shading: AWS Terrain Tiles (Mapzen terrarium)
//  - Sharp labels & borders: OpenFreeMap (OpenStreetMap data)

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const OFM = 'https://tiles.openfreemap.org';
const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

const labelLayers = [
  // country borders
  {
    id: 'border-country',
    type: 'line',
    source: 'osm',
    'source-layer': 'boundary',
    filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
    paint: {
      'line-color': 'rgba(120,255,180,0.55)',
      'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1.4, 10, 2],
      'line-blur': 0.4,
    },
  },
  // state / province borders
  {
    id: 'border-state',
    type: 'line',
    source: 'osm',
    'source-layer': 'boundary',
    minzoom: 3.5,
    filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
    paint: { 'line-color': 'rgba(120,255,180,0.25)', 'line-width': 0.8, 'line-dasharray': [3, 2] },
  },
  // seas and oceans
  {
    id: 'label-water',
    type: 'symbol',
    source: 'osm',
    'source-layer': 'water_name',
    filter: ['in', ['get', 'class'], ['literal', ['ocean', 'sea', 'bay', 'gulf', 'strait']]],
    layout: {
      'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
      'text-font': ['Noto Sans Italic'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 6, 13],
      'text-letter-spacing': 0.15,
      'text-max-width': 6,
    },
    paint: { 'text-color': 'rgba(170,215,255,0.85)', 'text-halo-color': 'rgba(0,20,40,0.6)', 'text-halo-width': 1 },
  },
  // countries
  {
    id: 'label-country',
    type: 'symbol',
    source: 'osm',
    'source-layer': 'place',
    filter: ['==', ['get', 'class'], 'country'],
    layout: {
      'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
      'text-font': FONT_BOLD,
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.12,
      'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9, 4, 13, 7, 16],
      'text-max-width': 7,
    },
    paint: { 'text-color': '#d9ffe9', 'text-halo-color': 'rgba(0,25,12,0.85)', 'text-halo-width': 1.4 },
  },
  // states
  {
    id: 'label-state',
    type: 'symbol',
    source: 'osm',
    'source-layer': 'place',
    minzoom: 4,
    maxzoom: 9,
    filter: ['==', ['get', 'class'], 'state'],
    layout: {
      'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
      'text-font': FONT,
      'text-size': 11,
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.08,
    },
    paint: { 'text-color': 'rgba(255,255,255,0.7)', 'text-halo-color': 'rgba(0,0,0,0.7)', 'text-halo-width': 1 },
  },
  // cities and towns
  {
    id: 'label-city',
    type: 'symbol',
    source: 'osm',
    'source-layer': 'place',
    minzoom: 3,
    filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
    layout: {
      'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
      'text-font': FONT,
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 13, 12, 16],
      'text-anchor': 'top',
      'text-offset': [0, 0.4],
      'symbol-sort-key': ['get', 'rank'],
    },
    paint: { 'text-color': '#eafff2', 'text-halo-color': 'rgba(0,20,10,0.85)', 'text-halo-width': 1.3 },
  },
  // neighbourhoods when zoomed right in
  {
    id: 'label-suburb',
    type: 'symbol',
    source: 'osm',
    'source-layer': 'place',
    minzoom: 10,
    filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'village']]],
    layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': FONT, 'text-size': 11 },
    paint: { 'text-color': 'rgba(255,255,255,0.8)', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 1 },
  },
];

export const STYLES = {
  satellite: {
    version: 8,
    glyphs: `${OFM}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      sat: {
        type: 'raster',
        tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      },
      dem: {
        type: 'raster-dem',
        tiles: [TERRAIN],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14,
        attribution: 'Terrain: Mapzen / AWS',
      },
      hills: {
        type: 'raster-dem',
        tiles: [TERRAIN],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14,
      },
      osm: {
        type: 'vector',
        url: `${OFM}/planet`,
        attribution: '© OpenStreetMap contributors, OpenFreeMap',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#02060a' } },
      {
        id: 'sat',
        type: 'raster',
        source: 'sat',
        paint: {
          'raster-saturation': -0.05,
          'raster-contrast': 0.18,
          'raster-brightness-max': 0.88,
          'raster-fade-duration': 250,
        },
      },
      {
        id: 'relief',
        type: 'hillshade',
        source: 'hills',
        paint: {
          'hillshade-exaggeration': 0.35,
          'hillshade-shadow-color': 'rgba(0,0,0,0.55)',
          'hillshade-highlight-color': 'rgba(255,255,255,0.12)',
        },
      },
      ...labelLayers,
    ],
  },
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};

export const TERRAIN_SPEC = { source: 'dem', exaggeration: 1.4 };

// Blue atmosphere glow around the globe
export const SKY = {
  'sky-color': '#03140c',
  'horizon-color': '#5cf2a6',
  'fog-color': '#03140c',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 0.2,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
};

// Travel buttons
export const PLACES = [
  { name: '🇮🇳 India', center: [79.5, 22.5], zoom: 4.2, pitch: 50, bearing: -10 },
  { name: '🇷🇺 Russia', center: [90, 62], zoom: 2.8, pitch: 30 },
  { name: '🇦🇺 Australia', center: [134, -25], zoom: 3.3, pitch: 35 },
  { name: '🇺🇸 USA', center: [-98, 39], zoom: 3.3, pitch: 35 },
  { name: '🇪🇺 Europe', center: [12, 50], zoom: 3.5, pitch: 35 },
  { name: '🇯🇵 Japan', center: [138, 37], zoom: 4.5, pitch: 40 },
  { name: '🇧🇷 Brazil', center: [-52, -12], zoom: 3.3, pitch: 35 },
];

// ---------- holographic grid (lat/long lines every 15°) ----------
export function graticule(step = 15) {
  const lines = [];
  for (let lng = -180; lng < 180; lng += step) {
    const coords = [];
    for (let lat = -80; lat <= 80; lat += 2) coords.push([lng, lat]);
    lines.push({ type: 'Feature', properties: { kind: 'meridian' }, geometry: { type: 'LineString', coordinates: coords } });
  }
  for (let lat = -75; lat <= 75; lat += step) {
    const coords = [];
    for (let lng = -180; lng <= 180; lng += 2) coords.push([lng, lat]);
    lines.push({
      type: 'Feature',
      properties: { kind: lat === 0 ? 'equator' : 'parallel' },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  return { type: 'FeatureCollection', features: lines };
}

// ---------- real-time day / night ----------
// Polygon of the area where the sun is below `altitude` degrees right now.
// altitude 0 = sunset line, -12 = proper night (dusk band in between).
export function nightPolygon(date = new Date(), altitude = 0) {
  const rad = Math.PI / 180;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 864e5;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  // sun declination and the longitude where the sun is overhead
  const decl = -23.44 * Math.cos(rad * (360 / 365) * (day + 10));
  const b = (rad * 360 * (day - 81)) / 365;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b); // minutes
  const sunLng = -15 * (hours - 12 + eot / 60);

  const d = (Math.abs(decl) < 0.01 ? 0.01 : decl) * rad;
  const sinH = Math.sin(altitude * rad);
  const pts = [];
  for (let lng = -180; lng <= 180; lng += 2) {
    const H = (lng - sunLng) * rad;
    // solve sin(h) = sin(lat)sin(d) + cos(lat)cos(d)cos(H) for lat
    const A = Math.sin(d);
    const B = Math.cos(d) * Math.cos(H);
    const R = Math.hypot(A, B);
    const theta = Math.atan2(B, A);
    const base = Math.asin(Math.max(-1, Math.min(1, sinH / R)));
    const norm = (x) => Math.atan2(Math.sin(x), Math.cos(x)); // wrap to -180..180°
    // two mathematical answers; the real one is the latitude between -90° and 90°
    const c1 = norm(base - theta);
    const c2 = norm(Math.PI - base - theta);
    const lat = Math.abs(c1) <= Math.PI / 2 ? c1 : c2;
    pts.push([lng, Math.max(-89.9, Math.min(89.9, lat / rad))]);
  }
  const pole = decl > 0 ? -89.9 : 89.9; // the pole facing away from the sun is in darkness
  const ring = [[-180, pole], ...pts, [180, pole], [-180, pole]];
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}
