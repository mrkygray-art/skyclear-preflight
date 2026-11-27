// NMS-API adapter: token manager + requests. Credentials come from env vars (NMS_CLIENT_ID, NMS_CLIENT_SECRET,
// NMS_ENV) and are never logged; every error message goes through scrub(). Verified against staging 2026-11-27:
// - classification=FDC alone returns a bare JSON array of features (not a content link) in staging; a
//   data.url content link (/v1/content/{token}, gzip, 5 min life) is also handled in case production differs.
// - classification=DOMESTIC&feature=AIRSPACE returns ~1,500 notices nationwide in {status, data:{geojson}}.
// - lastUpdatedDate=<ISO> returns notices changed since then (active and inactive).
const zlib = require("zlib");

const HOSTS = { staging: "https://api-staging.cgifederal-aim.com", production: "https://api-nms.aim.faa.gov" };
class NmsError extends Error { constructor(msg, status) { super(msg); this.status = status || 0; } }

function config(env = process.env) {
  const name = String(env.NMS_ENV || "staging").trim();
  if (!HOSTS[name]) throw new NmsError("NMS_ENV must be staging or production");
  const id = String(env.NMS_CLIENT_ID || "").trim(), secret = String(env.NMS_CLIENT_SECRET || "").trim();
  if (!id || !secret) throw new NmsError("NMS credentials are not configured");
  return { env: name, host: HOSTS[name], id, secret };
}

function makeSource(cfg, deps = {}) {
  const fetchImpl = deps.fetch || fetch, now = deps.now || Date.now, sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const gap = cfg.env === "staging" ? 1100 : 0; // staging allows 1 request per second
  let tok = null, tokExp = 0, lastCall = 0;
  const scrub = (s) => { let t = String(s); for (const x of [cfg.id, cfg.secret, tok]) if (x) t = t.split(x).join("[redacted]"); return t; };

  async function pace() { const w = lastCall + gap - now(); if (w > 0) await sleep(w); lastCall = now(); }

  async function token(force) {
    if (!force && tok && now() < tokExp) return tok;
    await pace();
    let r;
    try {
      r = await fetchImpl(cfg.host + "/v1/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(cfg.id + ":" + cfg.secret).toString("base64") },
        body: "grant_type=client_credentials", signal: AbortSignal.timeout(15000),
      });
    } catch (e) { throw new NmsError("NMS token request failed (" + (e.name === "TimeoutError" ? "timed out" : "network error") + ")"); }
    if (!r.ok) throw new NmsError("NMS token HTTP " + r.status, r.status);
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw new NmsError("NMS token response had no access token");
    tok = j.access_token;
    tokExp = now() + Math.max(60, (+j.expires_in || 1799) - 120) * 1000; // refresh about 2 min early
    return tok;
  }

  async function body(r) {
    const b = Buffer.from(await r.arrayBuffer());
    const txt = b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b).toString("utf8") : b.toString("utf8");
    try { return JSON.parse(txt); } catch { throw new NmsError("NMS returned something that is not JSON (HTTP " + r.status + ")", r.status); }
  }

  // GET with bearer; on 401 refresh the token once and retry once. 408/429/5xx throw with the status.
  async function get(pathQs, retried) {
    const t = await token(false);
    await pace();
    let r;
    try {
      r = await fetchImpl(cfg.host + "/nmsapi" + pathQs, { headers: { Authorization: "Bearer " + t, nmsResponseFormat: "GEOJSON", Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
    } catch (e) { throw new NmsError("NMS request failed (" + (e.name === "TimeoutError" ? "timed out" : "network error") + ")"); }
    if (r.status === 401 && !retried) { tok = null; await token(true); return get(pathQs, true); }
    if (!r.ok) throw new NmsError("NMS HTTP " + r.status + (r.status === 429 ? " (rate limited)" : ""), r.status);
    const j = await body(r);
    const url = j && j.data && typeof j.data.url === "string" ? j.data.url : null;
    if (url) return get(url.replace(/^\/nmsapi/, ""), retried); // content link: same bearer, may be gzip
    return j;
  }

  // Normalise the two response forms to {status, data:{geojson:[...]}} for parse.parseResponse.
  const env = (j) => (Array.isArray(j) ? { status: "Success", data: { geojson: j } } : j);
  return {
    env: cfg.env,
    scrub,
    async bootstrap() {
      const fdc = env(await get("/v1/notams?classification=FDC"));
      const dom = env(await get("/v1/notams?classification=DOMESTIC&feature=AIRSPACE"));
      return [fdc, dom];
    },
    async delta(sinceIso) { return [env(await get("/v1/notams?lastUpdatedDate=" + encodeURIComponent(sinceIso)))]; },
    async point(lat, lon, radiusNM) { return [env(await get("/v1/notams?latitude=" + lat + "&longitude=" + lon + "&radius=" + radiusNM))]; },
    _token: token,
  };
}

module.exports = { makeSource, config, NmsError, HOSTS };
