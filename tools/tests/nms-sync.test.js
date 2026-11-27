// Tests for the NMS token manager, store/sync, point check, endpoints and QStash signature check.
// No network: the FAA and Upstash are replaced by fakes. Fixtures: real staging samples (tools/tests/fixtures/nms).
// Run: node tools/tests/nms-sync.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { makeSource } = require("../../api/_nms/source");
const { makeKv, sync, status, load } = require("../../api/_nms/store");
const { check } = require("../../api/_nms/check");
const samples = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/nms/samples.json"), "utf8"));

const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const CFG = { env: "production", host: "https://nms.test", id: "ID-xyz", secret: "SECRET-abc" };
const json = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, arrayBuffer: async () => Buffer.from(JSON.stringify(obj)) });

// fake FAA: queue of responses for API calls; token calls always succeed and are counted
function fakeFetch(apiQueue) {
  const calls = { token: 0, api: [] };
  const f = async (url, opt) => {
    if (url.endsWith("/v1/auth/token")) { calls.token++; return json(200, { access_token: "tok" + calls.token, expires_in: 1799 }); }
    calls.api.push({ url, auth: opt.headers.Authorization, fmt: opt.headers.nmsResponseFormat });
    const r = apiQueue.shift();
    if (r instanceof Error) throw r;
    return typeof r === "number" ? json(r, { error: "x" }) : json(200, r);
  };
  f.calls = calls;
  return f;
}

// ---- token manager and requests ----
t("token is cached, sent as Bearer with the GEOJSON header, and refreshed about 2 min before expiry", async () => {
  let clock = 0; const f = fakeFetch([samples, samples, samples]);
  const s = makeSource(CFG, { fetch: f, now: () => clock, sleep: async () => {} });
  await s.point(33.8, -117.9, 5); await s.point(33.8, -117.9, 5);
  assert.equal(f.calls.token, 1);
  assert.equal(f.calls.api[0].auth, "Bearer tok1"); assert.equal(f.calls.api[0].fmt, "GEOJSON");
  clock += (1799 - 119) * 1000; await s.point(33.8, -117.9, 5);
  assert.equal(f.calls.token, 2);
});
t("401: refresh the token once and retry once", async () => {
  const f = fakeFetch([401, samples]); const s = makeSource(CFG, { fetch: f, sleep: async () => {} });
  const r = await s.point(33.8, -117.9, 5);
  assert.equal(r[0].data.geojson.length, 12); assert.equal(f.calls.token, 2); assert.equal(f.calls.api[1].auth, "Bearer tok2");
});
t("401 twice gives up (no loop)", async () => {
  const f = fakeFetch([401, 401, samples]); const s = makeSource(CFG, { fetch: f, sleep: async () => {} });
  await assert.rejects(s.point(1, 1, 1), /HTTP 401/); assert.equal(f.calls.api.length, 2);
});
for (const code of [408, 429, 500]) t("HTTP " + code + " is an error with its status", async () => {
  const s = makeSource(CFG, { fetch: fakeFetch([code]), sleep: async () => {} });
  await assert.rejects(s.point(1, 1, 1), (e) => e.status === code && new RegExp(String(code)).test(e.message));
});
t("errors never contain the credentials", async () => {
  const f = async (url) => { if (url.endsWith("/token")) return json(403, {}); };
  const s = makeSource(CFG, { fetch: f, sleep: async () => {} });
  await assert.rejects(s.point(1, 1, 1), (e) => !e.message.includes(CFG.secret) && !e.message.includes(CFG.id));
  assert.equal(s.scrub("x " + CFG.secret + " y"), "x [redacted] y");
});
t("a content link (data.url) is followed with the same bearer", async () => {
  const f = fakeFetch([{ status: "Success", data: { url: "/v1/content/abc" } }, samples]);
  const s = makeSource(CFG, { fetch: f, sleep: async () => {} });
  const r = await s.point(1, 1, 1);
  assert.match(f.calls.api[1].url, /\/nmsapi\/v1\/content\/abc$/); assert.equal(r[0].data.geojson.length, 12);
});
t("a bare array (staging's FDC full file) is accepted", async () => {
  const s = makeSource(CFG, { fetch: fakeFetch([samples.data.geojson, samples]), sleep: async () => {} });
  const r = await s.bootstrap();
  assert.equal(r[0].data.geojson.length, 12);
});

// ---- store and sync ----
function fakeSource(steps, env = "production") {
  const calls = [];
  const next = (kind) => { calls.push(kind); const v = steps.shift(); if (v instanceof Error) throw v; return v; };
  return { env, calls, scrub: (s) => s, bootstrap: async () => next("full"), delta: async (since) => next("delta " + since) };
}
const resp = (feats) => [{ status: "Success", data: { geojson: feats } }];
const feat = (num) => samples.data.geojson.find((f) => f.properties.coreNOTAMData.notam.number === num);
const clone = (x) => JSON.parse(JSON.stringify(x));
const H = 3600e3, T0 = Date.parse("2026-11-27T20:00:00Z");

