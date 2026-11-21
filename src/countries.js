// Country names, flags and a good camera zoom for autopilot.
// Unknown countries still work (shown by code, default zoom).

export const COUNTRIES = {
  IN: { name: 'India', zoom: 4.3 },
  US: { name: 'United States', zoom: 3.3 },
  GB: { name: 'United Kingdom', zoom: 5.2 },
  MX: { name: 'Mexico', zoom: 4.6 },
  BR: { name: 'Brazil', zoom: 4.2 },
  AU: { name: 'Australia', zoom: 4.2 },
  PH: { name: 'Philippines', zoom: 5.5 },
  ID: { name: 'Indonesia', zoom: 5.0 },
  MY: { name: 'Malaysia', zoom: 5.5 },
  SG: { name: 'Singapore', zoom: 8 },
  TH: { name: 'Thailand', zoom: 5.5 },
  CL: { name: 'Chile', zoom: 5 },
  CO: { name: 'Colombia', zoom: 5 },
  PE: { name: 'Peru', zoom: 5 },
  AR: { name: 'Argentina', zoom: 4.5 },
  ES: { name: 'Spain', zoom: 5 },
  DE: { name: 'Germany', zoom: 5.2 },
  FR: { name: 'France', zoom: 5 },
  CA: { name: 'Canada', zoom: 3.5 },
  NG: { name: 'Nigeria', zoom: 5 },
  AE: { name: 'UAE', zoom: 6.5 },
  PK: { name: 'Pakistan', zoom: 5 },
  JP: { name: 'Japan', zoom: 5 },
  KR: { name: 'South Korea', zoom: 6 },
  TR: { name: 'Turkey', zoom: 5 },
  IT: { name: 'Italy', zoom: 5 },
  NL: { name: 'Netherlands', zoom: 6.5 },
  SE: { name: 'Sweden', zoom: 4.5 },
};

export const flag = (cc) =>
  cc && cc.length === 2
    ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)))
    : '🏳️';

export const countryName = (cc) => COUNTRIES[cc]?.name || cc;
export const countryZoom = (cc) => COUNTRIES[cc]?.zoom || 4.5;

// Great-circle distance in km
export function distanceKm([lng1, lat1], [lng2, lat2]) {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
