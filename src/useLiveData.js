import { useEffect, useRef, useState } from 'react';
import bundled from './data/live.json';
import { everyWhileVisible } from './visibility.js';

const POLL_MS = 60 * 1000;

// Keeps Spotify data fresh: polls /api/live every minute and tracks
// how each artist's monthly listeners moved since the last update.
export function useLiveData() {
  const [data, setData] = useState(bundled);
  const [deltas, setDeltas] = useState({}); // artistId -> change in listeners
  const [checkedAt, setCheckedAt] = useState(null);
  const [server, setServer] = useState({ autoRefresh: false, refreshHours: 24, online: null });
  const last = useRef(bundled.updatedAt);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const res = await fetch('/api/live');
        if (!res.ok) throw new Error();
        const next = await res.json();
        if (stop) return;
        setServer({ autoRefresh: next.autoRefresh, refreshHours: next.refreshHours, online: true });
        setCheckedAt(new Date());
        if (next.updatedAt !== last.current) {
          setData((prev) => {
            const before = new Map(prev.artists.map((a) => [a.id, a.listeners]));
            const d = {};
            for (const a of next.artists) {
              if (before.has(a.id) && before.get(a.id) !== a.listeners) d[a.id] = a.listeners - before.get(a.id);
            }
            setDeltas(d);
            return next;
          });
          last.current = next.updatedAt;
        }
      } catch {
        if (!stop) setServer((s) => ({ ...s, online: false }));
      }
    }
    const off = everyWhileVisible(poll, POLL_MS); // paused while the tab is hidden
    return () => {
      stop = true;
      off();
    };
  }, []);

  return { data, deltas, checkedAt, server };
}

export function timeAgo(date) {
  if (!date) return '—';
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
