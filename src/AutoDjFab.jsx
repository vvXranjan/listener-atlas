import { useEffect, useRef, useState } from 'react';
import { startAutoDj, stopAutoDj, useAutoDj } from './autoDj.js';
import { getSet, onSetChange, getPrefs, onPrefsChange } from './setStore.js';
import { isLoggedIn, canQueue } from './spotify.js';
import { modeInfo } from './djModes.js';

// One-tap Auto-DJ switch on the main screen (next to Shazam)
export default function AutoDjFab({ onOpenSet }) {
  const dj = useAutoDj();
  const [count, setCount] = useState(() => getSet().length);
  const [mode, setMode] = useState(() => getPrefs().djMode || 'auto');
  const [hint, setHint] = useState('');
  useEffect(() => onSetChange((s) => setCount(s.length)), []);
  useEffect(() => onPrefsChange((p) => setMode(p.djMode || 'auto')), []);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(''), 3500);
    return () => clearTimeout(t);
  }, [hint]);

  const on = dj.on;
  const m = modeInfo(mode);

  // Auto-DJ is ON by default: as soon as you're connected and your set has songs, it gets ready
  // (it never starts music by itself; it takes over when a song you play ends).
  const autoTried = useRef(false);
  const userOff = useRef(false);
  useEffect(() => {
    if (on || autoTried.current || userOff.current || !count) return;
    const t = setTimeout(() => {
      if (autoTried.current || userOff.current || !isLoggedIn() || !canQueue()) return;
      autoTried.current = true;
      startAutoDj({ passive: true });
    }, 1500);
    return () => clearTimeout(t);
  }, [count, on]);

  function toggle() {
    if (on) {
      userOff.current = true;
      return stopAutoDj('Auto-DJ stopped.');
    }
    if (!isLoggedIn() || !canQueue()) {
      setHint('Connect Spotify first');
      return onOpenSet?.();
    }
    if (!count) {
      setHint('Add songs to your set first');
      return onOpenSet?.();
    }
    startAutoDj({});
  }

  const left = dj.secondsLeft != null && !dj.mixing ? `${Math.floor(dj.secondsLeft / 60)}:${String(dj.secondsLeft % 60).padStart(2, '0')}` : '';
  const sub = on ? (dj.mixing ? 'mixing…' : dj.paused ? 'paused' : dj.next ? `next: ${dj.next.title}` : 'last song') : `${m.icon} ${m.label} · ${count} song${count === 1 ? '' : 's'}`;

  return (
    <div className={`dj-fab-wrap ${on ? 'on' : ''}`}>
      {(hint || dj.error) && <div className="dj-fab-hint">{hint || dj.error}</div>}
      <button
        className={`dj-fab ${on ? 'on' : ''} ${dj.paused ? 'paused' : ''}`}
        role="switch"
        aria-checked={on}
        onClick={toggle}
        title={on ? 'Auto-DJ is on: tap to turn it off' : 'Turn Auto-DJ on: plays your set with smooth transitions'}
      >
        <span className="dj-fab-icon">🎧</span>
        <span className="dj-fab-text">
          <b>
            Auto-DJ {on ? 'ON' : 'OFF'}
            {on && left && <i> · {left}</i>}
          </b>
          <small>{sub}</small>
        </span>
        <span className="dj-fab-switch" aria-hidden="true">
          <span />
        </span>
      </button>
      <button className="dj-fab-set" onClick={onOpenSet} title="Open your set and transition modes">
        ⚙
      </button>
    </div>
  );
}
