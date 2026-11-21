// Spotify login (PKCE, no secret needed) + "what am I playing right now".
// Needs a free Spotify developer app (Premium account) — see README.

const SCOPES = 'user-read-currently-playing user-read-playback-state';
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
