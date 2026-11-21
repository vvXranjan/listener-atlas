// Spotify login (PKCE, no secret needed) + "what am I playing right now".
// Needs a free Spotify developer app (Premium account) — see README.

// streaming + email/private are needed to play Spotify inside this page (Web Playback SDK)
// library scopes power the Library popup (liked songs, playlists, top + recent)
const SCOPES = [
  'user-read-currently-playing user-read-playback-state user-modify-playback-state',
  'streaming user-read-email user-read-private',
  'user-library-read playlist-read-private user-top-read user-read-recently-played',
].join(' ');
const KEY = 'spotifyAuth';

export function getClientId() {
  try {
    return import.meta.env.VITE_SPOTIFY_CLIENT_ID || localStorage.getItem('spotifyClientId') || '';
  } catch {
    return import.meta.env.VITE_SPOTIFY_CLIENT_ID || '';
  }
}

export function saveClientId(id) {
  try {
    localStorage.setItem('spotifyClientId', id.trim());
  } catch {}
}

// Spotify only accepts 127.0.0.1 (not "localhost") for local apps; online it uses your site's address
const isLocal = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

export const redirectUri = () =>
  isLocal() ? `http://127.0.0.1:${location.port || 5173}/callback` : `${location.origin}/callback`;

export function onRightHost() {
  return location.hostname !== 'localhost';
}

export function moveToRightHost() {
  location.replace(`http://127.0.0.1:${location.port || 5173}${location.pathname}${location.search}`);
}

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export async function login() {
  const clientId = getClientId();
  if (!clientId) throw new Error('Add your Spotify Client ID first');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem('spotifyVerifier', verifier);
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  location.assign(`https://accounts.spotify.com/authorize?${qs}`);
}

function saveTokens(j) {
  const prev = load();
  const auth = {
    access: j.access_token,
    refresh: j.refresh_token || prev?.refresh,
    expiresAt: Date.now() + (j.expires_in - 60) * 1000,
    scope: j.scope || prev?.scope || '',
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(auth));
  } catch {}
  return auth;
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

export function isLoggedIn() {
  return !!load()?.refresh;
}

export function logout() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

// Called once on page load: finishes the login if Spotify sent us back with a code
export async function handleCallback() {
  if (location.pathname !== '/callback') return null;
  const params = new URLSearchParams(location.search);
  history.replaceState(null, '', '/');
  if (params.get('error')) throw new Error(`Spotify login cancelled (${params.get('error')})`);
  const code = params.get('code');
  const verifier = sessionStorage.getItem('spotifyVerifier');
  if (!code || !verifier) return null;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: getClientId(),
      code_verifier: verifier,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || 'Spotify login failed');
  sessionStorage.removeItem('spotifyVerifier');
  return saveTokens(j);
}

async function token() {
  const auth = load();
  if (!auth) return null;
  if (Date.now() < auth.expiresAt) return auth.access;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: getClientId() }),
  });
  const j = await r.json();
  if (!r.ok) {
    logout();
    throw new Error('Spotify session expired — connect again');
  }
  return saveTokens(j).access;
}

// What's playing on any of your Spotify devices right now
export async function currentlyPlaying() {
  const t = await token();
  if (!t) return null;
  const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing?additional_types=track', {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (r.status === 204) return { playing: false };
  if (r.status === 401) {
    logout();
    throw new Error('Spotify session expired — connect again');
  }
  if (r.status === 403) throw new Error('Spotify refused access. Is your account added under "User Management" in your app?');
  if (!r.ok) throw new Error(`Spotify error ${r.status}`);
  const j = await r.json();
  const it = j.item;
  if (!it || j.currently_playing_type !== 'track') return { playing: false };
  return {
    playing: j.is_playing,
    progressMs: j.progress_ms,
    fetchedAt: Date.now(),
    track: {
      id: it.id,
      name: it.name,
      durationMs: it.duration_ms,
      explicit: it.explicit,
      url: it.external_urls?.spotify,
      artists: it.artists.map((a) => ({ id: a.id, name: a.name })),
      album: it.album?.name,
      releaseDate: it.album?.release_date,
      cover: it.album?.images?.[0]?.url,
    },
  };
}

// Can we add songs to the queue? (needs the newer permission; older logins must reconnect)
export function canQueue() {
  return (load()?.scope || '').includes('user-modify-playback-state');
}

export async function accessToken() {
  return token();
}

// Can this login play music inside the page? (needs the newer "streaming" permission)
export function canStream() {
  return (load()?.scope || '').includes('streaming');
}

