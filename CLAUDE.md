# SkyClear Pre-Flight

Drone pilot pre-flight clearance web app for Ky (Part 107 student, Southern California). Static site plus small serverless functions on Vercel. No framework, no build step on Vercel.

**Live:** https://skyclear-preflight.vercel.app (Vercel team `power-quote`, project `skyclear-preflight`). **Code:** public repo https://github.com/mrkygray-art/skyclear-preflight (not connected to Vercel; pushing does not deploy). Working copy: `C:\Users\mrkyg\projects\skyclear-preflight`. The old `Downloads\skyclear-deploy` folder holds the original download: never deploy from it, it would roll the live app back.

## How to work
- `index.html` is a BUILT file. Edit `src/core.js`, `src/ui.js`, `src/template.html`, then run `python3 src/build.py`. Never hand-edit `index.html`.
- After each task: run the app locally, check the browser console for errors, take a screenshot, then `npx vercel deploy --scope power-quote` (preview). Deploy to production (`npx vercel deploy --prod --scope power-quote`) only after Ky has seen and approved the preview. (Port 8765 is Ky's PC Medic; use another port or open the built file directly.)
- Commit to git only when Ky asks. No env vars, API keys or analytics unless a task says so and Ky agrees.
- Ky is a visual learner and a physical-security estimator, not a developer. Explain changes in plain language and show screenshots.
- Public: SkyClear is on Ky's portfolio (project 16, after PC Medic), Ask Ky and the GitHub profile README, NOT the resume. When a change ships to production, keep those in step. Never put Ky's home city or email in the app default or any public text.

## Rules that never bend
- Never invent airspace, frequencies, altitudes, ceilings or restrictions. If a source can't be reached or a value is unknown, show "not confirmed / not checked" in amber. Never show green or GO on missing data.
- Sample data must stay clearly labeled SAMPLE and never look live.
- Airspace source of truth is the FAA charts Ky supplies plus official FAA data. Every new data source: verify the endpoint actually returns data before building on it, and say so if it can't be verified.
- Safety logic must fail toward caution: unknown = caution or hold, never pass.
- The app is a self-certified pre-flight aid and record. It does not replace LAANC authorization, FAA charts or the pilot's own judgment. Keep that wording on the record card.
- Keep the map attribution (Esri base, FAA charts) and "© OpenStreetMap contributors" on address results.

## Layout
- `src/core.js` data and logic (AIRPORTS, PRESETS, decoders, sun times, ring sizes); `src/ui.js` UI, checks, map, data loading; `src/template.html` shell and CSS.
- `api/wx.js` relay to aviationweather.gov (METAR/TAF JSON; browsers can't call it directly, no CORS). Pattern for any new relay: whitelist paths and parameters, validate characters, short cache header, return clear errors, never forward arbitrary URLs.
- `api/geo.js` address lookup relay: OpenStreetMap Nominatim first (US only, limit 5, generic app User-Agent, no keys), then the US Census geocoder (it misplaced "200 N Spring St" onto S Spring St in testing, so it is only the fallback). Merges matches within ~200 m. UI: `#addr` + `#find`, `#addrlist` pick list, `setLoc(...,"address",label,{geoSrc})`.
- Location: on open the app asks for device GPS (`DEV_FIXED_LOCATION=false`) and falls back to the first preset, LAX. Presets end with Hawthorne; it is never the default. The preset menu shows "Custom location" for GPS, address, pin and typed positions.
- Tabs (hash routes): Pre-flight, LAANC (`#laanc`, `laancHTML()`), Requirements (with FAA offices reference). The LAANC tab lists Aloft Air Control and Airspace Link AirHub Portal (contacts checked on their own sites 2026-11-25; Aloft publishes no phone, so none is shown); its `#laanc2` field mirrors the Pre-flight `#laanc` field (`S.laanc`).
- Pilot/drone/Remote ID fields (`PROFILE_KEYS`) are saved in localStorage `skyclear.profile.v1` on the device only, with a "Clear saved info" button. The LAANC number is per flight and not saved.
- Installable app (PWA): `manifest.webmanifest`, `sw.js`, `favicon.ico`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`. The service worker is network-first for the app shell only and must never cache `/api/` or other sites. Bump `CACHE` in `sw.js` if the shell list changes.
- `s/` San Francisco sectional tiles, `d/` San Diego TAC tiles (`{z}/{x}/{y}.webp`, 512 px, Leaflet `zoomOffset:-1`), `chart-basin.jpg` LA basin overlay, `leaflet.js`/`leaflet.css` (Leaflet 1.9.4). Charts were georeferenced (Lambert Conformal Conic) from FAA PDFs; see "Chart work" below.
- `docs/images/` README screenshots.

## Roadmap (do in this order, one at a time, preview after each)

### 1. Fix the GPS rule
Problem: on a desktop the browser location is Wi-Fi/network based (about ±73 m), and `src/ui.js` (search "GPS position", around line 86) fails anything over 50 m, which forces NO-GO. Ky saw "NO-GO, 1 blocking condition: gps position" at HHR on his computer.
Change:
- Poor accuracy alone must not block. Rule: pass if accuracy is small compared with the distance to the nearest airspace boundary or ring edge; caution (amber) if the accuracy circle could cross a boundary or ring edge; fail only if the position is missing or older than a few minutes.
- Desktop or low accuracy message: "Approximate location. Drop a pin on your launch spot." Make the drop-pin path (source `manual`) a pass when the pilot confirms the pin.
- Keep showing the accuracy value on the record card.
Done when: Hawthorne on desktop at ±73 m shows caution with the pin hint, not NO-GO; a ±10 m phone fix passes; a fix within accuracy of a ring edge shows caution.

### 2. Show the real LAANC grid ceiling
Status 2026-11-25: `loadAll` in `src/ui.js` already queries the ArcGIS FeatureServer layer `FAA_UAS_FacilityMap_Data` (field `CEILING`) and the live app showed 100 ft near Hawthorne and 0 ft at LAX. Still to do: confirm this is the official FAA UAS Data Delivery service and its fields, and the rest of this item.
Do:
- Find the official FAA UAS Data Delivery / UAS Facility Map service, call it for a known point (for example 33.9420, -118.4080 near LAX and 33.902, -118.367 near HHR), and confirm fields and values before coding.
- Test whether the browser can call it (CORS). If not, add `api/laanc.js` relay following the `api/wx.js` pattern, taking `lat` and `lon` only (validate numbers and range).
- Show the grid ceiling in the banner (Fly up to = min(400, grid ceiling)), record card and checklist. Value 0 means no automatic LAANC: show "Needs further coordination / not available via LAANC" in red.
- If the service fails, keep "Ceiling not confirmed" (amber). Never assume 400.
Done when: Hawthorne and a point near LAX return a real ceiling, the banner uses it, and failure mode still shows not confirmed.

### 3. TFR and NOTAM checks
A live restriction can make a clear map wrong.
- TFRs: use the official FAA TFR list (tfr.faa.gov). Verify what machine-readable feed exists and its CORS behavior; relay as `api/tfr.js` if needed. Check whether the pilot's position (and a 3 to 5 mile search radius) intersects any active TFR polygon or circle; show type, effective times and altitude limits.
- NOTAMs: the official FAA NOTAM API may need registration and a key. Do not build around a key without asking Ky. If keyless access is not available, add a clear "NOTAMs: check before flight" row with a direct link to the FAA NOTAM Search and the FAA TFR page, marked as not checked by the app, and say so to Ky.
- New check rows: "TFR" (pass only when the feed was reached and nothing intersects; caution if unreachable; fail if inside an active TFR) and "NOTAMs" as above.
Done when: a known active TFR (find one, or test with a mocked sample clearly labeled test-only) triggers the row, and an unreachable feed shows not checked.

### 4. "Last updated" on each METAR and a timestamp on the record
- `S.wx.obs[station]` holds the NOAA JSON (`obsTime` in epoch seconds, `reportTime`, plus `temp`, `wdir`, `wspd`, `visib`, `altim`, `fltCat`). Show observation time (UTC and local) and age ("34 min ago") beside each METAR, and the TAF issue time if available.
- Age rules: over 75 minutes old = amber "stale"; over 2 hours = red.
- Record card: add a fetch timestamp for each data source (weather, airspace, ground elevation, TFR) in UTC and local, plus the existing 60 minute validity.
Done when: each station shows observed time and age, a stale test (mocked) turns amber, and the record lists source timestamps.

### 5. San Diego and NorCal data, and the central California chart gap
- Airports: add San Diego area (SAN, MYF, NZY, SDM, CRQ, OKB, NRS, and others the chart shows) and Northern California (SFO, OAK, SJC, and others on the San Francisco chart) to `AIRPORTS` in `src/core.js`: class, ring size, tower/ATIS frequency, elevation. Take frequencies and airspace only from the FAA charts Ky supplied (San Francisco and San Diego TAC PDFs) or official FAA sources; ask Ky to re-upload the PDFs if needed. If a value can't be confirmed, leave it out and mark it unknown. Do not guess.
- Make sure the nearest-airport list, weather station choice and rings use the new data and the Around-you view works near SAN and SFO.
- Central California gap (about 34.5 to 36 N between the LA overlay and the San Francisco chart): street tiles only. Fix by cutting the full Los Angeles sectional (ask Ky to upload `Los_Angeles_1.pdf` again) into a tile pyramid `l/{z}/{x}/{y}.webp`, same method as `s/` and `d/` (Lambert Conformal Conic, standard parallels read from the chart note, least-squares fit on graticule crossings, validate with known airports, RMS under about 3 px at 100 dpi). The Vercel deployment has no 512 file limit (that limit applied only to the old preview).
Done when: pin near SAN and near SFO shows correct airspace, frequencies and weather stations, and the map shows chart coverage across California between LA and SF.

### 6. Deep links to LAANC providers
Status 2026-11-25: the LAANC tab already has Aloft and AirHub request guides and the authorization-number field. Still to do: buttons on the Pre-flight screen when LAANC is needed, and the full FAA provider list.
- When airspace is controlled (LAANC needed), show a "File LAANC" section with buttons that open FAA-approved LAANC USS providers in a new tab. Use only providers listed on the FAA LAANC page (https://www.faa.gov/uas/getting_started/laanc) and only URLs you have checked load. Candidates from the FAA list include Airspace Link, Aloft, AutoPylot, Avision, Flightloop, UASidekick (confirm the current list first).
- Links open the provider's own site or app page. Do not put the pilot's name, registration or other personal data in URLs. Pass at most a location only if the provider officially supports it.
- Keep the existing field where the pilot enters the LAANC authorization number, and record it on the card.
Done when: buttons appear only when LAANC is needed, each link was checked, and entering an authorization number updates the status and record.

## Chart work (reference)
Chart PDFs Ky has supplied: Los Angeles sectional (LA basin crop in `chart-basin.jpg`), San Francisco sectional, San Diego TAC. Tools used before: Python with numpy and OpenCV, `pdftoppm`, Playwright for screenshots. There is no pyproj; the Lambert math is hand-written. Tiles are webp quality about 68 with alpha edge tiles.

## Known gaps (until the roadmap is done)
Central California is street tiles only; airport, ring and tower data covers Southern California only; TFR/NOTAM not read; LAANC grid ceiling source not yet verified as official; the GPS rule blocks on desktop.
