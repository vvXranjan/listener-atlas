// Real-time features (free, open source, no keys):
//  - Live listens:  ListenBrainz (MetaBrainz Foundation, open source) global listen feed
//  - Song ID:       Shazam recognition, using the open-source shazamio-core fingerprinter (MIT)

import { randomUUID } from 'node:crypto';

// ---------- ListenBrainz: what people are playing right now ----------
let nowCache = { t: 0, v: null };

export async function getNowPlaying() {
  if (nowCache.v && Date.now() - nowCache.t < 8000) return nowCache.v;
  const r = await fetch('https://listenbrainz.org/recent/', { method: 'POST' });
  if (!r.ok) throw new Error(`ListenBrainz ${r.status}`);
  const j = await r.json();
  const v = {
    source: 'ListenBrainz (open source)',
    globalListenCount: j.globalListenCount ?? null,
    globalUserCount: j.globalUserCount ?? null,
    // usernames are dropped on purpose
    // only real "right now" plays (imports of old history are skipped)
    listens: (j.listens || []).filter((l) => l.listened_at && Date.now() / 1000 - l.listened_at < 3600).map((l) => ({
      at: l.listened_at ? new Date(l.listened_at * 1000).toISOString() : null,
      track: l.track_metadata?.track_name || '',
      artist: l.track_metadata?.artist_name || '',
      release: l.track_metadata?.release_name || '',
    })),
    fetchedAt: new Date().toISOString(),
  };
  nowCache = { t: Date.now(), v };
  return v;
}

// ---------- Shazam: identify a song from a short recording ----------
const SHAZAM_HEADERS = {
  'X-Shazam-Platform': 'IPHONE',
  'X-Shazam-AppVersion': '14.1.0',
  Accept: '*/*',
  'Content-Type': 'application/json',
  'Accept-Language': 'en',
  'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 5.0.2; VS980 4G Build/LRX22G)',
};
const SHAZAM_PARAMS =
  'sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3';

// audio: a WAV/MP3/OGG/FLAC file as a Buffer
export async function recognizeSong(audio, timezone = 'Asia/Kolkata') {
  // loaded on first use (WebAssembly fingerprinter)
  const mod = await import('shazamio-core');
  const recognizeBytes = mod.recognizeBytes || mod.default?.recognizeBytes;
  let sigs;
  try {
    sigs = recognizeBytes(new Uint8Array(audio), 0, Number.MAX_SAFE_INTEGER);
  } catch {
    throw new Error("Couldn't read the recording. Try again.");
  }
  if (!sigs?.length) {
    throw new Error('Recording too short or silent');
  }
  let match = null;
  try {
    // try a few fingerprints from the middle of the clip
    for (let i = Math.floor(sigs.length / 2), tries = 0; i < sigs.length && tries < 3; i += 2, tries++) {
      const url = `https://amp.shazam.com/discovery/v5/en/US/iphone/-/tag/${randomUUID().toUpperCase()}/${randomUUID().toUpperCase()}?${SHAZAM_PARAMS}`;
      const body = JSON.stringify({
        timezone,
        signature: { uri: sigs[i].uri, samplems: sigs[i].samplems },
        timestamp: Date.now(),
        context: {},
        geolocation: {},
      });
      const res = await fetch(url, { method: 'POST', headers: SHAZAM_HEADERS, body });
      if (!res.ok) throw new Error(`Shazam ${res.status}`);
      const j = await res.json();
      if (j.matches?.length && j.track) {
        match = j.track;
        break;
      }
    }
  } finally {
    for (const s of sigs) s.free();
  }
  if (!match) return { found: false };

  const song = match.sections?.find((s) => s.type === 'SONG');
  const meta = (name) => song?.metadata?.find((m) => m.title === name)?.text || null;
  const apple = match.hub?.options?.[0]?.actions?.find((a) => a.uri?.startsWith('https://'))?.uri || null;
  const spotify = match.hub?.providers?.find((p) => p.type === 'SPOTIFY')?.actions?.[0]?.uri || null;
  return {
    found: true,
    title: match.title,
    artist: match.subtitle,
    cover: match.images?.coverarthq || match.images?.coverart || null,
    background: match.images?.background || null,
    album: meta('Album'),
    year: meta('Released'),
    label: meta('Label'),
    genre: match.genres?.primary || null,
    shazamUrl: match.share?.href || match.url || null,
    appleUrl: apple,
    spotifyUri: spotify,
    preview: match.hub?.actions?.find((a) => a.type === 'uri' && a.uri?.includes('.m4a'))?.uri || null,
  };
}
