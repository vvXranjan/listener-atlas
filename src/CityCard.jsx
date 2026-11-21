import React from 'react';
import { flag } from './countries.js';
import { togglePreview, usePlaying } from './player.js';

const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n));
const time = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');

// "What is <city> listening to?" — Apple Music city chart + Spotify artists strong here
export default function CityCard({ state, moves, spotifyHere, onClose, onArtist }) {
  const playing = usePlaying();
  if (!state) return null;
  const { loading, error, data } = state;

  return (
    <div className="inview city-card">
      <button className="x" onClick={onClose} aria-label="Close">
        ×
      </button>

      {loading && !data && <div className="status loading">Loading what {state.name} is listening to…</div>}
      {error && <div className="status err">{error}</div>}

      {data && (
        <>
          <div className="iv-head">
            <span className="iv-flag">{flag(data.country)}</span>
            <div>
              <div className="iv-label">
                <span className="live-dot" /> Live · checked {time(data.fetchedAt)}
              </div>
              <div className="iv-name">{data.city}</div>
              <div className="muted">{data.countryName}</div>
            </div>
          </div>

          <div className="chart-src">
            {data.scope === 'city' ? (
              <>What people in {data.city} are playing most right now</>
            ) : (
              <>No city chart for {data.city} — showing the {data.scope === 'country' ? data.countryName : 'global'} chart</>
            )}
            <a href={data.chart.url} target="_blank" rel="noreferrer">
              {data.chart.title} ↗
            </a>
          </div>

          {data.topArtists?.length > 0 && (
            <div className="chips">
              {data.topArtists.map((a) => (
                <button key={a.name} className="chip" onClick={() => onArtist({ name: a.name })}>
                  {a.name} <b>{a.songs}</b>
                </button>
              ))}
            </div>
          )}

          {spotifyHere?.length > 0 && (
            <>
              <h3>Spotify top-city fans here</h3>
              <div className="chips">
                {spotifyHere.map((s) => (
                  <button key={s.name} className="chip" onClick={() => onArtist(s.artist)}>
                    {s.name} <b>{fmt(s.listeners)}</b>
                  </button>
                ))}
              </div>
            </>
          )}

          <h3>Top songs</h3>
          <ol className="tracks">
            {data.chart.tracks.slice(0, 50).map((t) => {
              const mv = moves?.[t.id];
              return (
                <li key={t.id || t.rank} className={playing && playing === t.preview ? 'on' : ''}>
                  <span className="tr-rank">{t.rank}</span>
                  <span className={`tr-move ${mv > 0 ? 'up' : mv < 0 ? 'down' : mv === 'new' ? 'new' : ''}`}>
                    {mv === 'new' ? 'NEW' : mv > 0 ? `▲${mv}` : mv < 0 ? `▼${-mv}` : ''}
                  </span>
                  <button
                    className="tr-art"
                    disabled={!t.preview}
                    onClick={() => togglePreview(t.preview)}
                    title={t.preview ? 'Play 30s preview' : 'No preview'}
                  >
                    {t.artwork && <img src={t.artwork} alt="" />}
                    {t.preview && <span className="tr-play">{playing === t.preview ? '❚❚' : '▶'}</span>}
                  </button>
                  <span className="tr-text">
                    <span className="tr-title">
                      {t.title}
                      {t.explicit && <span className="e">E</span>}
                    </span>
                    <button className="tr-artist" onClick={() => onArtist({ name: t.artist.split(/,|&/)[0].trim() })}>
                      {t.artist}
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="foot">Source: {data.source}. Previews from iTunes.</p>
        </>
      )}
    </div>
  );
}
