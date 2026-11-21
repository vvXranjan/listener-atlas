import { describe, it, expect } from 'vitest';
import live from '../src/data/live.json';
import { geocode, normalizeArtist } from '../scripts/normalize.mjs';

describe('bundled Spotify data', () => {
  it('has artists with listeners and mapped cities', () => {
    expect(live.artists.length).toBeGreaterThanOrEqual(50);
    for (const a of live.artists) {
      expect(a.id).toMatch(/^[A-Za-z0-9]{22}$/);
      expect(a.listeners).toBeGreaterThan(0);
      expect(a.cities.length).toBeGreaterThan(0);
      for (const c of a.cities) {
        const [lng, lat] = c.position;
        expect(Math.abs(lng)).toBeLessThanOrEqual(180);
        expect(Math.abs(lat)).toBeLessThanOrEqual(90);
        expect(c.listeners).toBeGreaterThan(0);
      }
    }
  });

  it('has no duplicate artists', () => {
    const ids = live.artists.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a valid update time', () => {
    expect(Number.isNaN(new Date(live.updatedAt).getTime())).toBe(false);
  });
});

describe('city coordinates', () => {
  it('finds well-known cities in the right country', () => {
    const [lng, lat] = geocode('Bengaluru', 'IN');
    expect(lat).toBeCloseTo(12.97, 0);
    expect(lng).toBeCloseTo(77.59, 0);
    expect(geocode('London', 'GB')[1]).toBeCloseTo(51.5, 0);
    expect(geocode('São Paulo', 'BR')).not.toBeNull();
    expect(geocode('New York City', 'US')).not.toBeNull();
    expect(geocode('Kochi', 'IN')).not.toBeNull();
  });

  it('skips cities it cannot place instead of crashing', () => {
    const a = normalizeArtist({
      id: 'x',
      name: 'Test',
      monthlyListeners: 10,
      topCities: [
        { city: 'Atlanta', country: 'US', listeners: 5 },
        { city: 'Nowhereville Zzz', country: 'US', listeners: 1 },
      ],
    });
    expect(a.cities.map((c) => c.city)).toEqual(['Atlanta']);
    expect(a.topTracks).toEqual([]);
  });
});
