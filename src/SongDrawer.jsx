import React, { useEffect, useState } from 'react';
import { flag } from './countries.js';

const fmt = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);

// "Who's listening to this song?" — the closest public signals Spotify & friends allow.
export default function SongDrawer({ track, findArtist, fetchArtist, onArtist, onShowArtist, onCity, onChartPins, onClose }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState({}); // name -> artist | {error}

  useEffect(() => {
    if (!track) return;
    setInfo(null);
    setFetched({});
    setLoading(true);
    const qs = new URLSearchParams({ title: track.name, artists: track.artists.map((a) => a.name).join('|') });
    fetch(`/api/song-insights?${qs}`)
      .then(async (r) => {
        if (!r.headers.get('content-type')?.includes('json')) throw new Error('Data server not running the new code');
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setInfo(j);
        if (j.charts?.charts?.length) onChartPins(j.charts.charts);
      })
      .catch((e) => setInfo({ error: e.message }))
      .finally(() => setLoading(false));
  }, [track?.id]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!track) return null;
  const year = track.releaseDate?.slice(0, 4);

  async function getStats(name) {
    setFetched((f) => ({ ...f, [name]: { loading: true } }));
    try {
      const a = await fetchArtist(name);
      setFetched((f) => ({ ...f, [name]: a }));
    } catch (e) {
      setFetched((f) => ({ ...f, [name]: { error: e.message } }));
    }
  }

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="d-banner song" style={{ backgroundImage: track.cover ? `url(${track.cover})` : undefined }}>
          <div className="d-banner-fade" />
          <div className="d-title song-title">
            {track.cover && <img src={track.cover} alt="" />}
            <div>
              <div className="verified">Song</div>
              <h2>{track.name}</h2>
              <div className="d-ml">
                {track.artists.map((a, i) => (
                  <React.Fragment key={a.id || a.name}>
                    {i > 0 && ', '}
                    <button className="tr-artist big" onClick={() => onArtist({ name: a.name })}>
                      {a.name}
                    </button>
                  </React.Fragment>
                ))}
                {track.album && ` · ${track.album}`}
                {year && ` · ${year}`}
              </div>
            </div>
          </div>
        </div>

        <div className="d-body">
          <div className="d-actions">
            {track.url && (
              <a className="btn-green" href={track.url} target="_blank" rel="noreferrer">
                Open in Spotify
              </a>
            )}
          </div>

          <p className="note">
            Spotify doesn't share who is listening to a song, or live counts per song. Below are the closest public
            signals: each artist's monthly listeners and top cities, the city charts the song is in right now, and
            open listening data from ListenBrainz.
          </p>

          {/* Artists: monthly listeners + where they're listened to */}
          <section>
            <h3>Listeners by artist</h3>
            {track.artists.map((a) => {
              const known = findArtist(a.name) || (fetched[a.name]?.id ? fetched[a.name] : null);
              const f = fetched[a.name];
              return (
                <div key={a.id || a.name} className="sd-artist">
                  <div className="sd-artist-head">
                    {known?.image ? <img src={known.image} alt="" /> : <span className="av" />}
                    <div>
                      <button className="tr-artist big" onClick={() => onArtist(known || { name: a.name })}>
                        {a.name}
                      </button>
                      {known ? (
                        <div className="muted">
                          <b className="green">{fmt(known.listeners)}</b> monthly listeners
                          {known.worldRank ? ` · #${known.worldRank} in the world` : ''}
                        </div>
                      ) : (
                        <div className="muted">Not in your artist list yet</div>
                      )}
                    </div>
                  </div>
                  {known?.cities?.length > 0 && (
                    <>
                      <div className="chips">
                        {known.cities.map((c) => (
                          <button key={c.city} className="chip" onClick={() => onCity(c)}>
                            {flag(c.country)} {c.city} <b>{fmt(c.listeners)}</b>
                          </button>
                        ))}
                      </div>
                      <button className="link-btn" onClick={() => onShowArtist(known)}>
                        Show {a.name}'s listeners on the globe ›
                      </button>
                    </>
                  )}
                  {!known && (
                    <>
                      <button className="btn-ghost sm" disabled={f?.loading} onClick={() => getStats(a.name)}>
                        {f?.loading ? 'Fetching from Spotify…' : 'Get Spotify listener stats'}
                      </button>
                      {f?.error && <div className="status err">{f.error}</div>}
                    </>
                  )}
                </div>
              );
            })}
          </section>

          {/* City charts */}
          <section>
            <h3>Where it's charting right now</h3>
            {loading && <div className="status loading">Checking the Top 25 charts of 20 big cities…</div>}
            {info?.error && <div className="status err">{info.error}</div>}
            {info?.charts && info.charts.charts.length === 0 && (
              <div className="muted">Not in the Top 25 of any of the {info.charts.scanned} big cities we checked.</div>
            )}
            {info?.charts?.charts?.length > 0 && (
              <ul className="d-cities">
                {info.charts.charts.map((c) => (
                  <li key={c.city} className="clickable" onClick={() => onCity(c)}>
                    <span>
                      {flag(c.country)} <b>{c.city}</b>
                    </span>
                    <span className="rank-pill">#{c.rank}</span>
                  </li>
                ))}
              </ul>
            )}
            {info?.charts && !info.complete && (
              <div className="foot">Checked {info.charts.scanned} of 20 cities in time. Open this again in a minute for the rest.</div>
            )}
            {info?.charts && <div className="foot">Apple Music city charts, updated daily. Gold pins on the globe.</div>}
          </section>

          {/* ListenBrainz */}
          <section>
            <h3>Open listening data</h3>
            {loading && <div className="status loading">Asking ListenBrainz…</div>}
            {info && !info.error && !info.listens && <div className="muted">ListenBrainz is busy right now. Try again later.</div>}
            {info?.listens && (
              <div className="d-stats two">
                <div>
                  <b>{info.listens.listens.toLocaleString('en-US')}</b>
                  <span>plays tracked</span>
                </div>
                <div>
                  <b>{info.listens.listeners.toLocaleString('en-US')}</b>
                  <span>people who played it</span>
                </div>
              </div>
            )}
            <div className="foot">
              From ListenBrainz, an open-source service where people share their listening history. A small sample, not
              all of Spotify.
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
