import { useEffect, useState } from 'react';
import {
  accessToken, canQueue, canStream, isLoggedIn, pausePlayback, playback, resumePlayback, transferTo,
  findTrackUri, playUris, setDeviceVolume, listDevices, seekTo as seekToApi,
} from './spotify.js';
import { sleep } from './ticker.js'; // keeps fades on time in background tabs

// 1) "Play here": this page becomes a Spotify device (Web Playback SDK, Premium),
//    so your own Spotify plays inside Listener Atlas.
// 2) Auto-pause: when the app plays a preview, transition or effect, your Spotify
//    pauses, then picks up again when the app goes quiet.

let player = null;
let state = { ready: false, deviceId: null, active: false, paused: true, track: null, error: '', loading: false };
const subs = new Set();
const emit = (patch) => {
  state = { ...state, ...patch };
  subs.forEach((fn) => fn(state));
};

function loadSdk() {
  if (window.Spotify) return Promise.resolve();
  return new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.onerror = () => reject(new Error("Couldn't load Spotify's player"));
    document.head.appendChild(s);
  });
}

async function connect() {
  if (player) return player;
  await loadSdk();
  player = new window.Spotify.Player({
    name: 'Listener Atlas',
    volume: 0.8,
    getOAuthToken: (cb) => accessToken().then(cb, () => cb('')),
  });
  player.addListener('ready', ({ device_id }) => emit({ ready: true, deviceId: device_id, error: '' }));
  player.addListener('not_ready', () => emit({ ready: false, active: false }));
  player.addListener('player_state_changed', (s) => {
    if (!s) return emit({ active: false });
    const t = s.track_window?.current_track;
    emit({
      active: true,
      paused: s.paused,
      track: t ? { name: t.name, artists: t.artists.map((a) => a.name).join(', '), cover: t.album?.images?.[0]?.url } : null,
    });
  });
  const fail = (msg) => ({ message }) => emit({ error: `${msg}: ${message}`, loading: false });
  player.addListener('initialization_error', fail("This browser can't play Spotify"));
  player.addListener('authentication_error', fail('Reconnect Spotify'));
  player.addListener('account_error', fail('Spotify Premium is needed'));
  player.addListener('playback_error', fail('Playback problem'));
  await player.connect();
  return player;
}

const waitReady = () =>
  new Promise((resolve, reject) => {
    if (state.deviceId) return resolve(state.deviceId);
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (state.deviceId) {
        clearInterval(iv);
        resolve(state.deviceId);
      } else if (state.error || Date.now() - t0 > 12000) {
        clearInterval(iv);
        reject(new Error(state.error || "Spotify's player didn't start. Try again."));
      }
    }, 200);
  });

// Move your Spotify playback into this page (must be called from a click)
export async function playHere() {
  if (!canStream()) throw new Error('Reconnect Spotify to allow playing here');
  emit({ loading: true, error: '' });
  try {
    const p = await connect();
    await p.activateElement?.(); // lets the browser play sound
    const id = await waitReady();
    // Spotify needs a moment to see the new device: retry a few times
    for (let i = 0; ; i++) {
      try {
        await transferTo(id, true);
        break;
      } catch (e) {
        if (i >= 4) throw new Error("Spotify didn't see Listener Atlas yet. Wait a few seconds and press Play here again.");
        await sleep(1200);
      }
    }
    emit({ loading: false });
  } catch (e) {
    emit({ loading: false, error: e.message });
    throw e;
  }
}

export const togglePlayHere = () => player?.togglePlay();
// jump to a point in the song (the in-page player can do it instantly)
export async function seekHere(ms) {
  if (player && state.active) return player.seek(Math.max(0, Math.round(ms)));
  return seekToApi(ms);
}

// Find somewhere to play: the active device, else any open Spotify app
// (even idle), else start the player inside this page.
export async function ensureDevice() {
  const pb = await playback().catch(() => null);
  if (pb?.device?.id) return pb.device.id;
  const devices = await listDevices().catch(() => []);
  const usable = devices.filter((d) => d.id && !d.is_restricted);
  const pick =
    usable.find((d) => d.is_active) ||
    usable.find((d) => d.id === state.deviceId) ||
    usable.find((d) => d.type === 'Computer') ||
    usable[0];
  if (pick) return pick.id;
  if (canStream()) {
    const p = await connect();
    await p.activateElement?.();
    return waitReady();
  }
  throw new Error('No Spotify device is on. Open Spotify on your Mac or phone, or reconnect to allow ⇣ Play here.');
}

export function useSpotifyPlayer() {
  const [s, set] = useState(state);
  useEffect(() => {
    subs.add(set);
    return () => subs.delete(set);
  }, []);
  return s;
}

// ---------- smooth transition on your real Spotify ----------

