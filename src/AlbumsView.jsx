import { useEffect, useMemo, useState } from 'react';
import { addToSet, getSet, onSetChange, songId } from './setStore.js';
import { isLoggedIn, canQueue, findAlbumUri, playContext, playback } from './spotify.js';
import { ensureDevice } from './spotifyPlayer.js';
import SongRow from './SongRow.jsx';
import ArtistLink from './ArtistLink.jsx';

// Open from anywhere: an artist's albums, or one album
export function openAlbums({ artist, albumId } = {}) {
  if (artist || albumId) window.dispatchEvent(new CustomEvent('open-albums', { detail: { artist: artist || null, albumId: albumId ? String(albumId) : null } }));
}

async function getJson(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

const KINDS = ['All', 'Album', 'EP', 'Single'];

export default function AlbumsView({ artist, albumId, onClose, onMixLab }) {
  const [list, setList] = useState(null); // artist's albums
  const [open, setOpen] = useState(albumId || null); // album shown
  const [album, setAlbum] = useState(null);
  const [kind, setKind] = useState('All');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [inSet, setInSet] = useState(() => new Set(getSet().map(songId)));
  useEffect(() => onSetChange((s) => setInSet(new Set(s.map(songId)))), []);

  useEffect(() => {
    if (!artist) return;
    let alive = true;
    getJson(`/api/music?artist=${encodeURIComponent(artist)}`)
      .then((j) => alive && setList(j))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [artist]);
  useEffect(() => {
    if (!open) return setAlbum(null);
    let alive = true;
    setAlbum({ loading: true });
    getJson(`/api/music?album=${open}`)
      .then((j) => alive && setAlbum(j))
      .catch((e) => alive && setAlbum({ error: e.message }));
    return () => {
      alive = false;
    };
  }, [open]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (open && artist) setOpen(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, artist, onClose]);

  const counts = useMemo(() => {
    const c = { All: list?.albums?.length || 0 };
    for (const a of list?.albums || []) c[a.kind] = (c[a.kind] || 0) + 1;
    return c;
  }, [list]);
  const shown = (list?.albums || []).filter((a) => kind === 'All' || a.kind === kind);
  const spotifyOk = isLoggedIn() && canQueue();

  async function playAlbum(a) {
    setMsg('Starting on Spotify…');
    try {
      const uri = await findAlbumUri(a.title, a.artist);
      const pb = await playback().catch(() => null);
      await playContext(uri, { deviceId: pb?.device?.id || (await ensureDevice()) });
      setMsg(`▶ Playing "${a.title}" on Spotify`);
    } catch (e) {
      setMsg(e.message);
    }
  }
  function addAll(tracks) {
    let n = 0;
    for (const t of tracks) if (addToSet({ title: t.title, artist: t.artist, cover: t.cover, preview: t.preview })) n++;
    setMsg(n ? `Added ${n} song${n === 1 ? '' : 's'} to your set` : 'Already in your set');
  }

  const a = album?.album;
  return (
    <div className="gn-wrap" onClick={onClose}>
      <aside className="gn-panel" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Close">
          ×
        </button>

        {!open && (
          <>
            <header className="gn-head">
              <div className="ml-kicker">
                <span className="spark">✦</span> DISCOGRAPHY
              </div>
              <h2>{list?.artist || artist}</h2>
              <div className="muted">Albums, EPs and singles, newest first. Tap one to see its songs.</div>
              {list?.albums?.length > 0 && (
                <div className="seg al-kinds">
                  {KINDS.filter((k) => k === 'All' || counts[k]).map((k) => (
                    <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                      {k === 'All' ? 'All' : `${k}s`} <span className="muted">{counts[k] || 0}</span>
                    </button>
                  ))}
                </div>
              )}
            </header>
            <div className="gn-body-scroll">
              {!list && !err && <div className="muted al-pad">Loading albums…</div>}
              {err && <div className="status err">{err}</div>}
              {list && !list.albums.length && <div className="muted al-pad">No albums found.</div>}
              <div className="al-grid">
                {shown.map((x) => (
                  <button key={x.id} className="al-card" onClick={() => setOpen(x.id)} title={`${x.title} · ${x.tracks} songs`}>
                    {x.cover ? <img src={x.cover} alt="" loading="lazy" /> : <span className="ph" />}
                    <b>{x.title}</b>
                    <small>
                      {x.year} · {x.kind}
                      {x.kind !== 'Single' ? ` · ${x.tracks} songs` : ''}
                    </small>
                  </button>
                ))}
              </div>
              <div className="foot">Source: Apple Music catalogue (covers, dates, 30 s previews).</div>
            </div>
          </>
        )}

        {open && (
          <>
            <header className="gn-head al-head">
              {artist && (
                <button className="btn-ghost sm al-back" onClick={() => setOpen(null)}>
                  ← All albums
                </button>
              )}
              {album?.loading && <div className="muted">Loading songs…</div>}
              {album?.error && <div className="status err">{album.error}</div>}
              {a && (
                <div className="al-top">
                  {a.cover && <img src={a.cover} alt="" />}
                  <div>
                    <div className="ml-kicker">
                      <span className="spark">✦</span> {a.kind.toUpperCase()}
                    </div>
                    <h2>{a.title}</h2>
                    <div className="tr-artist">
                      <ArtistLink name={a.artist} />
                      <span className="muted">
                        {' '}
                        · {a.year} · {album.tracks.length} songs
                        {a.genre ? ` · ${a.genre}` : ''}
                      </span>
                    </div>
                    <div className="gn-tools">
                      {spotifyOk && (
                        <button className="btn-green sm" onClick={() => playAlbum(a)}>
                          ▶ Play on Spotify
                        </button>
                      )}
                      <button className="btn-ghost sm" onClick={() => addAll(album.tracks)}>
                        + Add all to my set
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {msg && <div className="muted sr-msg">{msg}</div>}
            </header>
            <div className="gn-body-scroll">
              {album?.tracks?.map((t, i) => (
                <SongRow key={`${t.trackNumber}|${t.title}|${i}`} s={t} rank={t.trackNumber || i + 1} inSet={inSet} onMixLab={onMixLab} meta={t.durationMs ? `${Math.floor(t.durationMs / 60000)}:${String(Math.round((t.durationMs % 60000) / 1000)).padStart(2, '0')}` : false} />
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
