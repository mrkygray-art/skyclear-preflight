// Vercel serverless relay for FAA Temporary Flight Restrictions (tfr.faa.gov). Browsers can't call
// tfr.faa.gov directly (no CORS header). Sources, all official FAA (checked 2026-11-25):
//   list    https://tfr.faa.gov/tfrapi/exportTfrList                          active and upcoming TFRs
//   shapes  https://tfr.faa.gov/geoserver/TFR/ows (WFS, layer TFR:V_TFR_LOC)  TFR polygons (GeoJSON)
//   detail  https://tfr.faa.gov/download/detail_<n>_<nnnn>.xml               times and altitude limits
// Only shapes whose NOTAM is on the active list are used. Pattern as api/wx.js: validated numbers only,
// no free-form URLs, short cache, clear errors, only the fields the app needs.
// Example: /api/tfr?lat=33.8121&lon=-117.919&r=5      (r = search radius in statute miles, 1-10, default 5)
const UA = { "User-Agent": "SkyClear-Preflight/1.0 (drone pre-flight web app)" };
const LIST = "https://tfr.faa.gov/tfrapi/exportTfrList";
const SHAPES = "https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json";
const num = (v) => {
  const s = String(Array.isArray(v) ? v[0] : v == null ? "" : v);
  return /^-?\d{1,3}(\.\d{1,8})?$/.test(s) ? Number(s) : NaN;
};
async function get(url, ms, type) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return type === "text" ? await r.text() : await r.json();
  } finally {
    clearTimeout(t);
  }
}
// Shared cache inside one warm function instance (the list and shapes are national, ~80 KB)
let CACHE = { at: 0, list: null, shapes: null };

// Distance in statute miles from a point to a polygon ring (0 when inside). Local flat projection.
function ringInfo(lat, lon, ring) {
  const kx = 69.172 * Math.cos((lat * Math.PI) / 180), ky = 69.0;
  const P = ring.map(([x, y]) => [(x - lon) * kx, (y - lat) * ky]);
  let inside = false, d = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi, dy = yj - yi, L2 = dx * dx + dy * dy;
    let t = L2 ? -(xi * dx + yi * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    d = Math.min(d, Math.hypot(xi + t * dx, yi + t * dy));
  }
  return { inside, mi: inside ? 0 : d };
}
function polyInfo(lat, lon, geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  let best = { inside: false, mi: Infinity };
  for (const poly of polys) {
    const outer = ringInfo(lat, lon, poly[0]);
    const inHole = outer.inside && poly.slice(1).some((h) => ringInfo(lat, lon, h).inside);
    const r = { inside: outer.inside && !inHole, mi: outer.inside && !inHole ? 0 : outer.mi };
    if (r.inside || r.mi < best.mi) best = r;
  }
  return best;
}
const tag = (xml, name) => [...xml.matchAll(new RegExp("<" + name + ">([^<]*)</" + name + ">", "g"))].map((m) => m[1].trim());
function parseDetail(xml) {
  const eff = tag(xml, "dateEffective").sort()[0] || null;
  const exp = tag(xml, "dateExpire").sort().slice(-1)[0] || null;
  const lim = (k) => {
    const v = tag(xml, "valDistVer" + k)[0], u = tag(xml, "uomDistVer" + k)[0], c = tag(xml, "codeDistVer" + k)[0];
    return v == null ? null : { val: Number(v), uom: u || "FT", ref: c === "HEI" ? "AGL" : c === "ALT" ? "MSL" : c || "" };
  };
  return { name: tag(xml, "txtLocalName")[0] || "", effective: eff ? eff + "Z" : null, expires: exp ? exp + "Z" : null, lower: lim("Lower"), upper: lim("Upper") };
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const lat = num(q.lat), lon = num(q.lon);
  if (!(lat >= 24 && lat <= 50 && lon >= -126 && lon <= -66)) return res.status(400).json({ error: "lat/lon missing or outside the continental US" });
  let r = 5;
  if (q.r != null) { r = num(q.r); if (!(r >= 1 && r <= 10)) return res.status(400).json({ error: "r must be 1-10 miles" }); }
  try {
    if (!CACHE.list || Date.now() - CACHE.at > 120000) {
      const [list, shapes] = await Promise.all([get(LIST, 12000), get(SHAPES, 12000)]);
      if (!Array.isArray(list) || !shapes || !Array.isArray(shapes.features)) throw new Error("unexpected FAA TFR response");
      CACHE = { at: Date.now(), list, shapes: shapes.features };
    }
    const active = new Map(CACHE.list.map((x) => [x.notam_id, x]));
    const byId = new Map();
    for (const f of CACHE.shapes) {
      const id = String((f.properties || {}).NOTAM_KEY || "").split("-")[0];
      if (!active.has(id) || !f.geometry) continue;
      const pi = polyInfo(lat, lon, f.geometry);
      const cur = byId.get(id);
      if (!cur || pi.inside || pi.mi < cur.mi) byId.set(id, { id, inside: pi.inside, mi: pi.mi, geometry: f.geometry, legal: f.properties.LEGAL || "" });
    }
    const near = [...byId.values()].filter((x) => x.inside || x.mi <= r).sort((a, b) => a.mi - b.mi).slice(0, 8);
    await Promise.all(near.map(async (x) => {
      const L = active.get(x.id);
      Object.assign(x, { type: L.type, title: L.description, facility: L.facility, state: L.state, mi: Math.round(x.mi * 100) / 100,
        link: "https://tfr.faa.gov/tfr3/?page=detail_" + x.id.replace("/", "_") });
      try { Object.assign(x, parseDetail(await get("https://tfr.faa.gov/download/detail_" + x.id.replace("/", "_") + ".xml", 8000, "text")), { detail: true }); }
      catch (e) { x.detail = false; }
    }));
    const shaped = new Set(CACHE.shapes.map((f) => String((f.properties || {}).NOTAM_KEY || "").split("-")[0]));
    const noShape = CACHE.list.filter((x) => !shaped.has(x.notam_id)).map((x) => ({ id: x.notam_id, type: x.type, state: x.state, title: x.description }));
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    res.status(200).json({ checked: true, fetched: new Date(CACHE.at).toISOString(), total: CACHE.list.length, radius_mi: r, near, noShape });
  } catch (e) {
    res.status(502).json({ error: e && e.name === "AbortError" ? "FAA TFR service timed out" : "FAA TFR service unreachable (" + String(e && e.message || e).slice(0, 80) + ")" });
  }
};