async function api(path, { method = 'GET', body } = {}, attempt = 0) {
  const t = await token();
  if (!t) throw new Error('Connect Spotify first');
  let r;
  try {
    r = await fetch(`https://api.spotify.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    if (attempt < 1) return api(path, { method, body }, attempt + 1);
    throw new Error("Can't reach Spotify. Check your internet.");
  }
  // too many requests or a Spotify hiccup: wait as asked, then try once more
  if ((r.status === 429 || r.status >= 500) && attempt < 1) {
    const wait = Math.min(5, Number(r.headers.get('Retry-After')) || 1);
    await new Promise((res) => setTimeout(res, wait * 1000));
    return api(path, { method, body }, attempt + 1);
  }
  if (r.status === 429) throw new Error('Spotify is busy. Try again in a few seconds.');
  if (r.status === 404) {
    const e = new Error('No Spotify device is on. Open Spotify on your Mac or phone, or press ⇣ Play here.');
    e.noDevice = true;
    throw e;
  }
  if (r.status === 401) throw new Error('Spotify session expired — connect again');
  if (r.status === 403) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error?.reason === 'PREMIUM_REQUIRED' ? 'Spotify Premium is needed for this' : 'Reconnect Spotify to allow playback control');
  }
  if (!r.ok) throw new Error(`Spotify error ${r.status}`);
  if (r.status === 204) return null;
  // some player endpoints reply with plain text (a snapshot id), not JSON
  const text = await r.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// Can this login read your library? (newer permission; older logins must reconnect)
export function canLibrary() {
  return (load()?.scope || '').includes('user-library-read');
}

const mapTrack = (t) =>
  t && t.type !== 'episode' && t.name
    ? {
        title: t.name,
        artist: (t.artists || []).map((a) => a.name).join(', '),
        album: t.album?.name || null,
        cover: t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || null,
        uri: t.uri,
        id: t.id,
        url: t.external_urls?.spotify,
        durationMs: t.duration_ms,
      }
    : null;
const page = (j, pick) => ({
  items: (j?.items || []).map(pick).filter(Boolean),
  total: j?.total ?? 0,
  more: !!j?.next,
});

export const likedSongs = async (offset = 0) => page(await api(`/me/tracks?limit=50&offset=${offset}`), (x) => mapTrack(x.track));
export const recentlyPlayed = async () => {
  const p = page(await api('/me/player/recently-played?limit=50'), (x) => mapTrack(x.track));
  const seen = new Set();
  p.items = p.items.filter((t) => !seen.has(t.uri) && seen.add(t.uri));
  p.more = false;
  return p;
};
export const topTracks = async (range = 'short_term') =>
  ({ ...page(await api(`/me/top/tracks?limit=50&time_range=${range}`), mapTrack), more: false });
export const myPlaylists = async (offset = 0) =>
  page(await api(`/me/playlists?limit=50&offset=${offset}`), (p) =>
    p ? { id: p.id, name: p.name, cover: p.images?.[0]?.url || null, count: p.items?.total ?? p.tracks?.total ?? null, owner: p.owner?.display_name } : null
  );
export async function playlistTracks(id, offset = 0) {
  // Spotify renamed "tracks" to "items" for playlists; try the new name first
  let j;
  try {
    j = await api(`/playlists/${id}/items?limit=50&offset=${offset}`);
  } catch {
    j = await api(`/playlists/${id}/tracks?limit=50&offset=${offset}`);
  }
  return page(j, (x) => mapTrack(x.item || x.track));
}
export const searchSpotify = async (q) => (await api(`/search?type=track&limit=10&q=${encodeURIComponent(q)}`))?.tracks?.items?.map(mapTrack).filter(Boolean) || [];
// What Spotify will play next (its real queue)
export async function getQueue() {
  const j = await api('/me/player/queue');
  return { current: mapTrack(j?.currently_playing), queue: (j?.queue || []).map(mapTrack).filter(Boolean) };
}
export const queueUri = (uri) => api(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: 'POST' });

const devQs = (id) => (id ? `?device_id=${encodeURIComponent(id)}` : '');

// Find the Spotify version of a song
export async function findTrackUri(title, artist) {
  const clean = title.replace(/\s*[([].*?[)\]]/g, '').trim();
  const main = artist.split(/,|&| with /)[0].trim();
  const q = encodeURIComponent(`track:${clean} artist:${main}`);
  let j = await api(`/search?type=track&limit=1&q=${q}`);
  let item = j?.tracks?.items?.[0];
  if (!item) {
    j = await api(`/search?type=track&limit=1&q=${encodeURIComponent(`${clean} ${main}`)}`);
    item = j?.tracks?.items?.[0];
  }
  if (!item) throw new Error('Not found on Spotify');
  return { uri: item.uri, name: item.name, artist: item.artists?.[0]?.name, url: item.external_urls?.spotify };
}

// Which device is playing, its volume, and whether music is on
export async function playback() {
  return api('/me/player');
}
// All your Spotify devices (open apps, speakers), even idle ones
export const listDevices = async () => (await api('/me/player/devices'))?.devices || [];
export const pausePlayback = (deviceId) => api(`/me/player/pause${devQs(deviceId)}`, { method: 'PUT' });
export const resumePlayback = (deviceId) => api(`/me/player/play${devQs(deviceId)}`, { method: 'PUT' });
export const seekTo = (ms, deviceId) => api(`/me/player/seek?position_ms=${Math.max(0, Math.round(ms))}${deviceId ? `&device_id=${deviceId}` : ''}`, { method: 'PUT' });
export const nextTrack = () => api('/me/player/next', { method: 'POST' });
export const previousTrack = () => api('/me/player/previous', { method: 'POST' });
export const setDeviceVolume = (pct, deviceId) =>
  api(`/me/player/volume?volume_percent=${Math.round(Math.max(0, Math.min(100, pct)))}${deviceId ? `&device_id=${deviceId}` : ''}`, { method: 'PUT' });
export const playUris = (uris, { deviceId, positionMs = 0 } = {}) =>
  api(`/me/player/play${devQs(deviceId)}`, { method: 'PUT', body: { uris, position_ms: positionMs } });
export const transferTo = (deviceId, play = true) => api('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play } });

// Find a song on Spotify and add it to your queue (Premium)
export async function queueSong(title, artist) {
  const item = await findTrackUri(title, artist);
  await api(`/me/player/queue?uri=${encodeURIComponent(item.uri)}`, { method: 'POST' });
  return item;
}
