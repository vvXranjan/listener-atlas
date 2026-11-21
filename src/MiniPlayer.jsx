import React, { useEffect, useState } from 'react';
import { useNow, setNow } from './nowStore.js';
import { pausePlayback, resumePlayback, nextTrack, previousTrack, canQueue, isLoggedIn } from './spotify.js';
import { useSpotifyPlayer, togglePlayHere, ensureDevice, seekHere } from './spotifyPlayer.js';
import { useAutoDj, mixNow, stopAutoDj, resumeSet } from './autoDj.js';

const mmss = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Small player for the floating window: control your Spotify without leaving the set
export default function MiniPlayer() {
  const now = useNow();
  const sdk = useSpotifyPlayer();
  const dj = useAutoDj();
  const [, tick] = useState(0);
  const [scrub, setScrub] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!isLoggedIn()) return <div className="mp muted">Connect Spotify to control playback here.</div>;
  const tr = now.track;
  if (!tr) return <div className="mp muted">Play something on Spotify and it shows here.</div>;

  const progress = Math.min(tr.durationMs, now.progressMs + (now.playing ? Date.now() - now.fetchedAt : 0));
  const shown = scrub != null ? scrub * tr.durationMs : progress;
  const run = async (fn) => {
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    }
  };
  const jump = (ms) => {
    setNow({ progressMs: ms, fetchedAt: Date.now() }); // show it right away
    run(() => seekHere(ms));
  };
  const can = canQueue();

  return (
    <div className="mp">
      <div className="mp-row">
        {tr.cover ? <img src={tr.cover} alt="" className={now.playing ? 'spin' : ''} /> : <div className="ph" />}
        <div className="mp-text">
          <div className="un-title">{tr.name}</div>
          <div className="tr-artist">{tr.artists.map((a) => a.name).join(', ')}</div>
        </div>
        {can && (
          <div className="np-ctl mp-ctl">
            <button aria-label="Previous" onClick={() => run(() => previousTrack())}>⏮</button>
            <button
              className="np-ctl-main"
              aria-label={now.playing ? 'Pause' : 'Play'}
              onClick={() =>
                run(async () => {
                  setNow({ playing: !now.playing, progressMs: progress, fetchedAt: Date.now() });
                  return sdk.active ? togglePlayHere() : now.playing ? pausePlayback() : resumePlayback(await ensureDevice());
                })
              }
            >
              {now.playing ? '❚❚' : '▶'}
            </button>
            <button aria-label="Next" onClick={() => run(() => nextTrack())}>⏭</button>
            <button className="np-skip" title="Forward 15s" onClick={() => jump(Math.min(tr.durationMs - 1000, progress + 15000))}>
              +15
            </button>
          </div>
        )}
      </div>
      <div
        className={`np-bar seek ${scrub != null ? 'scrubbing' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label="Song position"
        aria-valuenow={Math.round(progress / 1000)}
        onPointerDown={(e) => {
          if (!can || e.button !== 0) return;
          e.stopPropagation(); // don't drag the window
          const bar = e.currentTarget;
          const rect = bar.getBoundingClientRect();
          const at = (x) => Math.max(0, Math.min(1, (x - rect.left) / rect.width));
          bar.setPointerCapture?.(e.pointerId);
          let f = at(e.clientX);
          setScrub(f);
          const move = (ev) => setScrub((f = at(ev.clientX)));
          const up = () => {
            bar.removeEventListener('pointermove', move);
            bar.removeEventListener('pointerup', up);
            bar.removeEventListener('pointercancel', up);
            setScrub(null);
            jump(f * tr.durationMs);
          };
          bar.addEventListener('pointermove', move);
          bar.addEventListener('pointerup', up);
          bar.addEventListener('pointercancel', up);
        }}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' ? 10000 : e.key === 'ArrowLeft' ? -10000 : 0;
          if (step) {
            e.preventDefault();
            jump(Math.max(0, Math.min(tr.durationMs - 1000, progress + step)));
          }
        }}
      >
        <div style={{ width: `${(shown / tr.durationMs) * 100}%` }} />
        <i className="np-knob" style={{ left: `${(shown / tr.durationMs) * 100}%` }} />
      </div>
      <div className="np-time muted">
        <span>{mmss(shown)}</span>
        <span>{mmss(tr.durationMs)}</span>
      </div>
      {dj.on && (
        <div className="mp-dj">
          <span className="ml-dj-dot" />
          <span className="mp-dj-text">{dj.mixing ? 'Mixing…' : dj.status}</span>
          {dj.paused ? (
            <button className="gx-fxbtn on" disabled={dj.mixing} onClick={resumeSet}>
              ▶ Resume set
            </button>
          ) : (
            <button className="gx-fxbtn on" disabled={dj.mixing || !dj.next} onClick={mixNow}>
              ⇄ Mix now
            </button>
          )}
          <button className="gx-fxbtn" onClick={() => stopAutoDj('Auto-DJ stopped.')}>
            ■
          </button>
        </div>
      )}
      {err && <div className="status err">{err}</div>}
    </div>
  );
}
