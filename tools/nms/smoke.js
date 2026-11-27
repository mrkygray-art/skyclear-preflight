// NMS-API smoke test (Ky's SKYCLEAR_NMS brief, step 2). Gets a token from the FAA NOTAM Management Service
// and runs a few /v1/notams queries for a test point, then saves the responses as fixtures and prints a summary
// of the real field names. Credentials come from .env.local (git-ignored) and are NEVER printed or saved.
//   node tools/nms/smoke.js [lat] [lon] [radiusNM]
// Staging allows 1 request per second, so calls are spaced 1.2 s apart.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
function loadEnv() {
  const f = path.join(ROOT, ".env.local");
  if (!fs.existsSync(f)) { console.error("Missing .env.local in " + ROOT + " (NMS_CLIENT_ID, NMS_CLIENT_SECRET, NMS_ENV)."); process.exit(1); }
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();
const ENV = (process.env.NMS_ENV || "staging").trim();
const HOSTS = { staging: "https://api-staging.cgifederal-aim.com", production: "https://api-nms.aim.faa.gov" };
if (!HOSTS[ENV]) { console.error("NMS_ENV must be staging or production"); process.exit(1); }
const ID = (process.env.NMS_CLIENT_ID || "").trim(), SECRET = (process.env.NMS_CLIENT_SECRET || "").trim();
if (!ID || !SECRET) { console.error("NMS_CLIENT_ID or NMS_CLIENT_SECRET is empty in .env.local"); process.exit(1); }
const SECRETS = [ID, SECRET];
// Anything printed or saved goes through scrub(), so a credential or token can never leak into output or fixtures.
let TOKEN = "";
const scrub = (s) => { let t = String(s); for (const x of [...SECRETS, TOKEN]) if (x) t = t.split(x).join("[redacted]"); return t; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(ROOT, "tools/tests/fixtures/nms");

async function token() {
  const r = await fetch(HOSTS[ENV] + "/v1/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(ID + ":" + SECRET).toString("base64") },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15000),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error("token HTTP " + r.status + ": " + scrub(txt).slice(0, 300));
  const j = JSON.parse(txt);
  if (!j.access_token) throw new Error("token response has no access_token; keys: " + Object.keys(j).join(", "));
  TOKEN = j.access_token;
  console.log("token OK (" + ENV + "), expires_in " + j.expires_in + " s, type " + (j.token_type || "?"));
}

async function get(pathQs, name) {
  const url = HOSTS[ENV] + "/nmsapi" + pathQs;
  const t0 = Date.now();
  const r = await fetch(url, { headers: { Authorization: "Bearer " + TOKEN, nmsResponseFormat: "GEOJSON", Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  const txt = await r.text();
  console.log("\nGET " + pathQs + "\n  HTTP " + r.status + " in " + (Date.now() - t0) + " ms, " + txt.length + " bytes, " + (r.headers.get("content-type") || ""));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name + ".json"), scrub(txt));
  let j; try { j = JSON.parse(txt); } catch { console.log("  not JSON: " + scrub(txt).slice(0, 200)); return null; }
  if (!r.ok) { console.log("  error: " + scrub(JSON.stringify(j)).slice(0, 400)); return j; }
  return j;
}

// Print the shape of a JSON value (keys and types), a few levels deep, so real field names can be read before writing code.
function shape(v, depth = 0, max = 5) {
  const pad = "  ".repeat(depth + 2);
  if (Array.isArray(v)) return "array[" + v.length + "]" + (v.length && depth < max ? "\n" + pad + "[0]: " + shape(v[0], depth + 1, max) : "");
  if (v && typeof v === "object") return depth >= max ? "{…}" : "{\n" + Object.entries(v).map(([k, x]) => pad + k + ": " + shape(x, depth + 1, max)).join("\n") + "\n" + "  ".repeat(depth + 1) + "}";
  return typeof v + (typeof v === "string" ? ' "' + v.slice(0, 60).replace(/\s+/g, " ") + (v.length > 60 ? "…" : "") + '"' : " " + v);
}
function features(j) {
  const d = j && (j.data || j);
  const fc = d && (d.geojson || d);
  return (fc && Array.isArray(fc.features)) ? fc.features : Array.isArray(d) ? d : [];
}
function summarize(j) {
  if (!j) return;
  console.log("  top level: " + shape(j, 0, 2));
  const fs_ = features(j);
  console.log("  NOTAMs: " + fs_.length);
  if (!fs_.length) return;
  console.log("  first NOTAM shape: " + shape(fs_[0], 0, 6));
  const by = {};
  for (const f of fs_) {
    const n = f.properties && f.properties.coreNOTAMData && f.properties.coreNOTAMData.notam || {};
    const k = (n.classification || "?") + " / " + (n.featureType || n.feature || "?");
    by[k] = (by[k] || 0) + 1;
  }
  console.log("  by classification / feature: " + JSON.stringify(by));
  for (const f of fs_.slice(0, 8)) {
    const n = f.properties && f.properties.coreNOTAMData && f.properties.coreNOTAMData.notam || {};
    const g = f.geometry ? f.geometry.type + (f.geometry.geometries ? "(" + f.geometry.geometries.map((x) => x.type).join(",") + ")" : "") : "no geometry";
    console.log("   - " + [n.number, n.classification, n.location, n.effectiveStart + " to " + n.effectiveEnd, g].join(" | ") + "\n     " + String(n.text || "").replace(/\s+/g, " ").slice(0, 160));
  }
}

(async () => {
  const lat = process.argv[2] || "33.8121", lon = process.argv[3] || "-117.9190", rad = process.argv[4] || "10";
  try {
    await token();
    await sleep(1200);
    summarize(await get("/v1/notams?latitude=" + lat + "&longitude=" + lon + "&radius=" + rad, "point-" + rad + "nm"));
    await sleep(1200);
    summarize(await get("/v1/notams?classification=FDC&latitude=" + lat + "&longitude=" + lon + "&radius=50", "fdc-50nm"));
    await sleep(1200);
    summarize(await get("/v1/notams?feature=AIRSPACE&latitude=" + lat + "&longitude=" + lon + "&radius=50", "airspace-50nm"));
    console.log("\nSaved responses to " + OUT + " (credentials and token scrubbed).");
  } catch (e) {
    console.error("FAILED: " + scrub(e && e.message || e));
    process.exit(1);
  }
})();
