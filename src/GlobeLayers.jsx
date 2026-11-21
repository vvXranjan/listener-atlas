import React, { memo, useEffect, useRef, useState } from 'react';
import { ColumnLayer, ScatterplotLayer } from '@deck.gl/layers';
import { distanceKm, flag } from './countries.js';

// Everything that changes every frame while the globe moves lives here, in small
// components with their own state. The rest of the app (panels, drawers, player)
// no longer re-renders 60 times a second while you spin or fly.

export const fmt = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);

// Deep green -> Spotify green -> neon mint -> white-hot
const STOPS = [
  [0, [8, 70, 48]],
  [0.4, [30, 215, 96]],
  [0.75, [110, 255, 170]],
  [1, [225, 255, 238]],
];
export function colorFor(value, max, alpha = 235) {
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

// 1 = facing you, 0 = on the far side / edge of the globe (smooth in between)
const FULL_KM = 4200;
const ZERO_KM = 6400;
export function facing(points, center) {
  const out = [];
  for (const d of points) {
    const dist = distanceKm(center, d.position);
    let w = (ZERO_KM - dist) / (ZERO_KM - FULL_KM);
    if (w <= 0) continue;
    w = Math.min(1, w);
    out.push({ ...d, w: w * w * (3 - 2 * w) });
  }
  return out;
}

// Camera centre, rounded to 1° and updated at most ~6 times a second.
// Same value = no re-render.
function useCameraCenter(mapRef) {
  const [center, setCenter] = useState([60, 20]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let last = 0;
    let trailing = 0;
    const read = () => {
      const c = map.getCenter();
      const x = Math.round(c.lng);
      const y = Math.round(c.lat);
      setCenter((p) => (p[0] === x && p[1] === y ? p : [x, y]));
    };
    const onMove = () => {
      const now = performance.now();
      clearTimeout(trailing);
      if (now - last > 160) {
        last = now;
        read();
      } else trailing = setTimeout(read, 170); // always land on the final position
    };
    map.on('move', onMove);
    read();
    return () => {
      map.off('move', onMove);
      clearTimeout(trailing);
    };
  }, [mapRef]);
  return center;
}

// ---------- hover tooltip (its own tiny state) ----------
let hoverSet = null;
export const showHover = (h) => hoverSet?.(h);

export const HoverTip = memo(function HoverTip() {
  const [hover, setHover] = useState(null);
  useEffect(() => {
    hoverSet = setHover;
    return () => (hoverSet = null);
  }, []);
  if (!hover) return null;
  return (
    <div className="tip" style={{ transform: `translate3d(${hover.x + 14}px, ${hover.y + 14}px, 0)` }}>
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
  );
});

// ---------- 3D bars ----------
export const GlobeBars = memo(function GlobeBars({ mapRef, overlayRef, points, max, radius, height, quality, onPickCity }) {
  const center = useCameraCenter(mapRef);
  const pick = useRef(onPickCity);
  pick.current = onPickCity;

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const visible = facing(points, center);
    const elev = (d) => (d.listeners / max) * height * (d.w ?? 1);
    let lastHover = null;
    overlay.setProps({
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
          updateTriggers: { getRadius: [max, radius], getFillColor: [max, center], getLineColor: [center] },
        }),
        new ColumnLayer({
          id: 'bars',
          data: visible,
          diskResolution: quality === 'smooth' ? 16 : 28,
          radius,
          extruded: true,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 120],
          material: { ambient: 0.7, diffuse: 0.5, shininess: 64, specularColor: [190, 255, 220] },
          getPosition: (d) => d.position,
          getElevation: elev,
          getFillColor: (d) => colorFor(d.listeners, max, Math.round(240 * d.w)),
          onHover: (info) => {
            // only tell the tooltip when something actually changed
            const o = info.object || null;
            if (!o && !lastHover) return;
            lastHover = o;
            showHover(o ? { ...o, x: info.x, y: info.y } : null);
          },
          onClick: (info) => {
            const d = info.object;
            if (d?.city && d.country) pick.current?.({ name: d.city, country: d.country, position: d.position });
          },
          transitions: { getElevation: { duration: 600, enter: () => [0] }, getFillColor: 300 },
          updateTriggers: { getElevation: [max, height, center], getFillColor: [max, center] },
        }),
      ],
    });
  }, [points, center, max, radius, height, quality, overlayRef]);

  return null;
});

// ---------- city labels + pins that follow the map ----------
export const MapLabels = memo(function MapLabels({ mapRef, labelPoints, chartPins, cityPos, cityName, onOpenCity }) {
  const [state, setState] = useState({ labels: [], pins: [], pin: null });
  const src = useRef({});
  src.current = { labelPoints, chartPins, cityPos };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let raf = 0;
    const place = () => {
      raf = 0;
      const { labelPoints: lp, chartPins: cp, cityPos: pos } = src.current;
      const c = map.getCenter();
      const here = [c.lng, c.lat];
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      const labels = [];
      for (const d of lp) {
        if (distanceKm(here, d.position) > 4300) continue; // only cities facing you
        const pt = map.project(d.position);
        if (pt.x < -50 || pt.y < -50 || pt.x > w + 50 || pt.y > h + 50) continue;
        if (labels.some((o) => Math.abs(o.x - pt.x) < 70 && Math.abs(o.y - pt.y) < 30)) continue;
        labels.push({ key: d.key || d.state, x: Math.round(pt.x), y: Math.round(pt.y), name: d.city || d.state, value: d.listeners });
      }
      const pins = cp.filter((p) => distanceKm(here, p.position) < 4300).map((p) => ({ ...p, ...map.project(p.position) }));
      let pin = null;
      if (pos && distanceKm(here, pos) < 7000) {
        const p = map.project(pos);
        pin = { x: Math.round(p.x), y: Math.round(p.y) };
      }
      setState({ labels, pins, pin });
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
  }, [mapRef, labelPoints, chartPins, cityPos?.[0], cityPos?.[1]]);

  return (
    <>
      <div className="labels">
        {state.labels.map((l) => (
          <div key={l.key} className="label" style={{ transform: `translate3d(${l.x}px, ${l.y}px, 0)` }}>
            <span>{l.name}</span>
            <b>{fmt(l.value)}</b>
          </div>
        ))}
      </div>
      {state.pins.map((c) => (
        <div
          key={c.city}
          className="chart-pin"
          style={{ transform: `translate3d(${c.x}px, ${c.y}px, 0)` }}
          onClick={() => onOpenCity({ name: c.city, country: c.country, position: c.position })}
        >
          <span className="cp-dot" />
          <span className="cp-text">
            #{c.rank} {c.city}
          </span>
        </div>
      ))}
      {state.pin && (
        <div className="city-pin" style={{ transform: `translate3d(${state.pin.x}px, ${state.pin.y}px, 0)` }}>
          <span className="ring" />
          <span className="ring r2" />
          <span className="dot-c" />
          <span className="pin-name">{cityName}</span>
        </div>
      )}
    </>
  );
});
