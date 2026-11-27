// GET /api/airspace-check?lat=&lon=&r=&from=&to=   TFRs and UAS airspace notices near a point, for a flight
// window, from SkyClear's own NOTAM store (filled by api/nms-sync.js from the FAA NOTAM Management Service).
// Pilots never cause an NMS call: this only reads the store. Same inputs as /api/tfr.
// While NMS_ENV is "staging" every response says testData: true, and the app must show it only as TEST DATA.
// Wording follows the NMS terms: "airspace notices from public NOTAM distribution", never "FAA data".
const { makeKv, load, status } = require("./_nms/store");
const { check } = require("./_nms/check");

const DISCLAIMER = "Airspace notices from public NOTAM distribution. They may be incomplete or out of date, and they are not an FAA product or endorsement. Before flying, check the FAA NOTAM Search, B4UFLY, or call Flight Service at 1-800-WX-BRIEF.";
const SOURCES = [
  { name: "FAA NOTAM Search", url: "https://notams.aim.faa.gov/notamSearch/" },
  { name: "B4UFLY", url: "https://www.faa.gov/uas/getting_started/b4ufly" },
  { name: "Flight Service 1-800-WX-BRIEF", url: "tel:+18009927433" },
];
const num = (v) => { const s = String(Array.isArray(v) ? v[0] : v == null ? "" : v); return /^-?\d{1,3}(\.\d{1,8})?$/.test(s) ? Number(s) : NaN; };
const time = (v) => { const s = String(Array.isArray(v) ? v[0] : v || ""); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(s)) return NaN; return Date.parse(s); };

module.exports = async (req, res) => {
  const q = req.query || {};
  const lat = num(q.lat), lon = num(q.lon);
  if (!(lat >= 24 && lat <= 50 && lon >= -126 && lon <= -66)) return res.status(400).json({ error: "lat/lon missing or outside the continental US" });
  let r = 10;
  if (q.r != null) { r = num(q.r); if (!(r >= 1 && r <= 10)) return res.status(400).json({ error: "r must be 1-10 miles" }); }
  const now = Date.now();
  const from = q.from != null ? time(q.from) : now, to = q.to != null ? time(q.to) : now + 3600000;
  if (!isFinite(from) || !isFinite(to) || to < from || from < now - 86400000 || to > now + 100 * 86400000 || to - from > 7 * 86400000)
    return res.status(400).json({ error: "from/to must be ISO UTC times, in order, within 100 days and at most 7 days apart" });
  const st = await load(module.exports._kv || makeKv());
  // The switch: staging (test) data is never served on the production site. Previews and local runs only.
  if ((module.exports._vercelEnv || process.env.VERCEL_ENV) === "production" && st.env !== "production") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({ error: "Airspace notice check is not enabled on this site yet", enabled: false });
  }
  const s = status(st, now);
  const base = { env: st.env, testData: st.env !== "production", ...s, radiusMi: r, from: new Date(from).toISOString(), to: new Date(to).toISOString(), disclaimer: DISCLAIMER, sources: SOURCES };
  res.setHeader("Cache-Control", "no-store");
  if (!st.lastSync) return res.status(502).json({ ...base, checked: false, error: s.error || st.lastError || "No airspace notices have been loaded yet", matches: [], unknownArea: [] });
  const c = check(st, lat, lon, r, from, to);
  res.status(200).json({ ...base, checked: true, ...c });
};