// Smooth S-curve volume fade. The in-page player can do many small steps;
// other devices go through Spotify's API, so fewer, bigger steps.
export async function fadeVolume(from, to, ms, deviceId, inPage) {
  const steps = Math.max(2, inPage ? Math.round(ms / 60) : Math.round(ms / 650));
  for (let i = 1; i <= steps; i++) {
    const x = i / steps;
    const v = from + (to - from) * ((1 - Math.cos(Math.PI * x)) / 2);
    try {
      if (inPage) await player.setVolume(Math.max(0, Math.min(1, v / 100)));
      else await setDeviceVolume(v, deviceId);
    } catch {
      return false; // device doesn't allow volume control: just switch
    }
    await sleep(ms / steps);
  }
  return true;
}
const fade = fadeVolume;

// Where your Spotify is right now (song, position, volume, device)
export async function currentPlayback() {
  if (player && state.active) {
    const s = await player.getCurrentState().catch(() => null);
    if (s?.track_window?.current_track) {
      const t = s.track_window.current_track;
      const v = await player.getVolume().catch(() => 0.8);
      return {
        uri: t.uri,
        linked: t.linked_from?.uri || null,
        name: t.name,
        artist: (t.artists || []).map((a) => a.name).join(', '),
        positionMs: s.position,
        durationMs: s.duration,
        isPlaying: !s.paused,
        deviceId: state.deviceId,
        volume: Math.round(v * 100),
        supportsVolume: true,
        inPage: true,
      };
    }
  }
  const pb = await playback().catch(() => null);
  if (!pb?.item) return null;
  return {
    uri: pb.item.uri,
    linked: pb.item.linked_from?.uri || null,
    name: pb.item.name,
    artist: (pb.item.artists || []).map((a) => a.name).join(', '),
    positionMs: pb.progress_ms,
    durationMs: pb.item.duration_ms,
    isPlaying: pb.is_playing,
    deviceId: pb.device?.id,
    volume: pb.device?.volume_percent ?? 80,
    supportsVolume: pb.device?.supports_volume !== false,
    inPage: false,
  };
}

// Fade your current song down, start the next one, fade it back up.
// (Spotify only plays one song at a time, so this is a quick fade, not an overlap.)
export async function mixOnSpotify(title, artist, onStep = () => {}, knownUri = null) {
  pausedDevice = null; // we're driving Spotify ourselves now, don't auto-resume
  onStep('Finding it on Spotify…');
  const { uri, name } = knownUri ? { uri: knownUri, name: title } : await findTrackUri(title, artist);
  let pb = await playback().catch(() => null);
  if (!pb?.device) pb = { device: { id: await ensureDevice(), volume_percent: 80 }, is_playing: false };
  const dev = pb.device;
  const inPage = dev.id === state.deviceId && !!player;
  const vol = dev.volume_percent ?? 80;
  const low = Math.round(vol * 0.2);
  const canFade = pb.is_playing && (inPage || dev.supports_volume !== false);
  if (canFade) {
    onStep('Fading out…');
    await fade(vol, low, 3500, dev.id, inPage);
  }
  onStep(`Starting ${name}…`);
  await playUris([uri], { deviceId: dev.id });
  if (canFade) {
    await sleep(350);
    onStep('Fading in…');
    await fade(low, vol, 3000, dev.id, inPage);
  }
  onStep('');
  return name;
}

// Play a list of songs on Spotify, in this order, starting now
export async function playListOnSpotify(songs, onStep = () => {}) {
  pausedDevice = null;
  const uris = [];
  for (const [i, s] of songs.entries()) {
    onStep(`Finding ${i + 1} of ${songs.length}…`);
    try {
      uris.push(s.uri || (await findTrackUri(s.title, s.artist)).uri);
    } catch {
      /* skip songs Spotify doesn't have */
    }
  }
  if (!uris.length) throw new Error('None of these songs were found on Spotify');
  await playUris(uris, { deviceId: await ensureDevice() });
  onStep('');
  return uris.length;
}

// ---------- auto-pause while the app plays its own audio ----------
const AUTO_KEY = 'autoPauseSpotify';
export function autoPauseOn() {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setAutoPause(on) {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0');
  } catch {}
}

const sources = new Set();
let pausedDevice = null; // device we paused, so we resume the right one
let busy = Promise.resolve();
let resumeTimer = null;

export function setAppAudio(source, playing) {
  if (playing) sources.add(source);
  else sources.delete(source);
  if (!isLoggedIn() || !canQueue() || !autoPauseOn()) return;
  clearTimeout(resumeTimer);
  if (sources.size) {
    busy = busy.then(async () => {
      if (pausedDevice || !sources.size) return;
      const pb = await playback().catch(() => null);
      if (pb?.is_playing && pb.device?.id) {
        pausedDevice = pb.device.id;
        await pausePlayback(pb.device.id).catch(() => (pausedDevice = null));
      }
    });
  } else {
    // wait a moment, the app may be switching between previews
    resumeTimer = setTimeout(() => {
      busy = busy.then(async () => {
        if (!pausedDevice || sources.size) return;
        const id = pausedDevice;
        pausedDevice = null;
        await resumePlayback(id).catch(() => {});
      });
    }, 1500);
  }
}