t("first sync is a full pull that keeps only TFR and UAS notices", async () => {
  const kv = makeKv({}); const src = fakeSource([resp(samples.data.geojson)]);
  const { state } = await sync(kv, src, { now: () => T0 });
  assert.equal(src.calls[0], "full");
  const kinds = Object.values(state.notams).map((n) => n.kind);
  assert.ok(kinds.length >= 9 && kinds.every((k) => k === "tfr" || k === "uas"));
  assert.equal(status(state, T0).stale, false);
});
t("next sync is a delta since the last sync (1 min overlap): upsert, cancel, expire", async () => {
  const kv = makeKv({}); let clock = T0;
  const changed = clone(feat("08/030")); changed.properties.coreNOTAMData.notam.text = changed.properties.coreNOTAMData.notam.text.replace("SFC-200FT", "SFC-300FT AGL");
  const cancelled = clone(feat("6/2657")); cancelled.properties.coreNOTAMData.notam.cancelationDate = "2026-11-27T20:01:00Z";
  const expired = clone(feat("11/131")); expired.properties.coreNOTAMData.notam.effectiveEnd = "2026-11-27T19:00:00Z";
  const src = fakeSource([resp(samples.data.geojson), resp([changed, cancelled, expired])]);
  await sync(kv, src, { now: () => clock });
  clock += 4 * 60e3; const { state } = await sync(kv, src, { now: () => clock });
  assert.equal(src.calls[1], "delta 2026-11-27T19:59:00Z");
  const byNum = (n) => Object.values(state.notams).find((x) => x.number === n);
  assert.deepEqual(byNum("08/030").areas[0].upper, { ft: 300, ref: "AGL" });
  assert.equal(byNum("6/2657"), undefined); assert.equal(byNum("11/131"), undefined);
  assert.equal(state.counts.mode, "delta");
});
t("rate limit: a second call within 3 min (production) is skipped, not sent to the FAA", async () => {
  const kv = makeKv({}); let clock = T0; const src = fakeSource([resp(samples.data.geojson), resp([])]);
  await sync(kv, src, { now: () => clock }); clock += 60e3;
  const r = await sync(kv, src, { now: () => clock });
  assert.match(r.skipped, /too soon/); assert.equal(src.calls.length, 1);
});
t("a failed sync keeps the last good copy and is shown as stale with the error", async () => {
  const kv = makeKv({}); let clock = T0; const src = fakeSource([resp(samples.data.geojson), new Error("NMS HTTP 500")]);
  const a = await sync(kv, src, { now: () => clock }); const n = Object.keys(a.state.notams).length;
  clock += 4 * 60e3; const { state } = await sync(kv, src, { now: () => clock });
  assert.equal(Object.keys(state.notams).length, n);
  const s = status(state, clock); assert.equal(s.stale, true); assert.match(s.error, /500/);
});
t("no successful sync for more than 10 min is stale even without an error", async () => {
  const kv = makeKv({}); const { state } = await sync(kv, fakeSource([resp(samples.data.geojson)]), { now: () => T0 });
  assert.equal(status(state, T0 + 9 * 60e3).stale, false); assert.equal(status(state, T0 + 11 * 60e3).stale, true);
  assert.equal(status(state, T0 + 11 * 60e3).dataAgeMinutes, 11);
});
t("an empty full pull does not wipe the store", async () => {
  const kv = makeKv({}); let clock = T0; const src = fakeSource([resp(samples.data.geojson), resp([])]);
  await sync(kv, src, { now: () => clock }); clock += 25 * H;
  const { state } = await sync(kv, src, { now: () => clock });
  assert.ok(Object.keys(state.notams).length >= 9); assert.match(state.lastError, /no TFR or UAS/);
});
t("a full pull that drops more than half is rejected", async () => {
  const kv = makeKv({}); let clock = T0;
  const many = Array.from({ length: 30 }, (_, i) => { const f = clone(feat("08/030")); f.properties.coreNOTAMData.notam.id = "NMS_ID_" + i; return f; });
  const src = fakeSource([resp(many), resp(many.slice(0, 10))]);
  await sync(kv, src, { now: () => clock }); clock += 25 * H;
  const { state } = await sync(kv, src, { now: () => clock });
  assert.equal(Object.keys(state.notams).length, 30); assert.match(state.lastError, /more than half/);
});
t("a full pull runs again after 24 h", async () => {
  const kv = makeKv({}); let clock = T0; const src = fakeSource([resp(samples.data.geojson), resp(samples.data.geojson)]);
  await sync(kv, src, { now: () => clock }); clock += 24 * H + 60e3; await sync(kv, src, { now: () => clock });
  assert.deepEqual(src.calls, ["full", "full"]);
});
t("staging and production data are never mixed", async () => {
  const kv = makeKv({}); let clock = T0;
  await sync(kv, fakeSource([resp(samples.data.geojson)], "staging"), { now: () => clock }); clock += 4 * 60e3;
  const src = fakeSource([resp(samples.data.geojson)], "production");
  const { state } = await sync(kv, src, { now: () => clock });
  assert.equal(src.calls[0], "full"); assert.equal(state.env, "production");
});

