import React, { useEffect, useState } from 'react';
import { flag } from './countries.js';
import { togglePreview, usePlaying } from './player.js';

const fmt = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
const full = (n) => (n == null ? '—' : n.toLocaleString('en-US'));

// A Spotify-style artist page.
// Spotify numbers come from our data; the bio comes from Wikipedia; albums and
// songs from iTunes; the playable "Popular" list is Spotify's own embed.
export default function ArtistDrawer({ artist, onClose, onShowOnMap, onGalaxy }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const playing = usePlaying();

  useEffect(() => {
    if (!artist) return;
    setInfo(null);
    setLoading(true);
    fetch(`/api/artist-info?name=${encodeURIComponent(artist.name)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [artist?.name]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!artist) return null;
  const a = artist;
  const wiki = info?.wiki;
  const it = info?.itunes;
  const banner = a.header || wiki?.image || a.image;
  const bio = a.bio || wiki?.bio;
  const releases = a.releases?.length ? a.releases : it?.albums?.map((x) => ({ ...x, cover: x.artwork, date: x.date })) || [];

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="d-banner" style={{ backgroundImage: banner ? `url(${banner})` : undefined }}>
          <div className="d-banner-fade" />
          <div className="d-title">
            {a.verified !== false && a.id && <div className="verified">✓ Verified Artist</div>}
            <h2>{a.name}</h2>
            {a.listeners ? (
              <div className="d-ml">{full(a.listeners)} monthly listeners</div>
            ) : (
              <div className="d-ml">{wiki?.description || it?.genre || ''}</div>
            )}
          </div>
        </div>

        <div className="d-body">
          <div className="d-actions">
            {onGalaxy && (
              <button className="btn-green" onClick={() => onGalaxy(a.name)}>
                ✦ Galaxy
              </button>
            )}
            {a.id && (
              <a className="btn-green" href={`https://open.spotify.com/artist/${a.id}`} target="_blank" rel="noreferrer">
                Open in Spotify
              </a>
            )}
            {a.cities?.length > 0 && (
              <button className="btn-ghost" onClick={() => onShowOnMap(a)}>
                Show on globe
              </button>
            )}
            {it?.appleUrl && (
              <a className="btn-ghost" href={it.appleUrl} target="_blank" rel="noreferrer">
                Apple Music ↗
              </a>
            )}
          </div>

          {a.id && (
            <div className="d-stats">
              <div>
                <b>{fmt(a.listeners)}</b>
                <span>Monthly listeners</span>
              </div>
              <div>
                <b>{fmt(a.followers)}</b>
                <span>Followers</span>
              </div>
              <div>
                <b>{a.worldRank ? `#${a.worldRank}` : '—'}</b>
                <span>World rank</span>
              </div>
            </div>
          )}

          {/* Spotify's own player: Popular tracks, playable */}
          {a.id && (
            <section>
              <h3>Popular</h3>
              <iframe
                title="Spotify"
                className="d-embed"
                src={`https://open.spotify.com/embed/artist/${a.id}?utm_source=generator&theme=0`}
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
              />
            </section>
          )}

          {a.topTracks?.length > 0 && (
            <section>
              <h3>Top tracks · total plays</h3>
              <ol className="d-tracks">
                {a.topTracks.map((t, i) => (
                  <li key={t.id || i}>
                    <span className="tr-rank">{i + 1}</span>
                    <span className="an">{t.name}</span>
                    <span className="muted">{t.plays ? full(t.plays) : ''}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {!a.id && it?.songs?.length > 0 && (
            <section>
              <h3>Popular songs</h3>
              <ol className="tracks">
                {it.songs.map((s, i) => (
                  <li key={i} className={playing === s.preview ? 'on' : ''}>
                    <span className="tr-rank">{i + 1}</span>
                    <button className="tr-art" disabled={!s.preview} onClick={() => togglePreview(s.preview)}>
                      {s.artwork && <img src={s.artwork} alt="" />}
                      {s.preview && <span className="tr-play">{playing === s.preview ? '❚❚' : '▶'}</span>}
                    </button>
                    <span className="tr-text">
                      <span className="tr-title">{s.name}</span>
                      <span className="muted">{s.album}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {a.cities?.length > 0 && (
            <section>
              <h3>Where people listen</h3>
              <ul className="d-cities">
                {a.cities.map((c) => (
                  <li key={c.city}>
                    <span>
                      {flag(c.country)} <b>{c.city}</b>
                    </span>
                    <span className="muted">{full(c.listeners)} listeners</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(bio || loading) && (
            <section>
              <h3>About</h3>
              <div className="d-about">
                {wiki?.image && <img src={wiki.image} alt="" />}
                <div>
                  {a.worldRank && <div className="rank-badge">#{a.worldRank} in the world</div>}
                  <p>{bio || 'Loading…'}</p>
                  {wiki?.url && (
                    <a href={wiki.url} target="_blank" rel="noreferrer">
                      Read more on Wikipedia ↗
                    </a>
                  )}
                  {it?.genre && <div className="muted">Genre: {it.genre}</div>}
                </div>
              </div>
            </section>
          )}

          {releases.length > 0 && (
            <section>
              <h3>Discography</h3>
              <div className="d-grid">
                {releases.slice(0, 8).map((r, i) => (
                  <a key={i} href={r.url || undefined} target="_blank" rel="noreferrer" className="d-rel">
                    {r.cover ? <img src={r.cover} alt="" /> : <div className="ph" />}
                    <b>{r.name}</b>
                    <span className="muted">
                      {(r.date || r.year || '').toString().slice(0, 4)}
                      {r.type ? ` · ${String(r.type).toLowerCase()}` : ''}
                    </span>
                  </a>
                ))}
              </div>
            </section>
          )}

          {a.related?.length > 0 && (
            <section>
              <h3>Fans also like</h3>
              <div className="d-grid round">
                {a.related.slice(0, 8).map((r) => (
                  <div key={r.id} className="d-rel">
                    {r.image ? <img src={r.image} alt="" /> : <div className="ph" />}
                    <b>{r.name}</b>
                  </div>
                ))}
              </div>
            </section>
          )}

          {a.concerts?.length > 0 && (
            <section>
              <h3>On tour</h3>
              <ul className="d-cities">
                {a.concerts.map((c, i) => (
                  <li key={i}>
                    <span>
                      <b>{c.city || c.venue}</b> {c.venue && c.city ? `· ${c.venue}` : ''}
                    </span>
                    <span className="muted">{c.date?.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="foot">
            Spotify numbers: {a.updatedAt ? new Date(a.updatedAt).toLocaleString('en-IN') : 'n/a'}. Bio: Wikipedia. Albums
            &amp; previews: iTunes.
          </p>
        </div>
      </aside>
    </div>
  );
}
