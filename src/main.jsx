import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// /?jam=CODE opens the Jam page for friends (light: no globe, no Spotify login).
// Everything else opens the full app.
const jam = new URLSearchParams(location.search).get('jam');
const code = String(jam || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

const App = lazy(() => import('maplibre-gl/dist/maplibre-gl.css').then(() => import('./App.jsx')));
const JamGuest = lazy(() => import('./JamGuest.jsx'));

createRoot(document.getElementById('root')).render(
  <Suspense fallback={null}>{jam ? <JamGuest code={code} /> : <App />}</Suspense>
);
