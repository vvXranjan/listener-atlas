import { useEffect, useState } from 'react';
import { togglePreview, usePlaying } from './player.js';
import { addToSet, getSet, onSetChange, songId } from './setStore.js';
import ArtistLink, { openGalaxy } from './ArtistLink.jsx';

// Click a genre anywhere → its top songs (with the artist you came from), and its biggest artists.
export function openGenre(tag, from = null) {
  const t = String(tag || '').trim();
  if (t) window.dispatchEvent(new CustomEvent('open-genre', { detail: { tag: t, artist: from?.artist || null, songs: from?.songs || [] } }));
}

// A clickable genre chip
export function GenreChip({ tag, artist, songs, title }) {
  return (
    <button
      className="genre-chip"
      title={title || `Top ${tag} songs and artists`}
      onClick={(e) => {
        e.stopPropagation();
        openGenre(tag, { artist, songs });
      }}
    >
      {tag}
    </button>
  );
}

const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n || 0));
const strip = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default function GenreView({ tag, artist, artistSongs = [], onClose, onMixLab }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [previews, setPreviews] = useState({});
  const [inSet, setInSet] = useState(() => new Set(getSet().map(songId)));
  const playing = usePlaying();

  useEffect(() => onSetChange((s) => setInSet(new Set(s.map(songId)))), []);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    fetch(`/api/genre?tag=${encodeURIComponent(tag)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
        return j;
      })
      .then((j) => alive && setData(j))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [tag]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function play(s) {
    const id = songId(s);
    let url = s.preview || previews[id];
    if (!url) {
      setPreviews((p) => ({ ...p, [id]: 'loading' }));
      const qs = new URLSearchParams({ title: s.title, artist: (s.mainArtist || s.artist).split(/,|&| feat/i)[0].trim() });
      const j = await fetch(`/api/preview?${qs}`)
        .then((r) => r.json())
        .catch(() => null);
      url = j?.preview || null;
      setPreviews((p) => ({ ...p, [id]: url || 'none' }));
      if (s.cover == null && j?.coverHq) s.cover = j.coverHq;
    }
    if (url && url !== 'loading' && url !== 'none') togglePreview(url);
  }

  const mine = artistSongs.slice(0, 8);
  const songs = data?.songs || [];
  const artistKey = strip(artist);
  const byArtistInTop = artist ? songs.filter((s) => strip(s.artist).includes(artistKey)).length : 0;
  const title = tag.replace(/\b\w/g, (c) => c.toUpperCase());

  function addTop(n) {
    for (const s of songs.slice(0, n)) addToSet({ title: s.title, artist: s.artist, cover: s.cover, preview: previews[songId(s)]?.startsWith?.('http') ? previews[songId(s)] : null });
  }

  const Row = ({ s, i, hot }) => {
    const id = songId(s);
    const url = s.preview || previews[id];
    const on = url && playing === url;
    return (
      <div className={`gn-row ${hot ? 'hot' : ''}`}>
        {i != null && <span className="gn-rank">{i + 1}</span>}
        <button className="gn-cover" onClick={() => play(s)} title={url === 'none' ? 'No preview' : 'Play a 30 s preview'}>
          {s.cover ? <img src={s.cover} alt="" loading="lazy" /> : <span className="ph" />}
          <span className="tr-play">{url === 'loading' ? '…' : url === 'none' ? '–' : on ? '❚❚' : '▶'}</span>
        </button>
        <div className="gn-body">
          <div className="un-title">{s.title}</div>
          <div className="tr-artist">
            <ArtistLink name={s.artist} />
            {s.plays > 0 && <span className="muted"> · {fmt(s.plays)} plays</span>}
            {hot && <span className="gn-badge">{artist}</span>}
          </div>
        </div>
        <div className="gn-acts">
          {onMixLab && (
            <button className="gx-fxbtn" title="Find the best next song after this one" onClick={() => onMixLab({ id: s.title, name: s.title, artists: [{ name: s.mainArtist || s.artist }], cover: s.cover })}>
              ⇄
            </button>
          )}
          <button
            className={`gx-fxbtn ${inSet.has(id) ? 'on' : ''}`}
            disabled={inSet.has(id)}
            onClick={() => addToSet({ title: s.title, artist: s.artist, cover: s.cover, preview: url?.startsWith?.('http') ? url : s.preview || null })}
          >
            {inSet.has(id) ? '✓ In set' : '+ Set'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="gn-wrap" onClick={onClose}>
      <aside className="gn-panel" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Close">
          ×
        </button>
        <header className="gn-head">
          <div className="ml-kicker">
            <span className="spark">✦</span> GENRE
          </div>
          <h2>{title}</h2>
          <div className="muted">
            The most played {tag} songs and the biggest artists in it{artist ? `, starting with ${artist}` : ''}.
          </div>
          {songs.length > 0 && (
            <div className="gn-tools">
              <button className="btn-green sm" onClick={() => addTop(10)}>
                + Add top 10 to my set
              </button>
            </div>
          )}
        </header>

        <div className="gn-body-scroll">
          {mine.length > 0 && (
            <section>
              <h3 className="ml-h">
                {artist} in {title}
              </h3>
              {mine.map((s) => (
                <Row key={`m-${songId(s)}`} s={s} />
              ))}
            </section>
          )}

          <section>
            <h3 className="ml-h">
              Top {title} songs {songs.length > 0 && <span className="ml-count">{songs.length}</span>}
            </h3>
            {!data && !error && <div className="muted">Finding the most played {tag} songs…</div>}
            {error && <div className="status err">{error}</div>}
            {data && !songs.length && <div className="muted">No open listening data for this genre yet.</div>}
            {artist && byArtistInTop > 0 && (
              <div className="muted gn-note">
                {artist} has {byArtistInTop} song{byArtistInTop === 1 ? '' : 's'} in this top list (highlighted).
              </div>
            )}
            {songs.map((s, i) => (
              <Row key={`t-${s.mbid || i}`} s={s} i={i} hot={!!artist && strip(s.artist).includes(artistKey)} />
            ))}
          </section>

          {data?.artists?.length > 0 && (
            <section>
              <h3 className="ml-h">Biggest {title} artists</h3>
              <div className="gn-artists">
                {data.artists.map((a) => (
                  <button key={a.name} className={`gn-artist ${strip(a.name) === artistKey ? 'hot' : ''}`} onClick={() => openGalaxy(a.name)} title={`Open ${a.name}'s Galaxy`}>
                    {a.cover ? <img src={a.cover} alt="" loading="lazy" /> : <span className="ph" />}
                    <span>
                      <b>{a.name}</b>
                      <small>
                        {a.songs} song{a.songs === 1 ? '' : 's'} · {fmt(a.plays)} plays
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {data && <div className="foot">Source: {data.source}. Genres come from listener tags, so edges are fuzzy.</div>}
        </div>
      </aside>
    </div>
  );
}
