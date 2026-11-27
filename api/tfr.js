// GET /api/tfr?lat=&lon=&r=&from=&to=   FAA Temporary Flight Restrictions near a point, for a flight window.
// Browsers can't call tfr.faa.gov (no CORS), and the client never calls the FAA directly.
//   lat, lon  continental US          r  search radius in statute miles, 1-10 (default 10)
//   from, to  flight window, ISO 8601 UTC (default: now to now + 1 h)
// Returns { matches, unknownArea, fetchedAt, stale, error, total, radiusMi, from, to, disclaimer, sources }.
// Layout: _tfr/source.js (FAA adapter) -> _tfr/parse.js (zod + XML) -> _tfr/store.js (last good copy)
//         -> _tfr/check.js (turf geometry, time windows). Files starting with "_" are not routes on Vercel.
const source = require("./_tfr/source");
const { makeStore } = require("./_tfr/store");
const { checkRadius, distanceMi } = require("./_tfr/check");
const { notamFromKey } = require("./_tfr/parse");

const store = makeStore(source);
const DISCLAIMER = "TFR data from tfr.faa.gov may be incomplete, and the FAA says not to rely on it alone for flight planning. Before flying, check the FAA NOTAM Search, B4UFLY, or call Flight Service at 1-800-WX-BRIEF.";
const SOURCES = [
  { name: "FAA TFR list", url: "https://tfr.faa.gov/" },
  { name: "FAA NOTAM Search", url: "https://notams.aim.faa.gov/notamSearch/" },
  { name: "B4UFLY", url: "https://www.faa.gov/uas/getting_started/b4ufly" },
  { name: "Flight Service 1-800-WX-BRIEF", url: "tel:+18009927433" },
];
const num = (v) => { const s = String(Array.isArray(v) ? v[0] : v == null ? "" : v); return /^-?\d{1,3}(\.\d{1,8})?$/.test(s) ? Number(s) : NaN; };
const time = (v) => { const s = String(Array.isArray(v) ? v[0] : v || ""); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(s)) return NaN; return Date.parse(s); };

// Normalize one list item into a TFR with areas (detail XML first, FAA map shape as fallback, else unknown)
async function normalize(item, shape) {
  const d = await store.detailFor(item);
  let areas = d.detail ? d.detail.areas : [];
  let areaSource = "faa-detail";
  if (!areas.some((a) => a.polygon) && shape && shape.geometry) {
    // detail had no usable polygon: use the FAA TFR map shape; limits and times unknown -> treated as always active
    areas = [{ name: "Area", polygon: shape.geometry.type === "Polygon" ? shape.geometry : { type: "Polygon", coordinates: shape.geometry.coordinates[0] }, lower: null, upper: null, schedule: null }];
    areaSource = "faa-map-shape";
  }
  if (!areas.length) { areas = [{ name: "", polygon: null, lower: null, upper: null, schedule: null }]; areaSource = null; }
  return { notamId: item.notam_id, type: item.type, facility: item.facility, state: item.state, description: item.description,
    name: (d.detail && d.detail.name) || "", areas, areaSource, detailError: d.error || null,
    detailUrl: source.detailUrl(item.notam_id), link: source.pageUrl(item.notam_id) };
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const lat = num(q.lat), lon = num(q.lon);
  if (!(lat >= 24 && lat <= 50 && lon >= -126 && lon <= -66)) return res.status(400).json({ error: "lat/lon missing or outside the continental US" });
  let r = 10;
  if (q.r != null) { r = num(q.r); if (!(r >= 1 && r <= 10)) return res.status(400).json({ error: "r must be 1-10 miles" }); }
  const now = Date.now();
  let from = q.from != null ? time(q.from) : now, to = q.to != null ? time(q.to) : now + 3600000;
  if (!isFinite(from) || !isFinite(to) || to < from || from < now - 86400000 || to > now + 100 * 86400000 || to - from > 7 * 86400000)
    return res.status(400).json({ error: "from/to must be ISO UTC times, in order, within 100 days and at most 7 days apart" });

  const ds = await store.dataset();
  const base = { fetchedAt: ds.fetchedAt ? new Date(ds.fetchedAt).toISOString() : null, stale: ds.stale, error: ds.error, radiusMi: r,
    from: new Date(from).toISOString(), to: new Date(to).toISOString(), disclaimer: DISCLAIMER, sources: SOURCES };
  if (!ds.list) { res.setHeader("Cache-Control", "no-store"); return res.status(502).json(Object.assign(base, { error: ds.error || "FAA TFR data unavailable", matches: [], unknownArea: [], total: null })); }

  const shapes = new Map();
  for (const f of ds.shapes ? ds.shapes.features : []) { const id = notamFromKey(f.properties.NOTAM_KEY); if (f.geometry && !shapes.has(id)) shapes.set(id, f); }
  // Only fetch details for TFRs that could matter here: map shape within r + 2 mi, or no map shape at all.
  const candidates = ds.list.filter((it) => { const s = shapes.get(it.notam_id); return !s || distanceMi(lat, lon, s.geometry) <= r + 2; });
  const norm = (await source.pool(candidates, 4, (it) => normalize(it, shapes.get(it.notam_id)))).filter((x) => x.ok).map((x) => x.v);
  const hits = checkRadius(norm, lat, lon, r, from, to);
  const matches = hits.filter((t) => t.areas.some((a) => a.areaKnown)).map((t) => Object.assign({}, t, { areas: t.areas.filter((a) => a.areaKnown) }));
  const unknownArea = hits.filter((t) => t.areas.some((a) => !a.areaKnown)).map((t) => ({ notamId: t.notamId, type: t.type, state: t.state, description: t.description, name: t.name, link: t.link }));

  res.setHeader("Cache-Control", ds.stale ? "no-store" : "s-maxage=120, stale-while-revalidate=300");
  res.status(200).json(Object.assign(base, { checked: true, total: ds.list.length, matches, unknownArea }));
};
