// NOTAM store + sync. One scheduled job (api/nms-sync.js, called by QStash) pulls from NMS; pilots only read.
// Storage: Upstash Redis over its REST API when UPSTASH_REDIS_REST_URL/TOKEN are set, otherwise in memory
// (tests and local runs). The set is stored gzip+base64 under one key, so a read is one request.
// Rules from Ky's NMS brief: full pull at most once per 24 h, delta otherwise (production: no more than one
// call per 3 min); upsert by nmsId; drop cancelled/expired; never wipe the store on an error; keep the last
// good copy and record the error so the API can show it as stale.
const zlib = require("zlib");
const P = require("./parse");

const KEY = "skyclear:nms:v1";
const BOOT_MS = 24 * 3600e3, DELTA_MAX_MS = 20 * 3600e3; // stay well inside the 24 h delta window
const MIN_GAP = { production: 170e3, staging: 50e3 }; // production: 1 pull per 3 min

function makeKv(env = process.env, deps = {}) {
  const url = env.UPSTASH_REDIS_REST_URL, token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    const mem = new Map();
    return { kind: "memory", async get(k) { return mem.has(k) ? mem.get(k) : null; }, async set(k, v) { mem.set(k, v); } };
  }
  const f = deps.fetch || fetch;
  const cmd = async (arr) => {
    const r = await f(url, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(arr), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error("store HTTP " + r.status);
    const j = await r.json();
    if (j.error) throw new Error("store error");
    return j.result;
  };
  return { kind: "upstash", get: (k) => cmd(["GET", k]), set: (k, v) => cmd(["SET", k, v]) };
}

const pack = (o) => zlib.gzipSync(JSON.stringify(o)).toString("base64");
const unpack = (s) => (s ? JSON.parse(zlib.gunzipSync(Buffer.from(s, "base64")).toString("utf8")) : null);
const empty = () => ({ v: 1, env: null, notams: {}, lastSync: null, lastBootstrap: null, lastAttempt: null, lastError: null, lastErrorAt: null, counts: {} });

async function load(kv) { try { return unpack(await kv.get(KEY)) || empty(); } catch (e) { const s = empty(); s.lastError = "could not read the NOTAM store"; return s; } }

const ended = (n, nowMs) => n.cancelationDate || (n.schedule && n.schedule.to && Date.parse(n.schedule.to) < nowMs);
const relevant = (n) => n.kind === "tfr" || n.kind === "uas";

// One sync step. source = makeSource(...) or a test double; returns the new state (also saved).
async function sync(kv, source, opts = {}) {
  const now = opts.now || Date.now, t = now();
  const st = await load(kv);
  const gap = MIN_GAP[source.env] || MIN_GAP.production;
  if (!opts.force && st.lastAttempt && t - Date.parse(st.lastAttempt) < gap) return { state: st, skipped: "too soon (rate limit)" };
  if (st.env && st.env !== source.env) { Object.assign(st, empty()); } // never mix staging and production data
  st.env = source.env; st.lastAttempt = new Date(t).toISOString();
  const full = !st.lastBootstrap || t - Date.parse(st.lastBootstrap) > BOOT_MS || !st.lastSync || t - Date.parse(st.lastSync) > DELTA_MAX_MS;
  try {
    let resp;
    if (full) resp = await source.bootstrap();
    else resp = await source.delta(new Date(Date.parse(st.lastSync) - 60e3).toISOString().slice(0, 19) + "Z"); // 1 min overlap
    const got = [], rejected = [];
    for (const r of resp) { const p = P.parseResponse(r); got.push(...p.notams); rejected.push(...p.rejected); }
    if (full) {
      const keep = got.filter((n) => relevant(n) && !ended(n, t));
      const before = Object.keys(st.notams).length;
      if (!keep.length) throw new Error("the NMS full pull had no TFR or UAS notices");
      if (before >= 20 && keep.length < before / 2) throw new Error("the NMS full pull dropped from " + before + " to " + keep.length + " notices (more than half); kept the last good copy");
      st.notams = Object.fromEntries(keep.map((n) => [n.nmsId, n]));
      st.lastBootstrap = new Date(t).toISOString();
    } else {
      for (const n of got) {
        if (ended(n, t) || !relevant(n)) delete st.notams[n.nmsId];
        else st.notams[n.nmsId] = n;
      }
    }
    for (const id of Object.keys(st.notams)) if (ended(st.notams[id], t)) delete st.notams[id];
    st.lastSync = new Date(t).toISOString(); st.lastError = null; st.lastErrorAt = null;
    st.counts = { notams: Object.keys(st.notams).length, lastPull: got.length, rejected: rejected.length, mode: full ? "full" : "delta" };
  } catch (e) {
    st.lastError = source.scrub ? source.scrub(e.message) : String(e.message);
    st.lastErrorAt = new Date(t).toISOString();
  }
  await kv.set(KEY, pack(st));
  return { state: st };
}

// Data age and stale flag for the API: stale after 10 min without a successful sync, or after a failed one.
const STALE_MIN = 10;
function status(st, nowMs = Date.now()) {
  const age = st.lastSync ? Math.max(0, Math.round((nowMs - Date.parse(st.lastSync)) / 60000)) : null;
  const failed = !!(st.lastErrorAt && (!st.lastSync || Date.parse(st.lastErrorAt) >= Date.parse(st.lastSync)));
  return { fetchedAt: st.lastSync, dataAgeMinutes: age, stale: age == null || age > STALE_MIN || failed, error: failed ? st.lastError : null };
}

module.exports = { makeKv, load, sync, status, pack, unpack, KEY, STALE_MIN };
