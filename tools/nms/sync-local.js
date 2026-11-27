// Run one NMS sync from this computer and check a point, end to end (FAA NMS -> parser -> store -> check).
// Uses Upstash if UPSTASH_REDIS_REST_URL/TOKEN are in .env.local, otherwise an in-memory store.
//   node tools/nms/sync-local.js [lat] [lon] [radiusMi]
// Credentials come from .env.local and are never printed.
const fs = require("fs"), path = require("path"); const ROOT = path.join(__dirname, "../..");
for (const l of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim(); }
const { makeSource, config } = require(ROOT + "/api/_nms/source");
const { makeKv, sync, status } = require(ROOT + "/api/_nms/store");
const ep = require(ROOT + "/api/airspace-check.js");
(async () => {
  const kv = makeKv(); ep._kv = kv;
  const t0 = Date.now(); const { state, skipped } = await sync(kv, makeSource(config()), { force: true });
  console.log("store: " + kv.kind + " | env " + state.env + " | " + (Date.now() - t0) + " ms | " + JSON.stringify(state.counts) + (skipped ? " | skipped: " + skipped : ""));
  console.log("status: " + JSON.stringify(status(state)));
  const [lat, lon, r] = [process.argv[2] || "33.746", process.argv[3] || "-117.867", process.argv[4] || "10"];
  const o = await new Promise((ok) => ep({ query: { lat, lon, r } }, { status(c) { this.c = c; return this; }, json(j) { ok({ code: this.c || 200, ...j }); }, setHeader() {} }));
  console.log("\n/api/airspace-check " + lat + "," + lon + " r=" + r + ": HTTP " + o.code + " | testData " + o.testData + " | age " + o.dataAgeMinutes + " min | stale " + o.stale + " | stored " + o.totalStored);
  for (const m of o.matches) console.log("  " + (m.inside ? "INSIDE " : m.mi + " mi ") + m.kind.toUpperCase() + " " + m.number + " " + m.location + " | " + m.areas.map((a) => (a.lower ? (a.lower.ft === 0 ? "SFC" : a.lower.ft + " " + a.lower.ref) : "?") + "-" + (a.upper ? a.upper.ft + " " + a.upper.ref : "?") + (a.activeDuringFlight ? "" : " (not active now)")).join("; ") + " | " + m.text.slice(0, 80));
  for (const u of o.unknownArea) console.log("  AREA UNKNOWN ~" + u.roughMi + " mi " + u.kind + " " + u.number + " " + u.location + ": " + u.notes.join("; "));
  console.log("  (" + o.unknownElsewhere + " area-unknown notices elsewhere in the country)");
})().catch((e) => { console.error("FAILED " + e.message); process.exit(1); });
