import { describe, it, expect } from 'vitest';
import { nightPolygon, graticule } from '../src/mapStyles.js';

const latAt = (poly, lng) => poly.geometry.coordinates[0].find((p) => p[0] === lng)[1];

describe('day / night shadow', () => {
  it('puts the night side opposite the sun (21 Nov, 11:55 UTC)', () => {
    const p = nightPolygon(new Date('2026-11-21T11:55:00Z'), 0);
    // northern winter: the north pole is dark, so the ring closes at +89.9
    expect(p.geometry.coordinates[0][0][1]).toBeCloseTo(89.9);
    // near the noon meridian only the far north is dark
    expect(latAt(p, 0)).toBeGreaterThan(60);
    // at the midnight meridian almost the whole globe is dark
    expect(latAt(p, 180)).toBeLessThan(-60);
    // China (120E) is dark at 7:55 pm local time
    expect(latAt(p, 120)).toBeLessThan(0);
  });

  it('flips the dark pole in northern summer', () => {
    const p = nightPolygon(new Date('2026-06-21T12:00:00Z'), 0);
    expect(p.geometry.coordinates[0][0][1]).toBeCloseTo(-89.9);
  });

  it('makes full night smaller than the dusk area', () => {
    const date = new Date('2026-11-21T11:55:00Z');
    // at India's longitude the -12° (night) line is further north than the sunset line
    expect(latAt(nightPolygon(date, -12), 80)).toBeGreaterThan(latAt(nightPolygon(date, 0), 80));
  });

  it('builds a closed, valid polygon', () => {
    const ring = nightPolygon(new Date()).geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lng, lat] of ring) {
      expect(Number.isFinite(lng) && Number.isFinite(lat)).toBe(true);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
    }
  });

  it('draws the holographic grid with an equator', () => {
    const g = graticule();
    expect(g.features.some((f) => f.properties.kind === 'equator')).toBe(true);
    expect(g.features.length).toBeGreaterThan(30);
  });
});
