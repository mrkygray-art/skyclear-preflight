// Tests for the TFR import (api/_tfr). Fixtures are real FAA samples saved 2026-11-26 (plus one broken file).
// Run: node tools/tests/tfr.test.js        Live smoke test against tfr.faa.gov: RUN_LIVE=1 node tools/tests/tfr.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseList, parseShapes, parseDetail, coord } = require("../../api/_tfr/parse");
const { checkRadius, checkPoint, activeDuring, nextStart, distanceMi } = require("../../api/_tfr/check");
const { makeStore, resetForTests } = require("../../api/_tfr/store");
const F = (n) => fs.readFileSync(path.join(__dirname, "fixtures/tfr", n), "utf8");

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const H = 3600000;

// ---- parse ----
t("list and shapes validate (real samples)", () => {
  const list = parseList(JSON.parse(F("list.json")));
  assert.ok(list.length > 10 && list.every((x) => /^\d+\/\d+$/.test(x.notam_id)));
  assert.ok(parseShapes(JSON.parse(F("shapes.json"))).features.length > 10);
});
t("unknown list shape fails visibly", () => {
  assert.throws(() => parseList({ not: "a list" }));
  assert.throws(() => parseList([{ notam_id: "../../etc" }]));
  assert.throws(() => parseShapes({ type: "Nope" }));
});
t("coordinates: N/S/E/W", () => { assert.equal(coord("39.97750645N"), 39.97750645); assert.equal(coord("086.13W"), -86.13); assert.ok(isNaN(coord("abc"))); });
t("circle TFR with a daily schedule (Carmel, IN)", () => {
  const d = parseDetail(F("daily-circle.xml"));
  assert.equal(d.areas.length, 1);
  const a = d.areas[0];
  assert.ok(a.polygon && a.polygon.coordinates[0].length >= 30);
  assert.deepEqual(a.lower, { ft: 0, ref: "AGL" }); assert.deepEqual(a.upper, { ft: 400, ref: "AGL" });
  assert.deepEqual(a.schedule.daily, { start: "20:30", end: "02:00" });
});
t("launch TFR: AGL floor, MSL ceiling", () => { const a = parseDetail(F("launch-polygon.xml")).areas[0]; assert.equal(a.upper.ref, "MSL"); assert.equal(a.upper.ft, 18000); });
t("multi-area TFR keeps each area's own times", () => {
  const d = parseDetail(F("multi-area.xml"));
  assert.equal(d.areas.length, 3);
  assert.notEqual(d.areas[0].schedule.from, d.areas[2].schedule.from);
});
t("TFR with no end date (Disneyland) parses with open-ended times", () => {
  const a = parseDetail(F("no-end-date.xml")).areas[0];
  assert.ok(a.polygon); assert.equal(a.schedule.to, null); assert.equal(a.upper.ft, 3000);
});
t("unparseable geometry is kept as area-unknown, not dropped", () => {
  const d = parseDetail(F("unparseable.xml"));
  assert.equal(d.areas.length, 1); assert.equal(d.areas[0].polygon, null);
  const hits = checkRadius([{ notamId: "9/9999", areas: d.areas }], 33.9, -118.3, 10, Date.now(), Date.now() + H);
  assert.equal(hits.length, 1); assert.equal(hits[0].areaKnown, false);
  assert.throws(() => parseDetail("<html>Page Not Found</html>"));
});

// ---- geometry ----
const disney = parseDetail(F("no-end-date.xml")).areas;
const DIS = { notamId: "6/6925", areas: disney };
t("point inside the Disneyland TFR", () => { assert.equal(distanceMi(33.8121, -117.919, disney[0].polygon), 0); });
t("point 1.5 mi outside: distance, not inside; radius 5 finds it, radius 1 does not", () => {
  const d = distanceMi(33.746, -117.867, disney[0].polygon);
  assert.ok(d > 1.3 && d < 1.7, String(d));
  assert.equal(checkRadius([DIS], 33.746, -117.867, 5, Date.now(), Date.now() + H).length, 1);
  assert.equal(checkRadius([DIS], 33.746, -117.867, 1, Date.now(), Date.now() + H).length, 0);
});
t("boundary: a point on the edge counts as inside", () => {
  const [lon, lat] = disney[0].polygon.coordinates[0][0];
  assert.equal(distanceMi(lat, lon, disney[0].polygon), 0);
});

