import { useEffect, useMemo, useRef, useState } from 'react';
import { useNow } from './nowStore.js';
import { useLyrics, useCoverColor, lineAt, posNow } from './lyricsCore.js';
import { seekHere } from './spotifyPlayer.js';
import { isLoggedIn } from './spotify.js';
import ArtistLink from './ArtistLink.jsx';

// Open from anywhere
export const openLyrics = () => window.dispatchEvent(new CustomEvent('open-lyrics'));
export const openAmbient = () => window.dispatchEvent(new CustomEvent('open-ambient'));
export { lineAt };

export default function LyricsView({ onClose }) {
  const now = useNow();
  const tr = now.track;
  const [idx, setIdx] = useState(-1);
  const [offset, setOffset] = useState(0); // your fine-tune, ms
  const box = useRef(null);
  const userScroll = useRef(0);
  const bg = useCoverColor(tr?.cover);
  const canSeek = isLoggedIn();

  const data = useLyrics(tr);
  useEffect(() => {
    setIdx(-1);
    setOffset(0);
  }, [tr?.id, tr?.name]);

  const lines = data?.synced;
  // follow the song, ~6 times a second
  useEffect(() => {
    if (!lines?.length) return;
    const tick = () => setIdx(lineAt(lines, posNow() + offset + 150));
    tick();
    const iv = setInterval(tick, 160);
    return () => clearInterval(iv);
  }, [lines, offset]);

  // keep the current line in the middle (unless you just scrolled yourself)
  useEffect(() => {
    if (idx < 0 || Date.now() - userScroll.current < 3500) return;
    const el = box.current?.querySelector(`[data-i="${idx}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [idx]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const plainLines = useMemo(() => (data?.plain ? data.plain.split(/\r?\n/) : null), [data]);

  return (
    <div className="ly-wrap" onClick={onClose}>
      <aside className="ly-panel" style={bg ? { '--ly-bg': bg } : undefined} onClick={(e) => e.stopPropagation()}>
        <header className="ly-head">
          {tr?.cover && <img src={tr.cover} alt="" />}
          <div className="ly-meta">
            <small>Lyrics</small>
            <b>{tr?.name || 'Nothing playing'}</b>
            {tr && (
              <span className="tr-artist">
                <ArtistLink name={tr.artists.map((a) => a.name).join(', ')} />
              </span>
            )}
          </div>
          {lines && (
            <div className="ly-sync" title="If the words run early or late, nudge them">
              <button onClick={() => setOffset((o) => o - 500)} aria-label="Lyrics earlier">
                −
              </button>
              <span>{offset ? `${offset > 0 ? '+' : ''}${(offset / 1000).toFixed(1)}s` : 'sync'}</span>
              <button onClick={() => setOffset((o) => o + 500)} aria-label="Lyrics later">
                +
              </button>
            </div>
          )}
          <button className="ly-amb" onClick={openAmbient} title="Full screen with moving scenes (ocean, clouds, aurora…)">
            🌊 Scenes
          </button>
          <button className="ly-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="ly-body" ref={box} onWheel={() => (userScroll.current = Date.now())} onTouchMove={() => (userScroll.current = Date.now())}>
          {!tr && <p className="ly-msg">Play a song on Spotify and its lyrics show up here, in time with the music.</p>}
          {tr && data?.loading && <p className="ly-msg">Finding lyrics…</p>}
          {tr && data?.error && <p className="ly-msg">{data.error}</p>}
          {tr && data && !data.loading && !data.error && !data.found && <p className="ly-msg">No lyrics found for this song yet.</p>}
          {tr && data?.instrumental && <p className="ly-msg">♪ Instrumental ♪</p>}

          {lines?.map((l, i) => (
            <p
              key={i}
              data-i={i}
              className={`ly-line ${i === idx ? 'on' : i < idx ? 'past' : ''} ${canSeek ? 'seek' : ''}`}
              onClick={() => canSeek && Promise.resolve(seekHere(Math.max(0, l.t - offset))).catch(() => {})}
            >
              {l.text || '♪'}
            </p>
          ))}

          {plainLines && (
            <>
              <p className="ly-note">These lyrics aren't synced to the song yet.</p>
              {plainLines.map((l, i) => (
                <p key={i} className="ly-line plain">
                  {l || ' '}
                </p>
              ))}
            </>
          )}
          {data?.found && <p className="ly-src">Lyrics from {data.source} (lrclib.net), a free community library.</p>}
        </div>
      </aside>
    </div>
  );
}
