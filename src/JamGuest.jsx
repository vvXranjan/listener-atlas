import { useEffect, useRef, useState } from 'react';

// The page friends open by scanning the Jam QR code (on their phone, no Spotify login).
// They see what's playing and what's next, and add songs that play after the current one.

const POLL_MS = 4000;
const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k) || '';
    } catch {
      return '';
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  },
};
function guestId() {
  let id = store.get('jam-guest-id');
  if (!id) {
    id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9-]/g, '');
    store.set('jam-guest-id', id);
  }
  return id;
}

export default function JamGuest({ code }) {
  const [jam, setJam] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState(() => store.get('jam-name'));
  const [draft, setDraft] = useState(name);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState({}); // song key -> 'busy' | 'ok' | error text
  const [toast, setToast] = useState('');
  const me = useRef(guestId());

  // the Jam, every few seconds
  useEffect(() => {
    let stop = false;
    let t;
    const load = async () => {
      try {
        const r = await fetch(`/api/jam?code=${encodeURIComponent(code)}&guest=${me.current}`, { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (stop) return;
        if (!r.ok) {
          setError(j.error || 'Could not open this Jam');
          if (r.status === 404 || r.status === 400) return; // ended or wrong code: stop asking
        } else {
          setJam(j);
          setError('');
        }
      } catch {
        if (!stop) setError('No connection. Retrying…');
      }
      if (!stop) t = setTimeout(load, document.hidden ? POLL_MS * 3 : POLL_MS);
    };
    load();
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [code]);

  // song search (Apple's catalogue, through our API)
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let stop = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/song-search?q=${encodeURIComponent(term)}`);
        const j = await r.json();
        if (!stop) setResults(Array.isArray(j) ? j : []);
      } catch {
        if (!stop) setResults([]);
      } finally {
        if (!stop) setSearching(false);
      }
    }, 350);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const keyOf = (s) => `${s.title}|${s.artist}`.toLowerCase();
  async function add(s) {
    const k = keyOf(s);
    setStatus((m) => ({ ...m, [k]: 'busy' }));
    try {
      const r = await fetch('/api/jam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', code, guest: me.current, name, song: { title: s.title, artist: s.artist, cover: s.cover, preview: s.preview } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not add it');
      setStatus((m) => ({ ...m, [k]: 'ok' }));
      setToast(`✓ "${s.title}" added. It plays after the current song.`);
      setJam((cur) => (cur ? { ...cur, waiting: [...(cur.waiting || []), { id: j.added.id, by: name, title: s.title, artist: s.artist, cover: s.cover }] } : cur));
    } catch (e) {
      setStatus((m) => ({ ...m, [k]: e.message }));
    }
  }

  function saveName(e) {
    e?.preventDefault();
    const n = draft.trim().slice(0, 24);
    if (!n) return;
    store.set('jam-name', n);
    setName(n);
  }

  if (error && !jam) {
    return (
      <div className="jg">
        <div className="jg-center">
          <div className="jg-logo">🎉</div>
          <h1>Jam</h1>
          <p className="muted">{error}</p>
          <p className="muted">Ask the host for a new QR code.</p>
        </div>
      </div>
    );
  }
  if (!jam) {
    return (
      <div className="jg">
        <div className="jg-center">
          <div className="jg-logo spin">🎉</div>
          <p className="muted">Joining the Jam…</p>
        </div>
      </div>
    );
  }

  const hostAway = Date.now() - (jam.hostSeenAt || 0) > 60000;
  const queue = [...(jam.waiting || []).filter((w) => !(jam.next || []).some((n) => keyOf(n) === keyOf(w))), ...(jam.next || [])];

  return (
    <div className="jg">
      <header className="jg-head">
        <div>
          <div className="jg-kicker">🎉 JAM · {jam.code}</div>
          <h1>{jam.host}'s Jam</h1>
        </div>
        <div className="jg-guests">👥 {jam.guests}</div>
      </header>

      {!name ? (
        <form className="jg-card jg-name" onSubmit={saveName}>
          <b>What's your name?</b>
          <span className="muted">Everyone sees who added which song.</span>
          <div className="jg-row">
            <input autoFocus maxLength={24} placeholder="Your name" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button className="btn-green" disabled={!draft.trim()}>
              Join
            </button>
          </div>
        </form>
      ) : (
        <>
          <section className={`jg-card jg-now ${jam.now?.playing ? 'playing' : ''}`}>
            {jam.now?.cover ? <img src={jam.now.cover} alt="" /> : <div className="jg-noart">♪</div>}
            <div className="jg-t">
              <small>{jam.now ? (jam.now.playing ? 'NOW PLAYING' : 'PAUSED') : 'NOTHING PLAYING YET'}</small>
              <b>{jam.now?.title || 'Waiting for the host'}</b>
              <span>{jam.now?.artist || 'Add a song to get things going'}</span>
              {jam.now?.by && <em>🎉 added by {jam.now.by}</em>}
            </div>
            {jam.now?.playing && (
              <div className="jg-eq" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            )}
          </section>
          {hostAway && <div className="jg-warn">The host's app hasn't checked in for a minute. Songs you add will play once it's back.</div>}

          <section className="jg-search">
            <input type="search" placeholder="🔍  Add a song: search title or artist" value={q} onChange={(e) => setQ(e.target.value)} />
            {searching && <div className="muted jg-hint">Searching…</div>}
            {results.length > 0 && (
              <ul className="jg-list">
                {results.map((s) => {
                  const st = status[keyOf(s)];
                  return (
                    <li key={keyOf(s)}>
                      {s.cover ? <img src={s.cover} alt="" /> : <span className="jg-noart sm">♪</span>}
                      <div className="jg-t">
                        <b>{s.title}</b>
                        <span>{s.artist}</span>
                        {st && st !== 'ok' && st !== 'busy' && <em className="err">{st}</em>}
                      </div>
                      <button className={`jg-add ${st === 'ok' ? 'done' : ''}`} disabled={st === 'busy' || st === 'ok'} onClick={() => add(s)} aria-label={`Add ${s.title}`}>
                        {st === 'ok' ? '✓' : st === 'busy' ? '…' : '+'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h2 className="jg-h">Up next</h2>
            {queue.length ? (
              <ul className="jg-list">
                {queue.map((s, i) => (
                  <li key={`${keyOf(s)}-${i}`}>
                    {s.cover ? <img src={s.cover} alt="" /> : <span className="jg-noart sm">♪</span>}
                    <div className="jg-t">
                      <b>{s.title}</b>
                      <span>{s.artist}</span>
                    </div>
                    {s.by && <span className={`jg-by ${s.by === name ? 'me' : ''}`}>{s.by === name ? 'you' : s.by}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="muted">Nothing queued. Be the first to add a song!</div>
            )}
          </section>
          <p className="muted jg-foot">
            Playing as <b>{name}</b> ·{' '}
            <button className="jg-link" onClick={() => setName('')}>
              change name
            </button>
          </p>
        </>
      )}
      {toast && <div className="jg-toast">{toast}</div>}
    </div>
  );
}
