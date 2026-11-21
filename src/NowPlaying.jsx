import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getClientId,
  saveClientId,
  login,
  logout,
  isLoggedIn,
  handleCallback,
  currentlyPlaying,
  onRightHost,
  moveToRightHost,
  redirectUri,
} from './spotify.js';

const POLL_MS = 5000;
const mmss = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Your Spotify, live: shows the song you're playing and lets you dig into who listens to it.
export default function NowPlaying({ onSongChange, onDetails, onMixLab, onShowOnGlobe, follow, setFollow }) {
  const [connected, setConnected] = useState(isLoggedIn());
  const [np, setNp] = useState(null);
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  const [clientId, setClientId] = useState(getClientId());
  const [, tick] = useState(0);
  const lastId = useRef(null);
  const onChange = useRef(onSongChange);
  onChange.current = onSongChange;

  // finish login when Spotify sends us back
  useEffect(() => {
    handleCallback()
      .then((auth) => auth && setConnected(true))
      .catch((e) => setError(e.message));
  }, []);

  // poll what's playing
  useEffect(() => {
    if (!connected) return;
    let stop = false;
    async function poll() {
      try {
        const r = await currentlyPlaying();
        if (stop) return;
        setError('');
        setNp(r);
        const id = r?.track?.id || null;
        if (id && id !== lastId.current) {
          lastId.current = id;
          onChange.current?.(r.track);
        }
      } catch (e) {
        if (stop) return;
        setError(e.message);
        if (!isLoggedIn()) setConnected(false);
      }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    const p = setInterval(() => tick((n) => n + 1), 1000); // smooth progress bar
    return () => {
      stop = true;
      clearInterval(t);
      clearInterval(p);
    };
  }, [connected]);

  async function connect() {
    if (!onRightHost()) return moveToRightHost();
    if (!getClientId()) return setSetup(true);
    try {
      await login();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!connected) {
    return (
      <div className="np np-connect">
        <button className="btn-spotify" onClick={connect}>
          <SpotifyIcon /> Connect your Spotify
        </button>
        <div className="muted">See who else listens to what you're playing.</div>
        {error && <div className="status err">{error}</div>}
        {setup && (
          <SetupModal
            clientId={clientId}
            setClientId={setClientId}
            onClose={() => setSetup(false)}
            onSave={async () => {
              saveClientId(clientId);
              setSetup(false);
              try {
                await login();
              } catch (e) {
                setError(e.message);
              }
            }}
          />
        )}
      </div>
    );
  }

  const tr = np?.track;
  const progress = tr
    ? Math.min(tr.durationMs, np.progressMs + (np.playing ? Date.now() - np.fetchedAt : 0))
    : 0;

  return (
    <div className="np">
      <div className="np-head">
        <span className="np-tag">
          <SpotifyIcon /> {np?.playing ? 'Now playing' : tr ? 'Paused' : 'Spotify connected'}
        </span>
        <button
          className="np-logout"
          onClick={() => {
            logout();
            setConnected(false);
            setNp(null);
          }}
        >
          Disconnect
        </button>
      </div>

      {!tr && <div className="muted np-idle">Play something on Spotify (phone, Mac or speaker) and it will show here.</div>}

      {tr && (
        <>
          <div className="np-row">
            {tr.cover && <img src={tr.cover} alt="" className={np.playing ? 'spin' : ''} />}
            <div className="np-text">
              <a href={tr.url} target="_blank" rel="noreferrer" className="np-title">
                {tr.name}
              </a>
              <div className="np-artists">{tr.artists.map((a) => a.name).join(', ')}</div>
            </div>
          </div>
          <div className="np-bar">
            <div style={{ width: `${(progress / tr.durationMs) * 100}%` }} />
          </div>
          <div className="np-time muted">
            <span>{mmss(progress)}</span>
            <span>{mmss(tr.durationMs)}</span>
          </div>
          <div className="np-actions">
            <button className="btn-green sm" onClick={() => onMixLab(tr)}>
              ✦ Mix Lab: what's next?
            </button>
            <button className="btn-ghost sm" onClick={() => onDetails(tr)}>
              Who's listening?
            </button>
            <button className="btn-ghost sm" onClick={() => onShowOnGlobe(tr)}>
              Show on globe
            </button>
          </div>
          <label className="np-follow">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            Follow my music on the globe
          </label>
        </>
      )}
      {error && <div className="status err">{error}</div>}
    </div>
  );
}

function SetupModal(props) {
  // rendered at page level so the side panel can't clip it
  return createPortal(<SetupModalInner {...props} />, document.body);
}

function SetupModalInner({ clientId, setClientId, onSave, onClose }) {
  return (
    <div className="sz-wrap" onClick={onClose}>
      <div className="setup" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>
          <SpotifyIcon /> Connect Spotify (one-time, 2 minutes)
        </h2>
        <ol>
          <li>
            Open{' '}
            <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
              developer.spotify.com/dashboard
            </a>{' '}
            and log in with your Premium account.
          </li>
          <li>
            Click <b>Create app</b>. Any name works (e.g. "Listener Atlas").
          </li>
          <li>
            In <b>Redirect URIs</b>, paste exactly:
            <code>{redirectUri()}</code>
          </li>
          <li>
            Tick <b>Web API</b>, accept the terms, and save.
          </li>
          <li>
            Copy the <b>Client ID</b> from the app's settings and paste it below.
          </li>
        </ol>
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Paste your Client ID" />
        <button className="btn-spotify" disabled={clientId.trim().length < 20} onClick={onSave}>
          Save &amp; connect
        </button>
        <p className="muted">
          The app only asks to <b>see what you're playing</b>. No password is shared, and you can disconnect anytime.
        </p>
      </div>
    </div>
  );
}

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style={{ verticalAlign: '-3px' }}>
      <circle cx="12" cy="12" r="12" fill="#1ed760" />
      <path
        d="M17.5 16.3a.75.75 0 0 1-1 .25c-2.8-1.7-6.3-2.1-10.4-1.2a.75.75 0 1 1-.33-1.46c4.5-1 8.4-.56 11.5 1.36.35.21.46.67.24 1.05Zm1.5-3.3a.94.94 0 0 1-1.3.31c-3.2-2-8.1-2.5-11.9-1.4a.94.94 0 1 1-.54-1.8c4.3-1.3 9.7-.7 13.4 1.6.44.27.58.85.31 1.3Zm.13-3.4C15.3 7.3 8.9 7.1 5.2 8.2a1.1 1.1 0 1 1-.65-2.15c4.3-1.3 11.3-1.05 15.7 1.55a1.1 1.1 0 1 1-1.13 1.95Z"
        fill="#000"
      />
    </svg>
  );
}