// ---- time ----
const s = (from, to, daily) => ({ from, to, daily: daily || null });
t("expired areas are dropped; future ones are kept but not active", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  const area = (sch) => ({ name: "A", polygon: disney[0].polygon, lower: null, upper: null, schedule: sch });
  assert.equal(checkRadius([{ notamId: "1/1", areas: [area(s("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"))] }], 33.8121, -117.919, 1, now, now + H).length, 0);
  const fut = checkRadius([{ notamId: "1/2", areas: [area(s("2026-11-27T00:00:00Z", "2026-11-28T00:00:00Z"))] }], 33.8121, -117.919, 1, now, now + H);
  assert.equal(fut.length, 1); assert.equal(fut[0].areas[0].activeDuringFlight, false); assert.equal(fut[0].areas[0].nextStart, "2026-11-27T00:00:00.000Z");
});
t("daily window across midnight UTC (20:30-02:00)", () => {
  const sch = s("2026-11-26T20:30:00Z", "2026-12-25T02:00:00Z", { start: "20:30", end: "02:00" });
  const at = (iso) => Date.parse(iso);
  assert.equal(activeDuring(sch, at("2026-11-30T23:00:00Z"), at("2026-11-30T23:30:00Z")), true);
  assert.equal(activeDuring(sch, at("2026-12-01T01:00:00Z"), at("2026-12-01T01:30:00Z")), true); // after midnight
  assert.equal(activeDuring(sch, at("2026-11-30T12:00:00Z"), at("2026-11-30T13:00:00Z")), false);
  assert.equal(nextStart(sch, at("2026-11-30T12:00:00Z")), "2026-11-30T20:30:00.000Z");
});
t("checkPoint: active at the time, inside", () => {
  const now = Date.now();
  assert.equal(checkPoint([DIS], 33.8121, -117.919, now).length, 1);
  assert.equal(checkPoint([DIS], 33.746, -117.867, now).length, 0);
});

// ---- store: stale and failure ----
function fakeSource(seq) { let i = 0; return { fetchList: async () => { const v = seq[Math.min(i++, seq.length - 1)]; if (v instanceof Error) throw v; return v; }, fetchShapes: async () => ({ type: "FeatureCollection", features: [] }), fetchDetail: async () => ({ name: "", areas: [] }) }; }
const LIST = (k) => Array.from({ length: k }, (_, j) => ({ notam_id: "6/" + (100 + j), type: "HAZARDS", facility: "", state: "CA", description: "x", creation_date: "" }));
t("fetch failure keeps the last good copy and flags stale", async () => {
  resetForTests(); let clock = 0; const st = makeStore(fakeSource([LIST(10), new Error("FAA TFR server HTTP 503")]), () => clock);
  let d = await st.dataset(); assert.equal(d.list.length, 10); assert.equal(d.stale, false);
  clock += 6 * 60000; d = await st.dataset();
  assert.equal(d.list.length, 10); assert.equal(d.stale, true); assert.match(d.error, /503/);
});
t("an empty response does not wipe the store", async () => {
  resetForTests(); let clock = 0; const st = makeStore(fakeSource([LIST(10), []]), () => clock);
  await st.dataset(); clock += 6 * 60000; const d = await st.dataset();
  assert.equal(d.list.length, 10); assert.equal(d.stale, true); assert.match(d.error, /empty/);
});
t("a sudden drop of more than half is treated as a bad response", async () => {
  resetForTests(); let clock = 0; const st = makeStore(fakeSource([LIST(40), LIST(5)]), () => clock);
  await st.dataset(); clock += 6 * 60000; const d = await st.dataset();
  assert.equal(d.list.length, 40); assert.match(d.error, /dropped/);
});
t("data older than 15 minutes is stale even without an error", async () => {
  resetForTests(); let clock = 0; const st = makeStore(fakeSource([LIST(10), new Error("down")]), () => clock);
  await st.dataset(); clock += 16 * 60000; const d = await st.dataset(); assert.equal(d.stale, true);
});
t("first fetch failing gives no data at all (no fake 'clear')", async () => {
  resetForTests(); const st = makeStore(fakeSource([new Error("down")]), () => 0); const d = await st.dataset();
  assert.equal(d.list, null); assert.equal(d.stale, true);
});

// ---- endpoint validation ----
t("endpoint rejects bad input", async () => {
  const f = require("../../api/tfr.js");
  const call = (q) => new Promise((r) => { const res = { status(c) { this.c = c; return this; }, json(o) { r([this.c, o]); }, setHeader() {} }; f({ query: q }, res); });
  assert.equal((await call({ lat: "x", lon: "1" }))[0], 400);
  assert.equal((await call({ lat: "33.9", lon: "-118.3", r: "50" }))[0], 400);
  assert.equal((await call({ lat: "33.9", lon: "-118.3", from: "yesterday" }))[0], 400);
});
if (process.env.RUN_LIVE) t("LIVE: tfr.faa.gov returns data and the Disneyland TFR is found", async () => {
  const f = require("../../api/tfr.js");
  const [c, o] = await new Promise((r) => { const res = { status(c) { this.c = c; return this; }, json(o) { r([this.c, o]); }, setHeader() {} }; f({ query: { lat: "33.8121", lon: "-117.919" } }, res); });
  assert.equal(c, 200); assert.ok(o.total > 0); console.log("     live: " + o.total + " TFRs, " + o.matches.length + " near Disneyland: " + o.matches.map((m) => m.notamId + " " + m.name).join(", "));
});

(async () => {
  for (const [name, fn] of tests) { await fn(); n++; console.log("ok  " + name); }
  console.log("\n" + n + " tests passed" + (process.env.RUN_LIVE ? " (including live)" : " (live test skipped; RUN_LIVE=1 to run it)"));
})().catch((e) => { console.error(e); process.exit(1); });
