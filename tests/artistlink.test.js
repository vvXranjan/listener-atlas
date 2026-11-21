import { it, expect } from 'vitest';
import { artistParts } from '../src/ArtistLink.jsx';

const names = (s) => artistParts(s).filter((p) => !p.sep).map((p) => p.text);

it('splits artist credits into separate links', () => {
  expect(names('Tory Lanez')).toEqual(['Tory Lanez']);
  expect(names('Travis Scott, Don Toliver')).toEqual(['Travis Scott', 'Don Toliver']);
  expect(names('Future & Metro Boomin feat. Kendrick Lamar')).toEqual(['Future', 'Metro Boomin', 'Kendrick Lamar']);
  expect(names('Tyler, The Creator, Kali Uchis')).toEqual(['Tyler, The Creator', 'Kali Uchis']);
  expect(artistParts('A, B').map((p) => p.text).join('')).toBe('A, B');
});
