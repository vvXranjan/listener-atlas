import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getClientId,
  saveClientId,
  isValidClientId,
  login,
  logout,
  isLoggedIn,
  handleCallback,
  currentlyPlaying,
  onRightHost,
  moveToRightHost,
  redirectUri,
  canQueue,
  pausePlayback,
  resumePlayback,
  nextTrack,
  previousTrack,
} from './spotify.js';
import { setNow } from './nowStore.js';
import { useSpotifyPlayer, togglePlayHere, autoPauseOn, setAutoPause, ensureDevice, seekHere } from './spotifyPlayer.js';
import { everyWhileVisible } from './visibility.js';
import ArtistLink from './ArtistLink.jsx';
import { openLyrics, openAmbient } from './LyricsView.jsx';
import { useCoverColor } from './lyricsCore.js';
import { useSpotifyQueue } from './setSync.js';
import { resumeOnOpen, resumeOn, setResumeOn } from './resume.js';

const POLL_MS = 2500; // what's playing: every 2.5 s while you look
const mmss = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Your Spotify, live: shows the song you're playing and lets you dig into who listens to it.
export default function NowPlaying({ onSongChange, onDetails, onMixLab, onLibrary, onShowOnGlobe, follow, setFollow }) {
  const [connected, setConnected] = useState(isLoggedIn());
  const [np, setNp] = useState(null);
  const [error, setError] = useState('');
  const [notAllowed, setNotAllowed] = useState(false); // logged in, but not on the app's Spotify list
  const [setup, setSetup] = useState(false);
  const [clientId, setClientId] = useState(getClientId());
  const [, tick] = useState(0);
  const sdk = useSpotifyPlayer();
  const [autoPause, setAutoPauseState] = useState(autoPauseOn());
  const [ctlErr, setCtlErr] = useState('');
  const [scrub, setScrub] = useState(null); // 0..1 while dragging the progress bar
  const tint = useCoverColor(np?.track?.cover); // widget colour from the album cover
  const [resume, setResume] = useState(resumeOn);
  const [tapFor, setTapFor] = useState(null); // song waiting for your first tap (no Spotify app open)

  // opened or refreshed: start your last song again
  useEffect(() => {
    if (!connected) return;
    const t = setTimeout(() => {
      resumeOnOpen({ onNeedTap: setTapFor })
        .then((r) => (r === 'played' || r === 'resumed') && window.dispatchEvent(new CustomEvent('spotify-changed')))
        .catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [connected]);
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
        setNotAllowed(false);
        setNp(r);
        setNow({
          track: r?.track || null,
          playing: !!r?.playing,
          progressMs: r?.progressMs || 0,
          fetchedAt: Date.now(),
        });
        const id = r?.track?.id || null;
        if (id && id !== lastId.current) {
          lastId.current = id;
          onChange.current?.(r.track);
        }
      } catch (e) {
        if (stop) return;
        if (e.notAllowed) {
          setNotAllowed(true);
          setError('');
          return;
        }
        setError(e.message);
        if (!isLoggedIn()) setConnected(false);
      }
    }
    // every 2.5 s while you look; every 15 s in a background tab (keeps your set in sync)
    const off = everyWhileVisible(poll, POLL_MS, 15000);
    // Spotify changed song (Auto-DJ, your phone) or you came back to the tab: look right away
    let soonT = null;
    const soon = () => {
      clearTimeout(soonT);
      soonT = setTimeout(poll, 500);
    };
    window.addEventListener('spotify-changed', soon);
    window.addEventListener('focus', soon);
    const p = setInterval(() => !document.hidden && tick((n) => n + 1), 1000); // smooth progress bar
    return () => {
      stop = true;
      off();
      clearInterval(p);
      clearTimeout(soonT);
      window.removeEventListener('spotify-changed', soon);
      window.removeEventListener('focus', soon);
    };
  }, [connected]);

  async function control(fn) {
    setCtlErr('');
    try {
      await fn();
      window.dispatchEvent(new CustomEvent('spotify-changed'));
    } catch (e) {
      setCtlErr(e.message);
    }
  }

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

  if (notAllowed) {
    return (
      <div className="np np-blocked">
        <div className="np-head">
          <span className="np-tag">
            <SpotifyIcon /> Almost there
          </span>
          <button
            className="np-logout"
            onClick={() => {
              logout();
              setConnected(false);
              setNotAllowed(false);
            }}
          >
            Disconnect
          </button>
        </div>
        <b className="np-blocked-title">Spotify hasn't let your account in yet</b>
        <p className="muted">
          This app is in Spotify's test mode, so only accounts the owner adds can play music here. Send the owner the <b>email of your Spotify account</b>, then
          connect again.
        </p>
        <p className="muted">Meanwhile, everything else works: the globe, Artist Galaxy, genres, albums, search and 30 s previews.</p>
        <button
          className="btn-ghost sm"
          onClick={() => {
            logout();
            setConnected(false);
            setNotAllowed(false);
          }}
        >
          Try connecting again
        </button>
      </div>
    );
  }

  const tr = np?.track;
  const progress = tr ? Math.min(tr.durationMs, np.progressMs + (np.playing ? Date.now() - np.fetchedAt : 0)) : 0;

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

      {!tr && (
        <div className="muted np-idle">
          Play something on Spotify (phone, Mac or speaker) and it will show here.{' '}
          <button className="link-btn" onClick={onLibrary}>
            ♥ Open my library
          </button>
        </div>
      )}

      {tr && (
        <div className="npw" style={tint ? { '--tint': tint } : undefined}>
          <div className="npw-top">{tr.cover ? <img key={tr.id} src={tr.cover} alt="" className="npw-cover" /> : <span className="npw-cover ph" />}</div>
          <a key={tr.id} href={tr.url} target="_blank" rel="noreferrer" className="npw-title" title={tr.name}>
            {tr.name}
          </a>
          <div className="npw-artists">
            {tr.artists.map((a, i) => (
              <span key={a.name + i}>
                {i > 0 && ', '}
                <ArtistLink name={a.name} />
              </span>
            ))}
          </div>
          <div
            className={`np-bar npw-bar seek ${scrub != null ? 'scrubbing' : ''}`}
            role="slider"
            tabIndex={0}
            aria-label="Song position"
            aria-valuemin={0}
            aria-valuemax={Math.round(tr.durationMs / 1000)}
            aria-valuenow={Math.round(progress / 1000)}
            title="Click or drag to jump"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const bar = e.currentTarget;
              const rect = bar.getBoundingClientRect();
              const at = (x) => Math.max(0, Math.min(1, (x - rect.left) / rect.width));
              bar.setPointerCapture?.(e.pointerId);
              let f = at(e.clientX);
              setScrub(f);
              const move = (ev) => {
                f = at(ev.clientX);
                setScrub(f);
              };
              const up = () => {
                bar.removeEventListener('pointermove', move);
                bar.removeEventListener('pointerup', up);
                bar.removeEventListener('pointercancel', up);
                const ms = f * tr.durationMs;
                setNp((cur) => (cur ? { ...cur, progressMs: ms, fetchedAt: Date.now() } : cur)); // show it right away
                setScrub(null);
                control(() => seekHere(ms));
              };
              bar.addEventListener('pointermove', move);
              bar.addEventListener('pointerup', up);
              bar.addEventListener('pointercancel', up);
            }}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowRight' ? 10000 : e.key === 'ArrowLeft' ? -10000 : 0;
              if (!step) return;
              e.preventDefault();
              const ms = Math.max(0, Math.min(tr.durationMs - 1000, progress + step));
              setNp((cur) => (cur ? { ...cur, progressMs: ms, fetchedAt: Date.now() } : cur));
              control(() => seekHere(ms));
            }}
          >
            <div
              style={{
                width: `${((scrub != null ? scrub * tr.durationMs : progress) / tr.durationMs) * 100}%`,
              }}
            />
            <i
              className="np-knob"
              style={{
                left: `${((scrub != null ? scrub * tr.durationMs : progress) / tr.durationMs) * 100}%`,
              }}
            />
          </div>
          <div className="np-time npw-time">
            <span>{mmss(scrub != null ? scrub * tr.durationMs : progress)}</span>
            <span>{mmss(tr.durationMs)}</span>
          </div>
          {canQueue() && (
            <div className="npw-ctl">
              <button aria-label="Previous" onClick={() => control(() => previousTrack())}>
                <PrevIcon />
              </button>
              <button
                className="npw-main"
                aria-label={np?.playing ? 'Pause' : 'Play'}
                onClick={() => control(async () => (sdk.active ? togglePlayHere() : np?.playing ? pausePlayback() : resumePlayback(await ensureDevice())))}
              >
                {np?.playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button aria-label="Next" onClick={() => control(() => nextTrack())}>
                <NextIcon />
              </button>
            </div>
          )}
        </div>
      )}

      {tr && canQueue() && (
        <UpNext
          onSkip={(n) =>
            control(async () => {
              for (let i = 0; i < n; i++) await nextTrack();
            })
          }
        />
      )}

      {tr && (
        <>
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
            <button className="btn-ghost sm" onClick={openLyrics}>
              🎤 Lyrics
            </button>
            <button className="btn-ghost sm" onClick={openAmbient} title="Full-screen lyrics over moving scenes">
              🌊 Scenes
            </button>
            <button className="btn-ghost sm" onClick={onLibrary}>
              ♥ Library
            </button>
          </div>
          <label className="np-follow">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            Follow my music on the globe
          </label>
        </>
      )}

      {canQueue() && (
        <div className="np-player">
          <label className="np-follow">
            <input
              type="checkbox"
              checked={autoPause}
              onChange={(e) => {
                setAutoPause(e.target.checked);
                setAutoPauseState(e.target.checked);
              }}
            />
            Pause my Spotify while I preview songs here
          </label>
          <label className="np-follow">
            <input
              type="checkbox"
              checked={resume}
              onChange={(e) => {
                setResume(e.target.checked);
                setResumeOn(e.target.checked);
              }}
            />
            Keep playing my last song when I open the site
          </label>
          {tapFor && <div className="np-tap">▶ Click anywhere to keep playing “{tapFor}”</div>}
          {(ctlErr || sdk.error) && <div className="status err">{ctlErr || sdk.error}</div>}
        </div>
      )}
      {error && <div className="status err">{error}</div>}
    </div>
  );
}

