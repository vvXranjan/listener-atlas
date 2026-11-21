import fs from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-server API (the same code runs as Vercel / Netlify functions in production):
//   GET  /api/live                        Spotify numbers (auto-refreshed in dev if APIFY_TOKEN is set)
//   GET  /api/cities?q=atl                city search suggestions
//   GET  /api/city?name=Atlanta&cc=US     what a city is playing (Apple Music city chart)
//   GET  /api/artist-info?name=...        bio (Wikipedia) + albums & songs (iTunes)
//   GET  /api/artist?name=...             any artist's Spotify numbers (needs APIFY_TOKEN)
//   GET  /api/now-playing                 songs people are playing right now (ListenBrainz)
//   POST /api/shazam  (audio/wav)         identify a song (open-source Shazam fingerprinter)
//   GET  /api/song-insights?title=&artists=a|b   where a song is charting + ListenBrainz plays
function devApi(env) {
  return {
    name: 'listener-atlas-api',
    async configureServer(server) {
      Object.assign(process.env, env); // make .env values visible to the shared handlers
      const { nodeHandler } = await import('./server/adapters.mjs');
      const { ROUTES } = await import('./server/handlers.mjs');
      const handlers = Object.fromEntries(ROUTES.map((r) => [r, nodeHandler(r)]));

      // Auto-refresh Spotify numbers in the background while developing
      const token = env.APIFY_TOKEN;
      const hours = Number(env.REFRESH_HOURS || 24);
      if (token && hours > 0) {
        const { refreshLive, LIVE_FILE } = await import('./scripts/fetch-data-lib.mjs');
        const run = () =>
          refreshLive(token)
            .then((r) => server.config.logger.info(`[live] refreshed ${r.count} artists at ${r.updatedAt}`))
            .catch((e) => server.config.logger.error(`[live] refresh failed: ${e.message}`));
        const age = Date.now() - new Date(JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8')).updatedAt).getTime();
        if (age > hours * 3600 * 1000) run();
        setInterval(run, hours * 3600 * 1000);
      }

      server.middlewares.use((req, res, next) => {
        const m = req.url.match(/^\/api\/([a-z-]+)/);
        if (!m) return next();
        const h = handlers[m[1]];
        if (!h) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ error: 'Unknown API route' }));
        }
        h(req, res).catch(next);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), devApi(env)],
    server: {
      // Spotify login only accepts http://127.0.0.1 (not "localhost") for local apps
      host: '127.0.0.1',
      port: 5173,
      watch: { ignored: ['**/src/data/live.json'] },
    },
    build: {
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          // split big map libraries so browsers can cache them separately
          manualChunks: {
            maplibre: ['maplibre-gl'],
            deck: ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/maplibre'],
            react: ['react', 'react-dom'],
          },
        },
      },
    },
  };
});
