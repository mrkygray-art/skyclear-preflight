# SkyClear Pre-Flight

Drone pilot pre-flight clearance web app for Ky (Part 107 student, Southern California). On open it asks for device GPS and falls back to the LAX preset. Never put Ky's home city in public text or as the app default. Static site plus one serverless function. No framework, no build step on Vercel.

## Deploy (live since 2026-11-25)
- Live: https://skyclear-preflight.vercel.app (Vercel team PowerQuote, slug `power-quote`, project `skyclear-preflight`). Public repo: https://github.com/mrkygray-art/skyclear-preflight (not connected to Vercel; pushing does not deploy).
- Deploy from the repo root: `python3 src/build.py` then `npx vercel deploy --prod --yes --scope power-quote`.
- Verify after deploy: `/api/wx?path=metar&ids=KLAX&format=json` returns `rawOb`; `/api/wx?path=taf&ids=KLAX&format=json` returns `rawTAF`; the site shows LIVE WEATHER, the LA, SF and San Diego charts, and no console errors.
- Do not add env vars, keys or analytics.
- Public docs: SkyClear is on Ky's portfolio (after PC Medic), Ask Ky and the GitHub profile README, NOT on the resume. Keep them in step with notable changes. Never put Ky's home city or email in public text.

## Layout
- `index.html`: BUILT file. Do not hand-edit; edit `src/` then run `python3 src/build.py`.
- `src/core.js` data and logic (airports, decoders, sun times); `src/ui.js` UI, map, loading; `src/template.html` shell and CSS.
- `api/geo.js`: address lookup relay (added 2026-11-25). OpenStreetMap Nominatim first (US only, limit 5, generic app User-Agent, no keys; usage policy = low volume, cache, show "© OpenStreetMap contributors"), then the US Census geocoder. Merges matches within ~200 m. In the UI: `#addr` + `#find` in the location bar, `#addrlist` for several matches, `setLoc(...,"address",label,{geoSrc})`; the Position check stays a caution for address lookups. The Census geocoder misplaced "200 N Spring St" onto S Spring St in testing, which is why OpenStreetMap goes first.
- `api/wx.js`: relay to NOAA aviationweather.gov (browsers cannot call it directly: no CORS). Only `metar` and `taf` allowed; app calls `/api/wx?path=...`.
- `s/` San Francisco sectional tiles, `d/` San Diego TAC tiles (`{z}/{x}/{y}.webp`, 512px, Leaflet `zoomOffset:-1`), `chart-basin.jpg` LA basin overlay. Charts were georeferenced from FAA PDFs Ky supplied; do not regenerate.
- `leaflet.js`/`leaflet.css`: Leaflet 1.9.4, local copies.
- `favicon.ico`: drone-and-sky icon (added 2026-11-25).
- Tabs: Pre-flight, LAANC, Requirements (LAANC = `#laanc`, `laancHTML()` in `src/ui.js`). LAANC tab lists Aloft Air Control and Airspace Link AirHub Portal (contacts verified on their own sites 2026-11-25; Aloft publishes no phone, so none is shown). Its `#laanc2` field mirrors the Pre-flight `#laanc` field (`S.laanc`).
- Installable app (PWA, 2026-11-25): `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`; registration at the end of `src/ui.js`. The service worker is network-first for the app shell only and must NEVER cache `/api/` or other sites (weather must be live or labeled SAMPLE). Bump `CACHE` in `sw.js` if the shell list changes.
- Pilot/drone/Remote ID fields (`PROFILE_KEYS`) save to localStorage `skyclear.profile.v1` on this device only and refill on load; "Clear saved info" button removes them. The LAANC number is per flight and is NOT saved. The LAANC tab shows the saved profile read-only (`#laancprof`).

## Rules and context
- Source of truth for airspace is the FAA charts Ky supplies. Never invent airspace, frequencies or altitudes; show "not confirmed" when unknown (e.g., LAANC grid ceiling).
- Weather shows labeled SAMPLE data when the relay fails; never present sample data as live.
- Base map is Esri World Street Map (OSM public tiles are blocked). Keep attribution.
- Known gaps: central California between LA and SF charts is street tiles only; airport/ring/tower data covers Southern California only; TFR/NOTAM not read yet.
- Ky is a visual learner and a physical-security estimator, not a developer: explain changes in plain language, show screenshots where possible.
- Git: commit only when Ky asks.

## Next work
1. Live-weather polish ("last updated" time per METAR, stations from the pilot's location).
2. San Diego and NorCal airport data.
3. TFR/NOTAM source and LAANC grid ceiling.
4. Fill the central California chart gap.
