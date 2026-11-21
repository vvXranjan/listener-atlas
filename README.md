# Listener Atlas

**A 3D globe of where the world listens to music on Spotify, plus a DJ toolkit for your own Spotify.**

Spin the Earth and see glowing bars over the cities where an artist's listeners are. Ask "what is Atlanta playing right now?". Connect your Spotify and Listener Atlas suggests the best next song for a smooth transition, measures tempo, key and energy, builds a set, and mixes it on your own Spotify with an Auto-DJ.

Built with React, MapLibre (globe), deck.gl (3D bars) and only free, open data sources.

---

## Contents

1. [What it does](#what-it-does)
2. [Quick start](#quick-start)
3. [Connect your Spotify](#connect-your-spotify)
4. [Feature guide](#feature-guide)
5. [How it works](#how-it-works)
6. [Smooth on every Mac](#smooth-on-every-mac)
7. [Real data and refreshing it](#real-data-and-refreshing-it)
8. [Settings (environment variables)](#settings-environment-variables)
9. [API routes](#api-routes)
10. [Project structure](#project-structure)
11. [Tests](#tests)
12. [Deploy (Vercel or Netlify)](#deploy-vercel-or-netlify)
13. [Troubleshooting](#troubleshooting)
14. [Privacy and limits](#privacy-and-limits)
15. [Credits](#credits)

---

## What it does

| Area | What you get |
| --- | --- |
| **Globe** | Satellite Earth with 3D terrain, live day/night shadow, starfield, autopilot tour of every country |
| **Artists** | Monthly listeners and top cities for 60+ artists as 3D bars; Spotify-style artist pages |
| **Cities** | "What is this city listening to?": live Top 25 chart for any big city, with previews |
| **Live now** | A ticker of songs people are playing right now (ListenBrainz) |
| **Shazam** | Name the song playing around you (10-second listen) |
| **Your Spotify** | Now playing, controls, seek bar, your library (liked songs, playlists, top, recent) |
| **Mix Lab** | Best next songs ranked by how smoothly they blend: tempo, key, energy and real listening data |
| **Your set + Auto-DJ** | Build a set, find its best order, and let Auto-DJ fade each song into the next on your Spotify; picks up songs you queue from your phone; radio mode keeps going |
| **Your habits** | Learns which songs you play after which (synced across devices) and ranks next songs with it |
| **Artist Galaxy** | An artist in the centre, their songs grouped by mood, similar artists grouped by genre, live sound effects |

---

## Quick start

Needs **Node 20+** (see `.nvmrc`).

```bash
cd ~/Projects/spotify-india-map
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Use `127.0.0.1`, not `localhost`: Spotify only allows this address for local apps.

Everything works without any keys. Two optional extras:

- An **Apify token** refreshes the Spotify listener numbers ([details](#real-data-and-refreshing-it)).
- A **Spotify Client ID** connects your own Spotify ([next section](#connect-your-spotify)).

---

## Connect your Spotify

Needs **Spotify Premium** (Spotify's rule for apps that control playback).

1. Open https://developer.spotify.com/dashboard and log in.
2. **Create app** (any name). In **Redirect URIs** add `http://127.0.0.1:5173/callback`. Tick **Web API** and **Web Playback SDK**.
3. Copy the **Client ID** into the app's "Connect your Spotify" box, or put it in `.env` as `VITE_SPOTIFY_CLIENT_ID`.
4. Click **Connect your Spotify** and approve.

**Permissions it asks for, and why:**

| Permission | Used for |
| --- | --- |
| Read playback state, currently playing | The Now Playing card, sync, Auto-DJ |
| Control playback | Play / pause / skip / seek, queue songs, fades |
| Streaming + email/private | **⇣ Play here** (the page becomes a Spotify device) |
| Library, playlists, top tracks, recently played | The **♥ Library** popup, "best next in my Liked Songs", and learning your habits |

If you connected before a feature was added, the app shows a **Reconnect** button for the missing permission.

Spotify keeps new apps in **development mode**: only you and up to 5 people you add under *User Management* can connect.

---

## Feature guide

### Globe, autopilot and artists

- **Live / Demo**: real Spotify numbers, or sample data with India state → city detail.
- **▶ Autopilot** flies country to country and shows that country's top artists and cities. Touch the map to take over.
- Search an artist, click a bar to open that city's chart, or use **Globe / Country / City** to change the view.
- **View artist page**: monthly listeners, followers, world rank, Spotify's player, where people listen, bio, discography.

### What is a city listening to?

Switch search to **🏙 City**, type a city, pick it. The globe flies there and shows its **Top 25 songs right now** (Apple Music city charts) with 30-second previews. Cities without a chart show their country's Top 100. Open charts re-check every 5 minutes and show ▲▼ moves.

### Live now and Shazam

- The **LIVE NOW** strip shows songs people are playing this minute (ListenBrainz, open source).
- **Shazam** listens for 10 seconds through your microphone and names the song. Only a fingerprint is sent, never the audio. Needs HTTPS when deployed.

### Now Playing card

- Song, cover, **seek bar** (click or drag to jump, ← → for 10 s), **⏮ ⏯ ⏭**, **+15**.
- **⇣ Play here**: moves your Spotify into the page, like choosing a speaker.
- **Pause my Spotify while I preview songs here**: when the app plays a preview, transition or effect, your Spotify pauses, then resumes by itself.
- **Follow my music on the globe**: the globe jumps to the listeners of whatever you play.

### Mix Lab: what should play next?

Open **✦ Mix Lab** on the Now Playing card or 🎛 Mix Lab in the bottom bar.

- **Best next songs**: songs real listeners play in the same session (ListenBrainz), each with a **blend score**:

  | Part | Weight | What it means |
  | --- | --- | --- |
  | Listening data | 45% | How often people play the two songs together |
  | Tempo | 25% | BPM match; half or double time counts (70 ≈ 140 BPM) |
  | Key | 20% | Camelot wheel: same key or a neighbour blends best |
  | Energy | 10% | A small lift feels good, a big drop doesn't |

- Chips show each song's **BPM**, **key** (e.g. `8A · Am`) and **energy**. Green = good match with the current song, yellow = close, red = clash.
- A **DJ tip** per song, e.g. "Nudge tempo 4% to match, keys blend smoothly."
- **▶ Hear the transition**: a 21-second preview of the crossfade, tempo-matched.
- **⇄ Mix into it on Spotify**: fades your real Spotify into that song.
- **♥ Find best next in my Liked Songs**: ranks your own liked songs as next picks.
- New or niche songs fall back to similar artists' hits, then the artist's own catalogue.

### Your set and Auto-DJ

Your set lives in Mix Lab, or pops out with **⧉ Float** / **⧉ Set**.

- **Add songs** by search (Spotify search when connected), from Mix Lab picks, or from your library (**♥ Liked · ☰ Playlists · ↺ Recent · ★ Top**).
- **Stays in sync**: played songs drop off into a **Played** list (↺ to add back), the next 3 show **NEXT 1/2/3**, and it's the same in every open tab.
- **Auto-fill to 3 up next** tops up the set with the best matches.
- **Keep Spotify's queue in sync** puts the next set song into your real Spotify queue in the **last 25 seconds** of the current song, so Spotify follows the set even without Auto-DJ, and changes you make before then still count (Spotify can't take songs back out of its queue).
- **Set flow** score and **✨ Best order**: tries every order (up to 8 songs) and suggests the smoothest.
- **🎧 Auto-DJ my set**: lets the current song play, then near its end fades it out and fades the next one in. Choose **Quick 4s / Smooth 7s / Long 11s** and **Skip intros**. **⇄ Mix to next now** mixes from wherever the song is. Click any set song to jump the mix there.
  - **Always follows your live set**: reorder, add or remove songs while it runs and the next mix uses the change.
  - **Stays on time in a background tab**: its clock runs in a Web Worker, which browsers don't slow down.
  - **Skips stray queue songs**: Spotify always plays its own queue first. If an old queued song starts right as your song ends, Auto-DJ skips it and plays your next set song (it shows "skipped N from queue").
  - **Never fights you**: pick a different song mid-way and Auto-DJ pauses; press **▶ Resume set** (or play a set song) to continue.
  - **Hears your phone**: queue a song in Spotify from your phone (or any device) while Auto-DJ runs and it **plays next** with a fade, joins the set tagged **📱 you queued**, then the set carries on. Songs that were already in your queue *before* Auto-DJ started count as old and are skipped. (Spotify lists your queued songs before the playlist's own next songs; Auto-DJ uses that to tell them apart.)
  - **Radio**: when the set runs out, it adds the best next song itself (your habits first, then recommendations, never a song you played in the last hour), tagged **🔁 habit** or **auto**. Turn it off with *Radio: keep going after the set*.
- **The floating window**: drag it anywhere, it snaps to edges and corners (◰ ◳ ◱ ◲), resizes from any edge, minimises (– or double-click), and includes a mini player.

> Spotify plays one song at a time per account, so transitions are smooth fades, not overlaps. For true overlap, turn on *Crossfade songs* in the Spotify app (Settings → Playback).

### Your habits (what you play after what)

The app learns your patterns from Spotify's **recently played** list (your last 50 songs, from every device), e.g. *Highest in the Room → No Pole, 6×*.

- Song pairs played within 30 minutes of each other count; recent habits count more (a habit from 2 months ago counts half).
- **Mix Lab** blends your habit into the score with **Your habits 25% · 50% · 75%** (more discovery ↔ mostly your patterns) and tags picks with **🔁 You play this after … (6×)**. Songs you usually play next are added as candidates even if the community data doesn't have them.
- **Auto-fill** and **radio** use the same blend.
- **♥ Library → 🔁 Your patterns** shows your top pairs, most-played songs and artists, **↻ Learn now** and **Clear my history**.
- **Synced across devices** through a free cloud database (below). Every request is checked against your Spotify login, so nobody else can read or change your habits. Without the database it saves in the browser instead.
- It learns while the app is open (on start, after each song change, every 10 minutes). If you play more than 50 songs between visits, the older ones in that gap are missed.

### Your Spotify library

**♥ Library**: Liked songs, Recently played, Your top (4 weeks / 6 months / all time) and Playlists. Click a cover to play from that song onward; **✦ Mix Lab**, **+ Set**, **+ Queue** on every row. Playlists made by Spotify (e.g. Daily Mix) may not open in development mode.

### Artist Galaxy

Click **✦ Galaxy** on an artist.

- The artist sits in the middle with their **genres** (MusicBrainz).
- **Inner orbit: their songs**, grouped by **mood** (Hype, Dark, Dreamy, Melodic, Chill). Bigger and closer = more played.
- **Outer orbit: similar artists**, grouped by **genre**. Closer = more fans in common. **Open their galaxy** to hop.
- Filter by mood or sound: **Heavy 808s, Spacey reverb, Hard drums, Bright, Murky, Half-time bounce**.
- Click a song for its sound meters (808s, reverb, brightness, punch, energy) and **▶ Play with effects**: Reverb, Slowed, Sped up, 8D, Bass boost, Lo-fi (combine them, e.g. slowed + reverb).

---

## How it works

```
Browser (React)                               Server (/api/*, same code on Vite, Vercel, Netlify)
───────────────                               ──────────────────────────────────────────────────
Globe: MapLibre + deck.gl bars                server/handlers.mjs  → one switch for every route
Audio analysis (Web Worker)  ── /api/audio ─▶ proxy for Apple's 30 s previews (Apple hosts only)
Spotify Web API + Playback SDK (direct)       server/recommend.mjs → ListenBrainz sessions, similar artists
Set / now-playing stores (localStorage)       server/galaxy.mjs    → top songs, similar artists, genres
                                              server/api.mjs       → Apple city charts, iTunes, Wikipedia
                                              server/live.mjs      → ListenBrainz live, Shazam
```

**Data sources (all free):**

| Source | Used for |
| --- | --- |
| Spotify (via Apify scraper) | Monthly listeners and top 5 cities per artist |
| Spotify Web API (your login) | Now playing, controls, library, search, queue |
| Apple Music city charts | "What is this city playing" |
| iTunes Search/Lookup | 30-second previews, covers, catalogue |
| ListenBrainz | Live listens, songs played together, similar artists, top songs, genres |
| MusicBrainz | Artist and song IDs |
| Wikipedia | Artist bios and photos |
| Shazam (via shazamio-core) | Song recognition |

**Audio analysis** (in your browser, from each 30-second preview):

- **Tempo**: spectral-flux onsets + autocorrelation (60–200 BPM, with a soft preference near 120).
- **Key**: chromagram matched to Krumhansl major/minor profiles, then shown on the Camelot wheel.
- **Energy**: loudness. **Sound**: bass share under 120 Hz (808s), how the sound rings between hits (reverb), spectral centre (brightness), hit strength (punch).
- **Mood** comes from simple rules over those numbers, so treat moods as good estimates.
- It measures the middle 15 seconds, runs in a background worker, two songs at a time (songs on screen first), and caches results in the browser.

---

## Smooth on every Mac

- **Only the moving parts redraw.** Bars, city labels, pins and the tooltip update on their own while the globe moves, so the panels, drawers and player don't re-render 60 times a second.
- **Fewer updates.** Bar sizes change in quarter-zoom steps; the "which side of the globe faces you" check runs about 6 times a second; labels update once per frame at most.
- **Adaptive quality.** The app measures its own frame rate while the globe moves. If it drops below ~38 fps it switches to **Smooth**:
  - sharpness is capped at 1.25× on Retina;
  - 3D terrain and relief shading are off;
  - the blur behind panels is replaced with solid glass;
  - a third of the stars are drawn, at 15 fps.
  
  It tries full quality again once after a calm minute; if it struggles again, it stays smooth. Pick it yourself with **⚡ Auto / ⚡ Smooth / ✨ Quality** in the bottom bar.
- **Background stars rest** when you're zoomed in and the globe covers the sky.
- **Background tabs are quiet.** Live data pauses in hidden tabs; Now Playing slows to every 15 s (so your set stays in sync) and refreshes the moment you return.
- **Panels load on demand.** Mix Lab, Galaxy, Library and the floating set download only when first opened.
- **Respects "Reduce motion"** in macOS settings.

---

## Real data and refreshing it

Spotify's public numbers are **monthly listeners (last 28 days)**, updated about once a day, and only each artist's **top 5 cities**. There is no public per-second or per-song "who is listening" feed.

1. Copy `.env.example` to `.env` and paste your Apify token (https://console.apify.com/settings/integrations).
2. Run:

Refresh once (~$0.21 for 60 artists):

```bash
npm run fetch-data
```

Or keep refreshing every 24 hours:

```bash
npm run fetch-data -- --watch
```

With a token in `.env`, the dev server also refreshes by itself every 24 hours (`REFRESH_HOURS` changes that), and the page checks for new numbers every minute, showing ▲▼ changes. Apify's free plan gives $5/month.

**Add artists:** add names to `artists.txt` and run `npm run fetch-data`, or search any name in the app (with a token, it's fetched live in ~10 s).

---

## Settings (environment variables)

Put these in `.env` locally, or in your host's environment settings. **Never commit `.env`.**

| Variable | Needed? | What it does |
| --- | --- | --- |
| `APIFY_TOKEN` | Optional | Fetch fresh Spotify listener numbers and look up new artists |
| `VITE_SPOTIFY_CLIENT_ID` | Optional | Your Spotify app's Client ID (or paste it in the app) |
| `REFRESH_HOURS` | Optional | How often the dev server refreshes numbers (default 24) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Optional | Cloud database for your habits (added automatically when you connect Upstash Redis in Vercel; `UPSTASH_REDIS_REST_URL` / `_TOKEN` also work) |
| `ANTHROPIC_API_KEY` | Optional | Lets Claude re-rank Mix Lab picks; works fine without |
| `ANTHROPIC_MODEL` | Optional | Model for the above (default `claude-haiku-5-5`) |
| `SONG_SCAN_BUDGET_MS` | Optional | Time limit for the city-chart scan in "Who's listening?" |

---

## API routes

All under `/api/`. Every outside request times out after 9 seconds, so nothing hangs.

| Route | Parameters | Returns |
| --- | --- | --- |
| `live` | — | Artist data (listeners, top cities) |
| `cities` | `q` | City suggestions |
| `city` | `name`, `cc` | A city's Top 25 chart with previews |
| `artist-info` | `name` | Wikipedia bio + iTunes info |
| `artist` | `name` | Spotify numbers for a new artist (needs `APIFY_TOKEN`) |
| `now-playing` | — | Live listens from ListenBrainz |
| `shazam` | POST fingerprint | Song match |
| `song-insights` | `title`, `artists` | City charts + ListenBrainz plays for a song |
| `recommend` | `title`, `artists` | Next-song picks and a ranked pool |
| `galaxy` | `name` | Songs, similar artists, genres for the Artist Galaxy |
| `song-search` | `q` | Songs with previews (Apple) |
| `preview` | `title`, `artist` | Best 30-second preview for a song |
| `audio` | `u` | Proxies an Apple preview file (Apple hosts only) |
| `habits` | GET / POST `{plays}` / DELETE, with `Authorization: Bearer <Spotify token>` | Your habits, saved under your Spotify account (503 = cloud not set up) |

---

## Project structure

```
src/
  App.jsx                 globe, autopilot, panels (big panels load on first open)
  GlobeLayers.jsx         3D bars, city labels, pins, tooltip (isolated for smoothness)
  perf.js                 adaptive quality (frame-rate watcher, Smooth / Quality)
  Starfield.jsx           space background
  NowPlaying.jsx          Spotify card, controls, seek bar
  MixLab.jsx              best next songs
  SetPanel.jsx            your set, best order, Auto-DJ controls
  FloatingSet.jsx         floating "Your set" window (FloatWindow.jsx + MiniPlayer.jsx)
  ArtistGalaxy.jsx        artist galaxy
  Library.jsx             your Spotify library
  audioAnalysis.js        tempo, key, energy, sound, blend score, best order
  analysisWorker.js       runs the analysis off the main thread
  spotify.js              Spotify login (PKCE), API calls, retries
  spotifyPlayer.js        Play here (Web Playback SDK), fades, auto-pause
  autoDj.js               Auto-DJ engine (phone-queue detection, radio)
  habitsCore.js           learns song pairs from your plays (shared with the server)
  habits.js               syncs your habits (cloud or browser), habit-aware scoring
  setStore.js, setSync.js the set, played history, live sync with Spotify
  nowStore.js             what's playing, shared across the app
  soundFx.js              live effects (Web Audio)
  mixPlayer.js, player.js transition preview, 30 s previews
  visibility.js           polling that pauses in background tabs
  Safe.jsx                keeps one broken panel from breaking the app
server/
  handlers.mjs            every /api route (shared by Vite, Vercel, Netlify)
  adapters.mjs            Node and Web request adapters, cache headers
  http.mjs                fetch with a time limit
  habits.mjs              /api/habits: Spotify-verified identity + Upstash Redis
  recommend.mjs, galaxy.mjs, song.mjs, api.mjs, live.mjs   data sources
api/[route].js            one Vercel function for every /api route (free plan allows 12)
netlify/functions/api.mjs one Netlify function for all routes
scripts/                  refresh Spotify numbers via Apify
tests/                    Vitest tests
```

---

## Tests

Run the 84 tests:

```bash
npm test
```

Run the tests plus a production build:

```bash
npm run check
```

The tests cover API routes, recommendations and fallbacks, audio analysis (tempo, key, sound, best order), Auto-DJ, auto-pause, set sync, the floating window, Galaxy layout, polling and adaptive quality. CI runs tests and a build on every push (`.github/workflows/ci.yml`).

---

## Deploy (Vercel or Netlify)

Both work out of the box, and the `/api/*` routes run as serverless functions sharing `server/handlers.mjs`.

1. Push to GitHub (include `package-lock.json`, never `.env`).
2. **Vercel**: New Project → import the repo → Deploy (settings from `vercel.json`: one function for all API routes, 30 s limit, cache and security headers).
   **Netlify**: Add new site → import the repo → Deploy (settings from `netlify.toml`).
3. Add environment variables on the host if you use them (`APIFY_TOKEN`, `VITE_SPOTIFY_CLIENT_ID`, …).
4. In your Spotify app settings, add a second Redirect URI: `https://<your-site>/callback`.
5. **Cloud habits (optional, free):** in Vercel open the project → **Storage** → **Create Database** → **Upstash Redis** (free plan) → connect it to the project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` by itself. **Redeploy**. To use it locally too, copy those two values into your `.env`.
6. For fresh numbers, add `APIFY_TOKEN` as a GitHub Actions secret: `.github/workflows/refresh-data.yml` refreshes every 2 days and commits, which redeploys (~$3/month, inside Apify's free $5).

**Production checklist**

- [ ] `npm run check` passes
- [ ] `.env` is not committed (it's in `.gitignore`)
- [ ] Spotify Redirect URI for the live site is added
- [ ] Friends who should connect are added under *User Management* in the Spotify dashboard
- [ ] Netlify only: functions time out at 10 s by default; heavy routes return partial results and finish on the next open

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "This site can't be reached" | The dev server isn't running: `npm run dev` in the project folder |
| 404 / a different app on 5173 | Another project uses the port. Stop it, or run `lsof -ti :5173 \| xargs kill`, then `npm run dev` |
| Spotify login fails on `localhost` | Open **http://127.0.0.1:5173** instead |
| "Data server not running the new code" | Restart: Ctrl+C, then `npm run dev` (server code loads on start) |
| "No Spotify device is on" | Open Spotify on your Mac or phone, or press **⇣ Play here** |
| "Reconnect Spotify …" | A newer feature needs one more permission: click Reconnect |
| "Spotify Premium is needed" | Playback control and Play here need Premium |
| A song I didn't expect played instead of my set | It was in your Spotify queue from before (Spotify plays its queue first). Auto-DJ now skips these automatically; without Auto-DJ, clear your queue in the Spotify app |
| Vercel: "No more than 12 Serverless Functions" | Fixed: all routes share one function, `api/[route].js` |
| "Your patterns" says *saved in this browser* | The cloud database isn't connected: see Deploy step 5 |
| A song I queued on my phone didn't play next | Auto-DJ must be running; it checks your queue every ~3 s. Songs queued *before* starting Auto-DJ count as old |
| Feels laggy | Set **⚡ Smooth** in the bottom bar, close other heavy tabs |
| Galaxy shows few similar artists | Open data is thin for that artist; it fills in when MusicBrainz is less busy |
| Safari: Play here doesn't start | Safari may block Spotify's web player; the app still controls your Mac or phone Spotify |

---

## Privacy and limits

- Your Spotify login stays in your browser (PKCE; no secret, no server storage). Disconnect any time.
- Your set, played history, analysis cache and window position are stored in your browser only.
- Shazam sends only an audio fingerprint, not your audio.
- Spotify does not share who is listening to a song or live per-song counts, so the app shows the closest public signals instead.
- Tempo, key, mood and sound come from 30-second previews: close estimates, not studio data.

---

## Credits

Open data and tools: ListenBrainz and MusicBrainz (MetaBrainz Foundation), Apple Music / iTunes public endpoints, Wikipedia, OpenFreeMap, Esri World Imagery, AWS Terrain Tiles (Mapzen), MapLibre GL, deck.gl, shazamio-core (MIT), Apify. Spotify is a trademark of Spotify AB; this project is not affiliated with Spotify.
