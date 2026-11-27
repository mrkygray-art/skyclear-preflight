// Point / radius checks against normalized TFRs. Geometry by turf (point-in-polygon, distance to edge).
// Times are compared in UTC. An area whose shape is unknown is returned flagged, never dropped.
const bip = require("@turf/boolean-point-in-polygon");
const ptl = require("@turf/point-to-line-distance");
const { point, lineString } = require("@turf/helpers");
const booleanPointInPolygon = bip.booleanPointInPolygon || bip.default || bip;
const pointToLineDistance = ptl.pointToLineDistance || ptl.default || ptl;

function polys(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  return [];
}
// distance in statute miles from the point to the geometry (0 when inside)
function distanceMi(lat, lon, geom) {
  const pt = point([lon, lat]);
  let best = Infinity;
  for (const p of polys(geom)) {
    const poly = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: p } };
    if (booleanPointInPolygon(pt, poly)) return 0;
    for (const ring of p) if (ring.length >= 2) best = Math.min(best, pointToLineDistance(pt, lineString(ring), { units: "miles" }));
  }
  return best;
}
// Is a schedule active at any time in [from, to] (ms)? Daily windows may cross midnight UTC.
function activeDuring(s, from, to) {
  const a = s && s.from ? Date.parse(s.from) : -Infinity, b = s && s.to ? Date.parse(s.to) : Infinity;
  if (to < a || from > b) return false;
  if (!s || !s.daily) return true;
  const lo = Math.max(from, a), hi = Math.min(to, b);
  const [sh, sm] = s.daily.start.split(":").map(Number), [eh, em] = s.daily.end.split(":").map(Number);
  const startMin = sh * 60 + sm, endMin = eh * 60 + em;
  for (let d = new Date(lo); d.getTime() <= hi + 86400000; d = new Date(d.getTime() + 86400000)) {
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    for (const back of [0, -86400000]) { // a window that started the previous day may still be open
      const ws = day + back + startMin * 60000, we = day + back + (endMin > startMin ? endMin : endMin + 1440) * 60000;
      if (ws <= hi && we >= lo) return true;
    }
  }
  return false;
}
// next start at or after `t` (ms) for display; null when none / unknown
function nextStart(s, t) {
  if (!s) return null;
  const a = s.from ? Date.parse(s.from) : null;
  if (!s.daily) return a != null && a > t ? new Date(a).toISOString() : null;
  const [sh, sm] = s.daily.start.split(":").map(Number);
  for (let k = 0; k < 400; k++) {
    const d = new Date(Math.max(t, a || t) + k * 86400000);
    const ws = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), sh, sm);
    if (ws >= t && ws >= (a || 0) && (!s.to || ws <= Date.parse(s.to))) return new Date(ws).toISOString();
  }
  return null;
}
// tfrs: [{ notamId, type, ..., areas: [{name, polygon|null, lower, upper, schedule}] }]
// returns TFRs with at least one area inside radiusMi (or with an unknown area), each with per-area results.
function checkRadius(tfrs, lat, lon, radiusMi, fromMs, toMs) {
  const out = [];
  for (const t of tfrs) {
    const areas = [];
    for (const a of t.areas || []) {
      const mi = a.polygon ? distanceMi(lat, lon, a.polygon) : null;
      if (mi != null && mi > radiusMi) continue;
      const ended = a.schedule && a.schedule.to ? Date.parse(a.schedule.to) < fromMs : false;
      if (ended) continue;
      areas.push({ name: a.name, mi: mi == null ? null : Math.round(mi * 100) / 100, inside: mi === 0, areaKnown: !!a.polygon,
        lower: a.lower, upper: a.upper, schedule: a.schedule, activeDuringFlight: activeDuring(a.schedule, fromMs, toMs),
        nextStart: nextStart(a.schedule, fromMs), polygon: a.polygon });
    }
    if (areas.length) {
      const known = areas.filter((x) => x.areaKnown);
      out.push(Object.assign({}, t, { areas, inside: areas.some((x) => x.inside), areaKnown: known.length === areas.length,
        mi: known.length ? Math.min(...known.map((x) => x.mi)) : null }));
    }
  }
  return out.sort((a, b) => (a.mi == null ? 1e9 : a.mi) - (b.mi == null ? 1e9 : b.mi));
}
const checkPoint = (tfrs, lat, lon, atMs) => checkRadius(tfrs, lat, lon, 0, atMs, atMs).filter((t) => t.areas.some((a) => (a.inside || !a.areaKnown) && a.activeDuringFlight));
module.exports = { checkRadius, checkPoint, activeDuring, nextStart, distanceMi };