// ---- point check ----
async function loaded() { const kv = makeKv({}); await sync(kv, fakeSource([resp(samples.data.geojson)]), { now: () => T0 }); return load(kv); }
t("inside the Disneyland TFR; Santa Ana is 1.5 mi away; Hawthorne UAS circle found near HHR", async () => {
  const st = await loaded(), now = Date.now();
  const d = check(st, 33.8121, -117.919, 10, now, now + H).matches.find((m) => m.number === "6/6925");
  assert.ok(d && d.inside);
  const s = check(st, 33.746, -117.867, 10, now, now + H).matches.find((m) => m.number === "6/6925");
  assert.ok(s && !s.inside && s.mi > 1.3 && s.mi < 1.7);
  const h = check(st, 33.952, -118.339, 3, now, now + H).matches.find((m) => m.number === "08/030");
  assert.ok(h && h.inside && h.kind === "uas");
});
t("area-unknown notices near the point are listed with a reason, far ones only counted", async () => {
  const st = await loaded(), now = Date.now();
  const r = check(st, 34.629, -118.084, 10, now, now + H); // Palmdale: corridor NOTAM 03/024 PMD
  const u = r.unknownArea.find((x) => x.number === "03/024");
  assert.ok(u && /corridor/.test(u.notes[0]));
  assert.ok(r.unknownElsewhere >= 1);
});

// ---- endpoints ----
const call = (fn, req) => new Promise((ok) => { const res = { h: {}, status(c) { this.c = c; return this; }, json(o) { ok([this.c || 200, o, this.h]); }, setHeader(k, v) { this.h[k] = v; } }; fn(req, res); });
t("/api/airspace-check: data, data age, test-data flag and disclaimer links; 502 before the first sync", async () => {
  const ep = require("../../api/airspace-check.js");
  ep._kv = makeKv({});
  const [c0, o0] = await call(ep, { query: { lat: "33.746", lon: "-117.867" } });
  assert.equal(c0, 502); assert.equal(o0.checked, false); assert.equal(o0.stale, true);
  await sync(ep._kv, fakeSource([resp(samples.data.geojson)], "staging"), { now: () => Date.now() });
  const [c, o, h] = await call(ep, { query: { lat: "33.746", lon: "-117.867" } });
  assert.equal(c, 200); assert.equal(o.testData, true); assert.equal(o.env, "staging");
  assert.equal(o.dataAgeMinutes, 0); assert.equal(o.stale, false);
  assert.ok(o.matches.some((m) => m.number === "6/6925"));
  assert.match(o.disclaimer, /public NOTAM distribution/); assert.doesNotMatch(o.disclaimer, /FAA data/);
  assert.deepEqual(o.sources.map((x) => x.name), ["FAA NOTAM Search", "B4UFLY", "Flight Service 1-800-WX-BRIEF"]);
  assert.equal(h["Cache-Control"], "no-store");
  assert.equal((await call(ep, { query: { lat: "x", lon: "1" } }))[0], 400);
  ep._vercelEnv = "production"; // the switch: staging data is never served on the production site
  const [cp, op] = await call(ep, { query: { lat: "33.746", lon: "-117.867" } });
  assert.equal(cp, 404); assert.equal(op.enabled, false); assert.equal(op.matches, undefined);
  delete ep._vercelEnv; delete ep._kv;
});
t("/api/nms-sync accepts only QStash-signed requests", async () => {
  const { verify } = require("../../api/nms-sync.js");
  const key = "sig_test_key", body = "";
  const b64u = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const mk = (claims, k = key) => { const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify(claims)); return h + "." + p + "." + b64u(crypto.createHmac("sha256", k).update(h + "." + p).digest()); };
  const now = Math.floor(Date.now() / 1000), good = { iss: "Upstash", sub: "https://x/api/nms-sync", exp: now + 300, nbf: now - 5, body: b64u(crypto.createHash("sha256").update(body).digest()) };
  assert.equal(verify(mk(good), body, [key]), true);
  assert.equal(verify(mk(good), body, ["old", key]), true); // next key works too
  assert.equal(verify(mk(good, "wrong"), body, [key]), false);
  assert.equal(verify(mk({ ...good, exp: now - 600 }), body, [key]), false);
  assert.equal(verify(mk(good), "tampered", [key]), false);
  assert.equal(verify("garbage", body, [key]), false);
  const ep = require("../../api/nms-sync.js");
  const [c] = await call(ep, { method: "GET", headers: {} }); assert.equal(c, 405);
});

(async () => {
  let n = 0;
  for (const [name, fn] of tests) { await fn(); n++; console.log("ok  " + name); }
  console.log("\n" + n + " tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
