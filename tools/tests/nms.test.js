// Tests for the NMS-API (FAA NOTAM) parser. Fixtures are real NMS staging responses saved 2026-11-27 by
// tools/nms/smoke.js (credentials scrubbed). samples.json holds 12 picked notices; the three larger files are
// the full responses, used for a coverage check. Run: node tools/tests/nms.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const P = require("../../api/_nms/parse");
const { distanceMi } = require("../../api/_tfr/check");
const F = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/nms", n), "utf8"));

const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const { notams } = P.parseResponse(F("samples.json"));
// Domestic NOTAM numbers repeat across airports, so look up by number and location
const LOC = { "03/024": "PMD" };
const by = (num) => notams.find((n) => n.number === num && (!LOC[num] || n.location === LOC[num]));

t("envelope validates; an unknown shape fails visibly", () => {
  assert.equal(notams.length, 12);
  assert.throws(() => P.parseResponse({ status: "Success", data: { items: [] } }));
  assert.throws(() => P.parseResponse("<html>Bad gateway</html>"));
});
t("one malformed NOTAM is reported, not allowed to sink the pull", () => {
  const j = F("samples.json"); j.data.geojson.push({ type: "Feature", properties: { coreNOTAMData: { notam: { number: "1/1" } } } });
  const r = P.parseResponse(j);
  assert.equal(r.notams.length, 12); assert.equal(r.rejected.length, 1);
});
t("no credential or token text in the fixtures", () => {
  for (const f of fs.readdirSync(path.join(__dirname, "fixtures/nms"))) {
    const s = fs.readFileSync(path.join(__dirname, "fixtures/nms", f), "utf8");
    assert.doesNotMatch(s, /access_token|client_secret|Bearer\s+[A-Za-z0-9._-]{20,}/i, f);
  }
});
t("coordinates: seconds, decimal seconds, minutes only", () => {
  assert.deepEqual(P.coord("334805N1175517W"), { lat: 33 + 48 / 60 + 5 / 3600, lon: -(117 + 55 / 60 + 17 / 3600) });
  assert.ok(Math.abs(P.coord("335707.60N1182019W").lat - 33.952111) < 1e-5);
  assert.ok(Math.abs(P.coord("3348N11755W").lon + 117.916667) < 1e-5);
  assert.equal(P.coord("IPL239009"), null);
  assert.equal(P.coord("336105N1175517W"), null); // 61 minutes is not a coordinate
});
t("altitude limits", () => {
  assert.deepEqual(P.limit("SFC"), { ft: 0, ref: "AGL" });
  assert.deepEqual(P.limit("3000FT AGL"), { ft: 3000, ref: "AGL" });
  assert.deepEqual(P.limit("17999FT MSL"), { ft: 17999, ref: "MSL" });
  assert.deepEqual(P.limit("200FT"), { ft: 200, ref: "unknown" });
  assert.deepEqual(P.limit("FL180"), { ft: 18000, ref: "MSL" });
});
t("Disneyland TFR (6/6925): read from the text, not the placeholder point in the Mojave", () => {
  const d = by("6/6925");
  assert.equal(d.kind, "tfr");
  assert.equal(d.areas.length, 1);
  const a = d.areas[0];
  assert.equal(a.kind, "circle"); assert.equal(a.radiusNM, 3);
  assert.deepEqual(a.lower, { ft: 0, ref: "AGL" }); assert.deepEqual(a.upper, { ft: 3000, ref: "AGL" });
  assert.equal(distanceMi(33.8121, -117.919, a.polygon), 0); // inside the park
  const mi = distanceMi(33.746, -117.867, a.polygon); // Santa Ana preset; tfr.faa.gov says 1.49 mi
  assert.ok(mi > 1.3 && mi < 1.7, String(mi));
  assert.equal(d.schedule.perm, true); assert.equal(d.schedule.to, null);
  assert.doesNotMatch(d.text, /&apos;/);
});
t("TFR polygon split across parts (Calexico 6/2657)", () => {
  const a = by("6/2657").areas[0];
  assert.equal(a.kind, "polygon"); assert.equal(a.polygon.coordinates[0].length, 7); // 6 points + closing point
  assert.deepEqual(a.upper, { ft: 500, ref: "AGL" });
});
t("TFR with MSL floor and ceiling, POINT OF ORIGIN split across parts (El Centro 6/4812)", () => {
  const a = by("6/4812").areas[0];
  assert.equal(a.kind, "polygon");
  assert.deepEqual(a.lower, { ft: 15000, ref: "MSL" }); assert.deepEqual(a.upper, { ft: 17999, ref: "MSL" });
});
t("UAS circle without AGL/MSL keeps the reference unknown (Hawthorne 08/030)", () => {
  const n = by("08/030"); assert.equal(n.kind, "uas");
  assert.equal(n.areas[0].kind, "circle"); assert.deepEqual(n.areas[0].upper, { ft: 200, ref: "unknown" });
});
t("tiny radius with a leading decimal point (.12NM, 11/131)", () => { assert.equal(by("11/131").areas[0].radiusNM, 0.12); });
t("UAS polygon (Fullerton 03/011)", () => { const a = by("03/011").areas[0]; assert.equal(a.kind, "polygon"); assert.deepEqual(a.upper, { ft: 400, ref: "AGL" }); });
t("daily window from the schedule field (Santa Monica 08/024, 1600-0500 UTC)", () => {
  assert.deepEqual(by("08/024").schedule.daily, { start: "16:00", end: "05:00" });
});
t("areas SkyClear can't place are kept as unknown with a reason, never dropped", () => {
  assert.match(by("12/078").areas[0].note, /navigation-aid/);
  assert.match(by("03/024").areas[0].note, /corridor/);
  assert.match(by("02/096").areas[0].note, /another NOTAM/);
  for (const num of ["12/078", "03/024", "02/096"]) { assert.equal(by(num).areas[0].kind, "unknown"); assert.equal(by(num).areas[0].polygon, null); }
});
t("a polygon with no altitudes in the text keeps them unknown (A1657/26)", () => {
  const a = by("A1657/26").areas[0]; assert.equal(a.kind, "polygon"); assert.equal(a.lower, null); assert.equal(a.upper, null);
});
t("route and navaid notices are 'other' and get no areas (5/3352)", () => { const n = by("5/3352"); assert.equal(n.kind, "other"); assert.deepEqual(n.areas, []); });
t("coverage over the full staging pull: every TFR and UAS notice has at least one area entry", () => {
  const all = new Map();
  for (const f of ["point-10nm.json", "fdc-50nm.json", "airspace-50nm.json"]) for (const n of P.parseResponse(F(f)).notams) all.set(n.nmsId, n);
  const rel = [...all.values()].filter((n) => n.kind !== "other");
  assert.ok(rel.length >= 40, String(rel.length));
  assert.ok(rel.every((n) => n.areas.length >= 1));
  const placed = rel.flatMap((n) => n.areas).filter((a) => a.polygon).length, total = rel.flatMap((n) => n.areas).length;
  assert.ok(placed / total > 0.85, placed + "/" + total);
});

let n = 0;
for (const [name, fn] of tests) { fn(); n++; console.log("ok  " + name); }
console.log("\n" + n + " tests passed");
