import React, { useEffect, useState } from 'react';
import { togglePreview, usePlaying } from './player.js';
import { canQueue, queueSong, isLoggedIn, logout, login } from './spotify.js';

// "Up next for you": 4 songs real listeners play in the same session as this one.
export default function UpNext({ track, onArtist }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [queued, setQueued] = useState({}); // title -> 'ok' | 'busy' | error text
  const playing = usePlaying();

  useEffect(() => {
    if (!track) return;
    setData(null);
    setQueued({});
    setLoading(true);
    const qs = new URLSearchParams({ title: track.name, artists: track.artists.map((a) => a.name).join('|') });
    fetch(`/api/recommend?${qs}`)
      .then(async (r) => {
        if (!r.headers.get('content-type')?.includes('json')) throw new Error('Data server not running the new code');
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setData(j);
      })
      .catch((e) => setData({ error: e.message }))
      .finally(() => setLoading(false));
  }, [track?.id, track?.name]);

  async function addToQueue(p) {
    setQueued((q) => ({ ...q, [p.title]: 'busy' }));
    try {
      await queueSong(p.title, p.artist);
      setQueued((q) => ({ ...q, [p.title]: 'ok' }));
    } catch (e) {
      setQueued((q) => ({ ...q, [p.title]: e.message }));
    }
  }

  const loggedIn = isLoggedIn();
  const queueReady = loggedIn && canQueue();

  return (
    <section className="upnext">
      <h3>
        <span className="spark">✦</span> Up next for you
      </h3>
      <div className="muted un-sub">
        {data?.engine === 'claude'
          ? 'Chosen by AI from what real listeners play in the same session.'
          : 'Picked from what real listeners play in the same session.'}
      </div>

      {loading && (
        <div className="un-loading">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="un-skel" />
          ))}
        </div>
      )}
      {data?.error && <div className="status err">{data.error}</div>}
      {data?.note && <div className="muted">{data.note}</div>}

      {data?.picks?.length > 0 && (
        <ol className="un-list">
          {data.picks.map((p, i) => {
            const q = queued[p.title];
            return (
              <li key={p.title + p.artist} className={playing && playing === p.preview ? 'on' : ''}>
                <span className="un-rank">{i + 1}</span>
                <button
                  className="un-cover"
                  disabled={!p.preview}
                  onClick={() => togglePreview(p.preview)}
                  title={p.preview ? 'Play 30s preview' : 'No preview'}
                >
                  {p.cover ? <img src={p.cover} alt="" /> : <div className="ph" />}
                  {p.preview && <span className="tr-play">{playing === p.preview ? '❚❚' : '▶'}</span>}
                </button>
                <div className="un-body">
                  <div className="un-title">{p.title}</div>
                  <button className="tr-artist" onClick={() => onArtist({ name: p.artist.split(/,|&| with /)[0].trim() })}>
                    {p.artist}
                  </button>
                  <div className="un-why">{p.why}</div>
                  <div className="un-meta">
                    {p.tags?.map((t) => (
                      <span key={t} className="un-tag">
                        {t}
                      </span>
                    ))}
                    <span className="un-match" title={`Played together — recent ${p.signals.recent}, long-term ${p.signals.longTerm}`}>
                      <span className="un-bar">
                        <span style={{ width: `${p.match}%` }} />
                      </span>
                      {p.match}% match
                    </span>
                  </div>
                  <div className="un-actions">
                    {queueReady && (
                      <button className="btn-green sm" disabled={q === 'busy' || q === 'ok'} onClick={() => addToQueue(p)}>
                        {q === 'ok' ? '✓ In your queue' : q === 'busy' ? 'Adding…' : '+ Add to queue'}
                      </button>
                    )}
                    <a className="btn-ghost sm" href={p.spotifySearch} target="_blank" rel="noreferrer">
                      Find on Spotify
                    </a>
                  </div>
                  {q && q !== 'ok' && q !== 'busy' && <div className="status err">{q}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {loggedIn && !canQueue() && data?.picks?.length > 0 && (
        <button
          className="link-btn"
          onClick={async () => {
            logout();
            await login();
          }}
        >
          Reconnect Spotify to add picks straight to your queue ›
        </button>
      )}
      {data?.candidates > 0 && (
        <div className="foot">
          Ranked from {data.candidates} songs that ListenBrainz users play alongside this one (last 6 months + long-term).
        </div>
      )}
    </section>
  );
}
