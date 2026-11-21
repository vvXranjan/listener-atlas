import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  canLibrary, likedSongs, recentlyPlayed, topTracks, myPlaylists, playlistTracks, playUris, queueUri, login, logout,
} from './spotify.js';
import { addToSet, getSet, onSetChange, songId } from './setStore.js';
import { stopOthers, stopPreview } from './player.js';
import { ensureDevice } from './spotifyPlayer.js';

const TABS = [
  ['liked', '♥ Liked songs'],
  ['recent', '↺ Recently played'],
  ['top', '★ Your top'],
  ['playlists', '☰ Playlists'],
];
const idOf = songId;
const firstArtist = (a) => a.split(/,|&| with /)[0].trim();
const mmss = (ms) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}` : '');

// Your Spotify library, in the app: play, queue, add to your set, or open in Mix Lab
export default function Library({ onClose, onMixLab, initialTab }) {
  return createPortal(<LibraryInner onClose={onClose} onMixLab={onMixLab} initialTab={initialTab} />, document.body);
}

function LibraryInner({ onClose, onMixLab, initialTab }) {
  const [tab, setTab] = useState(['liked', 'recent', 'top', 'playlists'].includes(initialTab) ? initialTab : 'liked');
  const [range, setRange] = useState('short_term');
  const [playlist, setPlaylist] = useState(null);
  const [data, setData] = useState({}); // key -> { items, total, more, loading, error }
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState({}); // uri -> text
  const [inSet, setInSet] = useState(() => new Set(getSet().map(idOf)));

  useEffect(() => onSetChange((list) => setInSet(new Set(list.map(idOf)))), []);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const key = tab === 'top' ? `top|${range}` : tab === 'playlists' && playlist ? `pl|${playlist.id}` : tab;
  const cur = data[key];

  async function load(k, more = false) {
    const prev = data[k];
    const offset = more ? prev?.items?.length || 0 : 0;
    setData((d) => ({ ...d, [k]: { ...(more ? prev : {}), loading: true, error: '' } }));
    try {
      const fetcher =
        k === 'liked'
          ? () => likedSongs(offset)
          : k === 'recent'
            ? () => recentlyPlayed()
            : k.startsWith('top|')
              ? () => topTracks(k.slice(4))
              : k === 'playlists'
                ? () => myPlaylists(offset)
                : () => playlistTracks(k.slice(3), offset);
      const r = await fetcher();
      setData((d) => ({ ...d, [k]: { ...r, items: more ? [...(prev?.items || []), ...r.items] : r.items, loading: false } }));
    } catch (e) {
      setData((d) => ({ ...d, [k]: { ...(d[k] || {}), loading: false, error: e.message } }));
    }
  }

  useEffect(() => {
    if (!canLibrary()) return;
    if (!data[key]) load(key);
    setFilter('');
  }, [key]);

  const items = useMemo(() => {
    const list = cur?.items || [];
    const f = filter.trim().toLowerCase();
    if (!f) return list;
    return list.filter((t) => `${t.title} ${t.artist || ''} ${t.name || ''} ${t.album || ''}`.toLowerCase().includes(f));
  }, [cur, filter]);

  const say = (uri, text) => setMsg((m) => ({ ...m, [uri]: text }));

  async function playFrom(i) {
    const t = items[i];
    stopPreview();
    stopOthers.forEach((fn) => fn());
    try {
      say(t.uri, 'Starting…');
      const deviceId = await ensureDevice();
      // play this song, then the rest of the list after it (like tapping a song in Spotify)
      await playUris(items.slice(i, i + 50).map((x) => x.uri), { deviceId });
      say(t.uri, '▶ Playing on your Spotify');
    } catch (e) {
      say(t.uri, `⚠ ${e.message}`);
    }
  }

  async function queue(t) {
    try {
      await queueUri(t.uri);
      say(t.uri, '✓ Added to your queue');
    } catch (e) {
      say(t.uri, e.noDevice ? '⚠ Nothing is playing yet. Click a cover to start, then queue.' : `⚠ ${e.message}`);
    }
  }

  if (!canLibrary()) {
    return (
      <div className="sz-wrap" onClick={onClose}>
        <div className="lib lib-small" onClick={(e) => e.stopPropagation()}>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
          <div className="ml-kicker">
            <span className="spark">✦</span> YOUR LIBRARY
          </div>
          <h2>One more permission</h2>
          <p className="muted">
            To show your Liked Songs, playlists and top tracks, Spotify needs you to reconnect once and allow library access.
          </p>
          <button
            className="btn-green"
            onClick={async () => {
              logout();
              await login();
            }}
          >
            Reconnect Spotify
          </button>
        </div>
      </div>
    );
  }

  const showingPlaylists = tab === 'playlists' && !playlist;

  return (
    <div className="sz-wrap" onClick={onClose}>
      <div className="lib" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Close">
          ×
        </button>
        <header className="lib-head">
          <div className="ml-kicker">
            <span className="spark">✦</span> YOUR LIBRARY
          </div>
          <h2>{playlist ? playlist.name : TABS.find(([t]) => t === tab)[1].slice(2)}</h2>
          <div className="lib-tabs">
            {TABS.map(([t, l]) => (
              <button
                key={t}
                className={tab === t ? 'on' : ''}
                onClick={() => {
                  setTab(t);
                  setPlaylist(null);
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="lib-bar">
            {playlist && (
              <button className="link-btn lib-back" onClick={() => setPlaylist(null)}>
                ‹ All playlists
              </button>
            )}
            {tab === 'top' && (
              <div className="seg gx-seg">
                {[
                  ['short_term', '4 weeks'],
                  ['medium_term', '6 months'],
                  ['long_term', 'All time'],
                ].map(([r, l]) => (
                  <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
                    {l}
                  </button>
                ))}
              </div>
            )}
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={showingPlaylists ? 'Filter playlists…' : 'Filter songs…'} />
            {cur?.total > 0 && <span className="lib-count">{cur.total.toLocaleString()} total</span>}
          </div>
        </header>

        <div className="lib-list">
          {cur?.error && <div className="status err">{cur.error}</div>}
          {cur?.loading && !cur?.items?.length && (
            <div className="un-loading">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="un-skel lib-skel" />
              ))}
            </div>
          )}

          {showingPlaylists
            ? items.map((p) => (
                <button key={p.id} className="lib-row lib-pl" onClick={() => setPlaylist(p)}>
                  {p.cover ? <img src={p.cover} alt="" /> : <div className="ph" />}
                  <div className="un-body">
                    <div className="un-title">{p.name}</div>
                    <div className="tr-artist">
                      {[p.owner, p.count != null && `${p.count} songs`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className="lib-chev">›</span>
                </button>
              ))
            : items.map((t, i) => {
                const added = inSet.has(idOf(t));
                return (
                  <div key={t.uri + i} className="lib-row">
                    <button className="un-cover sm" onClick={() => playFrom(i)} title="Play on your Spotify">
                      {t.cover ? <img src={t.cover} alt="" /> : <div className="ph" />}
                      <span className="tr-play">▶</span>
                    </button>
                    <div className="un-body">
                      <div className="un-title">{t.title}</div>
                      <div className="tr-artist">
                        {t.artist}
                        {t.durationMs ? <span className="lib-dur"> · {mmss(t.durationMs)}</span> : null}
                      </div>
                      {msg[t.uri] && <div className={`ml-livestep ${msg[t.uri].startsWith('⚠') ? 'err' : ''}`}>{msg[t.uri]}</div>}
                    </div>
                    <div className="lib-actions">
                      <button
                        className="btn-ghost sm ml-live"
                        title="Open in Mix Lab"
                        onClick={() => onMixLab({ id: t.id || t.title, name: t.title, artists: [{ name: firstArtist(t.artist) }], cover: t.cover })}
                      >
                        ✦ Mix Lab
                      </button>
                      <button className="btn-ghost sm" disabled={added} onClick={() => addToSet(t)}>
                        {added ? '✓ In set' : '+ Set'}
                      </button>
                      <button className="btn-ghost sm" onClick={() => queue(t)}>
                        + Queue
                      </button>
                    </div>
                  </div>
                );
              })}

          {cur && !cur.loading && !cur.error && !items.length && <div className="muted">Nothing here.</div>}
          {cur?.more && !filter && (
            <button className="btn-ghost lib-more" disabled={cur.loading} onClick={() => load(key, true)}>
              {cur.loading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
