import { useEffect, useRef, useState } from 'react';
import { useNow } from './nowStore.js';
import { useLyrics, useCoverColor, lineAt, posNow } from './lyricsCore.js';
import { SCENES, startScene } from './scenes.js';

const KEY = 'ambient-scene';
const savedScene = () => {
  try {
    const i = SCENES.findIndex((s) => s.id === localStorage.getItem(KEY));
    return i >= 0 ? i : 0;
  } catch {
    return 0;
  }
};

// Full screen: a moving scene and only the line being sung right now
export default function AmbientLyrics({ onClose }) {
  const now = useNow();
  const tr = now.track;
  const data = useLyrics(tr);
  const lines = data?.synced || null;
  const color = useCoverColor(tr?.cover);
  const [scene, setScene] = useState(savedScene);
  const [idx, setIdx] = useState(-1);
  const [offset, setOffset] = useState(0);
  const [ui, setUi] = useState(true); // controls visible
  const [noGl, setNoGl] = useState(false);
  const wrap = useRef(null);
  const canvas = useRef(null);
  const gfx = useRef(null);

  // the moving scene
  useEffect(() => {
    const smooth = document.body.classList.contains('perf-smooth');
    const g = startScene(canvas.current, { scene, scale: smooth ? 0.35 : 0.5 });
    if (!g) setNoGl(true);
    gfx.current = g;
    return () => g?.stop();
  }, []);
  useEffect(() => {
    gfx.current?.setScene(scene);
    try {
      localStorage.setItem(KEY, SCENES[scene].id);
    } catch {}
  }, [scene]);
  useEffect(() => {
    const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(color || '');
    if (m) gfx.current?.setColor([m[1] / 160, m[2] / 160, m[3] / 160]);
  }, [color]);

  // the line being sung
  useEffect(() => {
    setIdx(-1);
    setOffset(0);
  }, [tr?.id]);
  useEffect(() => {
    if (!lines?.length) return;
    const tick = () => setIdx(lineAt(lines, posNow() + offset + 150));
    tick();
    const iv = setInterval(tick, 120);
    return () => clearInterval(iv);
  }, [lines, offset]);
  useEffect(() => {
    if (idx >= 0) gfx.current?.pulse(); // a soft glow on each new line
  }, [idx]);

  // controls fade away while you watch; move the mouse to bring them back
  useEffect(() => {
    let t = setTimeout(() => setUi(false), 2500);
    const wake = () => {
      setUi(true);
      clearTimeout(t);
      t = setTimeout(() => setUi(false), 2500);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
      if (e.key === 'ArrowRight') setScene((s) => (s + 1) % SCENES.length);
      if (e.key === 'ArrowLeft') setScene((s) => (s - 1 + SCENES.length) % SCENES.length);
      wake();
    };
    window.addEventListener('mousemove', wake);
    window.addEventListener('touchstart', wake);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('touchstart', wake);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else wrap.current?.requestFullscreen?.().catch(() => {});
  };

  const line = idx >= 0 ? lines?.[idx]?.text : null;
  const next = lines?.[idx + 1]?.text;
  let message = null;
  if (!tr) message = 'Play a song on Spotify';
  else if (data?.loading) message = '…';
  else if (data?.instrumental) message = '♪';
  else if (data && !lines) message = 'No synced lyrics for this song. Enjoy the view.';
  else if (lines && idx < 0) message = '♪';

  return (
    <div className={`amb ${ui ? 'ui' : ''} ${noGl ? 'nogl' : ''}`} ref={wrap}>
      <canvas ref={canvas} className="amb-canvas" />
      <div className="amb-shade" />

      <div className="amb-lyric" aria-live="polite">
        {line != null ? (
          <p key={idx} className="amb-line">
            {line || '♪'}
          </p>
        ) : (
          <p className="amb-line amb-msg">{message}</p>
        )}
        {next && <p className="amb-next">{next}</p>}
      </div>

      <div className="amb-top">
        <div className="amb-scenes">
          {SCENES.map((s, i) => (
            <button key={s.id} className={i === scene ? 'on' : ''} onClick={() => setScene(i)}>
              {s.icon} {s.label}
            </button>
          ))}
        </div>
        <div className="amb-acts">
          {lines && (
            <span className="amb-sync" title="If the words run early or late, nudge them">
              <button onClick={() => setOffset((o) => o - 500)}>−</button>
              <span>{offset ? `${offset > 0 ? '+' : ''}${(offset / 1000).toFixed(1)}s` : 'sync'}</span>
              <button onClick={() => setOffset((o) => o + 500)}>+</button>
            </span>
          )}
          <button onClick={fullscreen} title="Full screen">
            ⛶
          </button>
          <button onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>
      </div>

      {tr && (
        <div className="amb-song">
          {tr.cover && <img src={tr.cover} alt="" />}
          <div>
            <b>{tr.name}</b>
            <span>{tr.artists.map((a) => a.name).join(', ')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
