import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useJam, startJam, endJam, jamLink } from './jam.js';
import { useAutoDj } from './autoDj.js';

const isLocal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

// Host a Jam: a QR code friends scan to add songs to what's playing
export default function JamPanel({ onClose }) {
  const jam = useJam();
  const dj = useAutoDj();
  const [name, setName] = useState(() => localStorage.getItem('jam-host-name') || '');
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const link = jam.jam ? jamLink(jam.jam.code) : '';

  useEffect(() => {
    if (!link) return setQr('');
    QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [link]);

  async function start() {
    const host = name.trim() || 'Jam';
    try {
      localStorage.setItem('jam-host-name', name.trim());
    } catch {
      /* storage blocked */
    }
    await startJam(host).catch(() => {});
  }
  async function share() {
    const text = `Join my Jam on Listener Atlas: add songs to what's playing 🎶`;
    if (navigator.share) return navigator.share({ title: 'Join my Jam', text, url: link }).catch(() => {});
    await navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="gn-wrap" onClick={onClose}>
      <aside className="gn-panel jam-panel" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Close">
          ×
        </button>
        <header className="gn-head">
          <div className="ml-kicker">
            <span className="spark">✦</span> JAM
          </div>
          <h2>{jam.jam ? `${jam.jam.host}'s Jam` : 'Start a Jam'}</h2>
          <div className="muted">Friends scan the code and add songs from their phone. No Spotify login needed. Their songs play next, in the order they're added.</div>
        </header>

        <div className="gn-body-scroll">
          {!jam.jam ? (
            <section className="jam-start">
              <label className="jam-label" htmlFor="jam-host">
                Your name (friends see it)
              </label>
              <input id="jam-host" className="jam-input" maxLength={24} placeholder="e.g. Vaibhav" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && start()} />
              <button className="btn-green jam-go" disabled={jam.busy} onClick={start}>
                {jam.busy ? 'Starting…' : '🎉 Start Jam'}
              </button>
              {!dj.on && <div className="muted jam-note">Tip: keep Auto-DJ on. It's what plays your friends' songs next.</div>}
            </section>
          ) : (
            <>
              <section className="jam-qr-wrap">
                <div className="jam-qr" aria-label="QR code to join the Jam" dangerouslySetInnerHTML={{ __html: qr }} />
                <div className="jam-code-box">
                  <div className="muted">Code</div>
                  <div className="jam-code">{jam.jam.code}</div>
                  <div className="jam-guests">
                    👥 {jam.guests} {jam.guests === 1 ? 'friend' : 'friends'} joined
                  </div>
                  <div className="jam-actions">
                    <button className="btn-green sm" onClick={share}>
                      {copied ? '✓ Link copied' : navigator.share ? '↗ Share link' : '⧉ Copy link'}
                    </button>
                    <button className="btn-ghost sm" onClick={() => endJam()}>
                      ■ End Jam
                    </button>
                  </div>
                </div>
              </section>
              {isLocal() && (
                <div className="ml-livestep err">Phones can't open "localhost". Open the Jam from your live site (Vercel) so friends can scan it.</div>
              )}
              {!dj.on && <div className="ml-livestep">Auto-DJ is off, so friends' songs wait in your set. Turn Auto-DJ on to play them next.</div>}
              {jam.error && <div className="ml-livestep err">{jam.error}</div>}

              <h3 className="ml-h">Added by friends</h3>
              {jam.added.length ? (
                <ul className="jam-list">
                  {jam.added.map((a) => (
                    <li key={a.id}>
                      {a.cover ? <img src={a.cover} alt="" /> : <span className="jam-noart">♪</span>}
                      <div className="jam-t">
                        <b>{a.title}</b>
                        <small>{a.artist}</small>
                      </div>
                      <span className="jam-by">🎉 {a.by}</span>
                      <small className="muted">{ago(a.at)}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="muted">Nothing yet. Songs appear here a few seconds after a friend adds them.</div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
