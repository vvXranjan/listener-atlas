import React, { useEffect, useRef, useState } from 'react';
import { everyWhileVisible } from './visibility.js';

const POLL_MS = 10000;

const ago = (iso, now) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

// A live strip of songs people are playing right now (ListenBrainz, open source).
export default function LiveTicker({ onArtist }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const seen = useRef(new Set());

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const r = await fetch('/api/now-playing');
        if (!r.ok || !r.headers.get('content-type')?.includes('json')) throw new Error();
        const j = await r.json();
        if (stop) return;
        setError(false);
        setTotal(j.globalListenCount);
        setItems((prev) => {
          const fresh = j.listens
            .filter((l) => l.track && l.artist && Date.now() - new Date(l.at).getTime() < 3600 * 1000)
            .map((l) => ({ ...l, key: `${l.at}|${l.track}|${l.artist}` }))
            .filter((l) => !seen.current.has(l.key));
          fresh.forEach((l) => seen.current.add(l.key));
          return [...fresh, ...prev].slice(0, 40);
        });
      } catch {
        if (!stop) setError(true);
      }
    }
    const off = everyWhileVisible(poll, POLL_MS); // paused while the tab is hidden
    const c = setInterval(() => !document.hidden && setNow(Date.now()), 1000);
    return () => {
      stop = true;
      off();
      clearInterval(c);
    };
  }, []);

  if (error && !items.length) return null;

  return (
    <div className="ticker">
      <span className="ticker-tag">
        <span className="live-dot" /> LIVE NOW
      </span>
      <div className="ticker-track">
        <div className="ticker-move">
          {[...items, ...items].map((l, i) => (
            <button key={`${l.key}-${i}`} className="ticker-item" onClick={() => onArtist({ name: l.artist })}>
              <b>{l.track}</b> · {l.artist} <span className="muted">{ago(l.at, now)}</span>
            </button>
          ))}
        </div>
      </div>
      {total && (
        <span className="ticker-total" title="All plays ever tracked by ListenBrainz">
          {total.toLocaleString('en-US')} plays
        </span>
      )}
    </div>
  );
}