// ---------- widget bits ----------
const PrevIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
    <path d="M11.5 6v12L3 12l8.5-6Zm9.5 0v12l-8.5-6L21 6Z" fill="currentColor" />
  </svg>
);
const NextIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
    <path d="M12.5 6v12L21 12l-8.5-6ZM3 6v12l8.5-6L3 6Z" fill="currentColor" />
  </svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <rect x="6" y="4.5" width="4" height="15" rx="1.3" fill="currentColor" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.3" fill="currentColor" />
  </svg>
);
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" />
  </svg>
);

// One small "up next" widget, tinted by its cover
function UpNextCard({ t, n, onSkip }) {
  const tint = useCoverColor(t.cover);
  return (
    <button className="npw-mini" style={tint ? { '--tint': tint } : undefined} onClick={() => onSkip(n)} title={`Skip to "${t.title}"`}>
      {t.cover ? <img src={t.cover} alt="" /> : <span className="ph" />}
      <b>{t.title}</b>
      <small>{t.artist}</small>
    </button>
  );
}

// The next songs in your Spotify queue, as widgets you can tap to skip to
function UpNext({ onSkip }) {
  const q = useSpotifyQueue(true);
  const items = (q?.queue || []).slice(0, 6);
  if (!items.length) return null;
  return (
    <div className="npw-next">
      <div className="npw-next-h">Up next on Spotify</div>
      <div className="npw-row">
        {items.map((t, i) => (
          <UpNextCard key={`${t.uri}|${i}`} t={t} n={i + 1} onSkip={onSkip} />
        ))}
      </div>
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
        {clientId.trim() && !isValidClientId(clientId) && (
          <div className="status err">That doesn't look like a Client ID: it should be 32 letters and numbers (not the Client Secret).</div>
        )}
        <button className="btn-spotify" disabled={!isValidClientId(clientId)} onClick={onSave}>
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
