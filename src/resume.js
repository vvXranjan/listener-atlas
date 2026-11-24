// Pick up where you left off: when Listener Atlas opens, start your last Spotify song again.
import { playback, listDevices, playUris, resumePlayback, recentPlays, isLoggedIn, canQueue } from './spotify.js';
import { ensureDevice } from './spotifyPlayer.js';
import { onNow } from './nowStore.js';

const KEY = 'last-spotify-song-v1';
const PREF = 'resume-on-open';

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
};
export const resumeOn = () => {
  try {
    return localStorage.getItem(PREF) !== '0';
  } catch {
    return true;
  }
};
export const setResumeOn = (v) => {
  try {
    localStorage.setItem(PREF, v ? '1' : '0');
  } catch {}
};

// Keep a note of the song and where it was (updated with every look at Spotify)
export function rememberLastSong() {
  return onNow((n) => {
    if (!n.track?.id) return;
    const positionMs = n.progressMs + (n.playing ? Date.now() - n.fetchedAt : 0);
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ uri: `spotify:track:${n.track.id}`, title: n.track.name, positionMs, durationMs: n.track.durationMs || 0, at: Date.now() })
      );
    } catch {}
  });
}

// Where to start: a little before where you were (or the start, if it was nearly over)
export function startAt(last) {
  if (!last?.positionMs) return 0;
  if (last.durationMs && last.positionMs > last.durationMs - 8000) return 0;
  return Math.max(0, last.positionMs - 2000);
}

let tried = false;
// Returns what it did: 'off' | 'already' | 'resumed' | 'played' | 'waiting' | 'nothing'
export async function resumeOnOpen({ onNeedTap } = {}) {
  if (tried) return 'already';
  if (!resumeOn()) return 'off';
  if (!isLoggedIn() || !canQueue()) return 'nothing';
  tried = true;

  const pb = await playback().catch(() => null);
  if (pb?.is_playing) return 'already'; // music is on: leave it alone
  // Spotify is open somewhere with the song paused: just press play there
  if (pb?.device?.id && !pb.device.is_restricted && pb.item && pb.device.name !== 'Listener Atlas') {
    await resumePlayback(pb.device.id);
    return 'resumed';
  }

  const last = read();
  let uri = last?.uri;
  let positionMs = startAt(last);
  if (!uri) {
    uri = (await recentPlays().catch(() => []))[0]?.uri;
    positionMs = 0;
  }
  if (!uri) return 'nothing';

  // an open Spotify app (Mac first, then phone, then anything)
  const devices = (await listDevices().catch(() => [])).filter((d) => d.id && !d.is_restricted && d.name !== 'Listener Atlas');
  const pick = devices.find((d) => d.is_active) || devices.find((d) => d.type === 'Computer') || devices.find((d) => d.type === 'Smartphone') || devices[0];
  if (pick) {
    await playUris([uri], { deviceId: pick.id, positionMs });
    return 'played';
  }

  // No Spotify app open anywhere: play in this tab. Browsers only allow sound after you
  // touch the page, so we wait for your first click or key press.
  onNeedTap?.(last?.title || 'your last song');
  const events = ['pointerdown', 'keydown'];
  const go = async () => {
    events.forEach((e) => window.removeEventListener(e, go, true));
    try {
      const id = await ensureDevice();
      await playUris([uri], { deviceId: id, positionMs });
    } catch {
      /* Spotify said no: nothing more to do */
    }
    onNeedTap?.(null);
  };
  events.forEach((e) => window.addEventListener(e, go, true));
  return 'waiting';
}
