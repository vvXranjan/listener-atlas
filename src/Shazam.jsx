import React, { useEffect, useRef, useState } from 'react';
import { togglePreview, usePlaying } from './player.js';

const SECONDS = 10;
const RATE = 16000;

// Record the microphone as 16 kHz mono WAV (works with the open-source Shazam fingerprinter)
async function recordWav(seconds, onLevel) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(d));
    let sum = 0;
    for (let i = 0; i < d.length; i += 16) sum += d[i] * d[i];
    onLevel(Math.min(1, Math.sqrt(sum / (d.length / 16)) * 6));
  };
  src.connect(proc);
  proc.connect(ctx.destination);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  proc.disconnect();
  src.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  const inRate = ctx.sampleRate;
  await ctx.close();

  // join + downsample to 16 kHz
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  const ratio = inRate / RATE;
  const out = new Int16Array(Math.floor(all.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const s = Math.max(-1, Math.min(1, all[Math.floor(i * ratio)]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  // WAV header
  const buf = new ArrayBuffer(44 + out.length * 2);
  const v = new DataView(buf);
  const str = (off, s) => [...s].forEach((ch, i) => v.setUint8(off + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + out.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, out.length * 2, true);
  new Int16Array(buf, 44).set(out);
  return new Blob([buf], { type: 'audio/wav' });
}

// "Shazam" button + listening screen + result card
export default function Shazam({ onArtist }) {
  const [state, setState] = useState('idle'); // idle | listening | thinking | result | nomatch | error
  const [left, setLeft] = useState(SECONDS);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const playing = usePlaying();
  const busy = useRef(false);

  async function start() {
    if (busy.current) return;
    busy.current = true;
    setResult(null);
    setError('');
    setState('listening');
    setLeft(SECONDS);
    const timer = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    try {
      const wav = await recordWav(SECONDS, setLevel);
      clearInterval(timer);
      setState('thinking');
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const r = await fetch(`/api/shazam?tz=${encodeURIComponent(tz)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wav,
      });
      if (!r.headers.get('content-type')?.includes('json')) {
        throw new Error('The data server is not running the new code. Run npm install, then npm run dev.');
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Shazam failed');
      if (!j.found) return setState('nomatch');
      setResult(j);
      setHistory((h) => [{ ...j, at: new Date() }, ...h].slice(0, 8));
      setState('result');
    } catch (e) {
      clearInterval(timer);
      setError(
        e.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in the browser address bar and try again.'
          : e.message
      );
      setState('error');
    } finally {
      busy.current = false;
      setLevel(0);
    }
  }

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && state !== 'listening' && setState('idle');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  return (
    <>
      <button className="shazam-fab" onClick={start} title="Identify the song playing near you">
        <span className="sz-logo">S</span>
        <span>Shazam</span>
      </button>

      {state !== 'idle' && (
        <div className="sz-wrap" onClick={() => state !== 'listening' && state !== 'thinking' && setState('idle')}>
          <div className="sz-card" onClick={(e) => e.stopPropagation()}>
            {(state === 'listening' || state === 'thinking') && (
              <div className="sz-listen">
                <div className="sz-orb" style={{ '--lvl': level }}>
                  <span className="sz-ring" />
                  <span className="sz-ring r2" />
                  <span className="sz-ring r3" />
                  <span className="sz-core">S</span>
                </div>
                <h2>{state === 'listening' ? 'Listening…' : 'Finding the song…'}</h2>
                <p className="muted">
                  {state === 'listening'
                    ? `Hold your Mac near the music · ${left}s`
                    : 'Matching the sound fingerprint with Shazam'}
                </p>
              </div>
            )}

            {state === 'result' && result && (
              <div className="sz-result">
                <div className="sz-bg" style={{ backgroundImage: result.cover ? `url(${result.cover})` : undefined }} />
                <div className="sz-inner">
                  {result.cover && (
                    <button className="sz-cover" onClick={() => togglePreview(result.preview)} disabled={!result.preview}>
                      <img src={result.cover} alt="" />
                      {result.preview && <span className="tr-play">{playing === result.preview ? '❚❚' : '▶'}</span>}
                    </button>
                  )}
                  <div className="sz-found">Song found</div>
                  <h2>{result.title}</h2>
                  <button className="sz-artist" onClick={() => onArtist({ name: result.artist })}>
                    {result.artist}
                  </button>
                  <div className="muted">
                    {[result.album, result.year, result.genre].filter(Boolean).join(' · ')}
                  </div>
                  <div className="d-actions center">
                    <button className="btn-green" onClick={() => onArtist({ name: result.artist })}>
                      Artist page
                    </button>
                    {result.shazamUrl && (
                      <a className="btn-ghost" href={result.shazamUrl} target="_blank" rel="noreferrer">
                        Shazam ↗
                      </a>
                    )}
                    {result.appleUrl && (
                      <a className="btn-ghost" href={result.appleUrl} target="_blank" rel="noreferrer">
                        Apple Music ↗
                      </a>
                    )}
                    {result.spotifyUri && (
                      <a className="btn-ghost" href={result.spotifyUri}>
                        Spotify
                      </a>
                    )}
                  </div>
                  <button className="link-btn" onClick={start}>
                    Shazam again
                  </button>
                </div>
              </div>
            )}

            {(state === 'nomatch' || state === 'error') && (
              <div className="sz-listen">
                <div className="sz-orb dim">
                  <span className="sz-core">S</span>
                </div>
                <h2>{state === 'nomatch' ? 'No match' : 'Something went wrong'}</h2>
                <p className="muted">
                  {state === 'nomatch' ? 'Try again closer to the speaker, with the music a bit louder.' : error}
                </p>
                <button className="btn-green" onClick={start}>
                  Try again
                </button>
              </div>
            )}

            {history.length > 1 && state !== 'listening' && state !== 'thinking' && (
              <div className="sz-history">
                <h3>Your Shazams</h3>
                {history.slice(1).map((h, i) => (
                  <div key={i} className="row">
                    <span>
                      <b>{h.title}</b> · {h.artist}
                    </span>
                    <span className="muted">{h.at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            )}

            {state !== 'listening' && state !== 'thinking' && (
              <button className="x" onClick={() => setState('idle')} aria-label="Close">
                ×
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
