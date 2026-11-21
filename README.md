# Listener Atlas — Spotify listeners on a 3D globe

A spinning 3D Earth with bars for where people listen to an artist on Spotify.
Autopilot flies country to country and shows the top artists in each place.

## Run it

```bash
cd ~/Projects/spotify-india-map
npm install
npm run dev
```

Open http://localhost:5173

## Modes

- **Live**: real Spotify numbers (monthly listeners + each artist's top 5 cities) for 59 artists.
- **Demo**: made-up numbers, but with full India state → city detail.
- **Autopilot** (▶ in the bottom bar): tours every country in the data and shows an "In view" card
  with that country's top artists and cities. Touch the map to take over.

## Search a city — "What is Atlanta listening to?"

Switch the search box to **🏙 City**, type a city, pick it. The globe flies there and a card shows
that city's **Top 25 songs** right now (Apple Music city charts, free, no key), with 30-second
previews you can play. If a city has no chart (e.g. Jaipur) it shows the country's Top 100.
You can also click any bar on the globe to open that city's chart.
The open chart re-checks every 5 minutes and shows ▲▼ moves.

## Live now + Shazam

- **LIVE NOW strip** (top): songs people are playing at this moment, from ListenBrainz
  (open-source, MetaBrainz Foundation). Updates every 10 seconds. Click a song to open the artist.
- **Shazam button** (right side): listens through your Mac's microphone for 10 seconds and
  names the song, using the open-source `shazamio-core` fingerprinter (MIT) and Shazam's
  recognition service. Only the fingerprint is sent, not the audio.

## Connect your Spotify (Premium)

See the song you're playing, then tap **Who's listening?** for the closest public signals:
each artist's monthly listeners and top cities, which big-city charts the song is in right now
(gold pins on the globe), and ListenBrainz play counts. Turn on **Follow my music** and the
globe jumps to the listeners of whatever you play.

One-time setup (2 minutes):
1. Go to https://developer.spotify.com/dashboard and log in (Premium needed for developer apps).
2. Create an app. Redirect URI: `http://127.0.0.1:5173/callback`. Tick **Web API**.
3. Copy the **Client ID** into the app's "Connect your Spotify" box (or `.env` as `VITE_SPOTIFY_CLIENT_ID`).
4. Open the app at http://127.0.0.1:5173 (Spotify doesn't allow "localhost").

Spotify never shares who is listening to a song or live per-song counts, so those are not shown.

## Globe detail

Satellite photos + 3D terrain (mountains) + relief shading, sharp OpenStreetMap labels and
borders, and a real-time day/night shadow that moves with the sun.

## Artist pages

Click ⓘ next to an artist (or "View artist page"). You get a Spotify-style page:
monthly listeners, followers, world rank, Spotify's own playable "Popular" player,
where people listen, bio (Wikipedia), discography (iTunes).

## Real data

Spotify's public numbers are **monthly listeners (last 28 days)**, updated about once a day.
There is no true second-by-second "live" feed. Spotify only shows each artist's **top 5 cities**.

### Refresh the numbers

1. Copy `.env.example` to `.env` and paste your Apify token
   (https://console.apify.com/settings/integrations).
2. Run:

```bash
npm run fetch-data              # refresh once (~$0.21 for 60 artists)
npm run fetch-data -- --watch   # refresh every 24 hours
```

With a token in `.env`, the dev server also refreshes by itself every 24 hours
(change with `REFRESH_HOURS=12` in `.env`), and the page checks for new numbers every minute,
showing ▲▼ changes. Apify's free plan gives $5/month, enough for a daily refresh of ~45 artists.

### Add artists

- Add names to `artists.txt`, then `npm run fetch-data`.
- Or search any name in the app. With a token in `.env`, it is fetched live (~10 s, ~$0.0035).

## Files

- `src/App.jsx` – globe, bars, labels, autopilot, panels
- `src/data/live.json` – real artist data (made by the scripts)
- `src/countries.js` – country names, flags, camera zoom
- `src/data.js`, `src/geo.js` – demo (sample) data for India
- `scripts/fetch-data.mjs` – pulls fresh data from Spotify via Apify
- `scripts/normalize.mjs` – cleans records, adds city coordinates offline
- `server/live.mjs` – live listens (ListenBrainz) + song recognition (Shazam)
- `server/api.mjs` – free sources: Apple Music city charts, iTunes previews, Wikipedia bios
- `vite.config.js` – dev-server API: `/api/live`, `/api/cities`, `/api/city`, `/api/artist-info`, `/api/artist`
- `src/CityCard.jsx`, `src/CitySearch.jsx`, `src/ArtistDrawer.jsx` – city chart, city search, artist page

## Tests

```bash
npm test        # 25 tests: API routes, Apple chart parsing, Shazam fingerprinting, day/night maths, data checks
npm run check   # tests + production build
```

## Deploy (Vercel or Netlify)

Both work out of the box. The `/api/*` features run as serverless functions
(`api/*.js` on Vercel, `netlify/functions/api.mjs` on Netlify), sharing `server/handlers.mjs`.

1. Push to GitHub (include `package-lock.json`, never `.env`):
   ```bash
   git init && git add . && git commit -m "Listener Atlas" && git branch -M main
   git remote add origin https://github.com/<you>/listener-atlas.git && git push -u origin main
   ```
2. **Vercel**: New Project → import the repo → Deploy (settings come from `vercel.json`).
   **Netlify**: Add new site → import the repo → Deploy (settings come from `netlify.toml`).
3. Optional environment variables on the host:
   - `APIFY_TOKEN` – look up any new artist's Spotify numbers
   - `VITE_SPOTIFY_CLIENT_ID` – your Spotify app's Client ID (or paste it in the app)
4. Spotify login on the live site: in your Spotify app settings add a second Redirect URI,
   `https://<your-site>/callback`. Spotify keeps new apps in development mode: only you and up to
   5 people you add under **User Management** can connect.
5. Fresh numbers: add `APIFY_TOKEN` as a GitHub Actions secret. `.github/workflows/refresh-data.yml`
   refreshes the data every 2 days and commits it, which redeploys the site (~$3/month, inside
   Apify's free $5).

Notes
- Shazam needs HTTPS for the microphone (any Vercel/Netlify URL is HTTPS).
- Function time limits: Vercel allows up to 30 s here; Netlify's default is 10 s, so the
  song city-chart scan returns what it finished in 8 s and fills in the rest on the next open.
- `CI` workflow runs tests + build on every push.
