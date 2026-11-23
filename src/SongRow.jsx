import { useState } from 'react';
import { togglePreview, usePlaying } from './player.js';
import { addToSet, songId } from './setStore.js';
import { isLoggedIn, canQueue, findTrackUri, playUris, playback } from './spotify.js';
import { ensureDevice } from './spotifyPlayer.js';
import { firstArtist } from './mixParts.jsx';
import ArtistLink from './ArtistLink.jsx';

const mmss = (ms) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : '');

// Play one song on your Spotify (the device that's on, or this tab)
export async function playOnSpotify(s) {
  const uri = s.uri || (await findTrackUri(s.title, firstArtist(s.artist))).uri;
  const pb = await playback().catch(() => null);
  const deviceId = pb?.device?.id || (await ensureDevice());
  await playUris([uri], { deviceId });
}

// One song: ▶ preview · title · artist · play on Spotify · + Set · ⇄ Mix Lab
export default function SongRow({ s, rank, inSet, onMixLab, meta, compact }) {
  const playing = usePlaying();
  const [msg, setMsg] = useState('');
  const added = inSet?.has(songId(s));
  const on = s.preview && playing === s.preview;
  const spotifyOk = isLoggedIn() && canQueue();
  async function play() {
    setMsg('…');
    try {
      await playOnSpotify(s);
      setMsg('▶ on Spotify');
    } catch (e) {
      setMsg(e.message.slice(0, 40));
    }
    setTimeout(() => setMsg(''), 2500);
  }
  return (
    <div className={`gn-row ${compact ? 'compact' : ''}`}>
      {rank != null && <span className="gn-rank">{rank}</span>}
      <button className="gn-cover" disabled={!s.preview} onClick={() => togglePreview(s.preview)} title={s.preview ? 'Play a 30 s preview' : 'No preview'}>
        {s.cover ? <img src={s.cover} alt="" loading="lazy" /> : <span className="ph" />}
        {s.preview && <span className="tr-play">{on ? '❚❚' : '▶'}</span>}
      </button>
      <div className="gn-body">
        <div className="un-title">
          {s.title}
          {s.explicit && <span className="ex-badge">E</span>}
        </div>
        <div className="tr-artist">
          <ArtistLink name={s.artist} />
          {meta !== false && (s.album || s.durationMs) && <span className="muted"> · {meta || [s.album, mmss(s.durationMs)].filter(Boolean).join(' · ')}</span>}
        </div>
        {msg && <div className="muted sr-msg">{msg}</div>}
      </div>
      <div className="gn-acts">
        {spotifyOk && (
          <button className="gx-fxbtn" title="Play on your Spotify" onClick={play}>
            ▶
          </button>
        )}
        {onMixLab && (
          <button className="gx-fxbtn" title="Best songs to play after this one" onClick={() => onMixLab({ id: `${s.title}|${s.artist}`, name: s.title, artists: [{ name: firstArtist(s.artist) }], cover: s.cover })}>
            ⇄
          </button>
        )}
        <button
          className={`gx-fxbtn ${added ? 'on' : ''}`}
          disabled={added}
          onClick={() => addToSet({ title: s.title, artist: s.artist, cover: s.cover, preview: /apple\.com|mzstatic/.test(s.preview || '') ? s.preview : null, uri: s.uri || null })}
        >
          {added ? '✓' : '+ Set'}
        </button>
      </div>
    </div>
  );
}
