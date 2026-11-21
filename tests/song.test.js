import { describe, it, expect } from 'vitest';
import { cleanTitle } from '../server/song.mjs';
import { slugify, strip } from '../server/api.mjs';

describe('song title matching', () => {
  it('ignores features, remixes and brackets', () => {
    expect(cleanTitle('Spaceship (feat. Shake Wells & Don Toliver)')).toBe('spaceship');
    expect(cleanTitle('Spaceship - Remix')).toBe('spaceship');
    expect(cleanTitle('Veezha Veera (From "OM Chapter 1") [Tamil]')).toBe('veezha veera');
  });
});

describe('text helpers', () => {
  it('makes Apple Music style slugs', () => {
    expect(slugify('New York City')).toBe('new-york-city');
    expect(slugify('São Paulo')).toBe('sao-paulo');
    expect(strip('  Bogotá ')).toBe('bogota');
  });
});
