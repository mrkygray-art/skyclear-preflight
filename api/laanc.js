// Vercel serverless relay for the FAA UAS Facility Map (LAANC grid) and FAA Class Airspace layers.
// The browser calls the FAA ArcGIS service directly first (it allows CORS); this relay is the BACKUP
// for networks or blockers that stop that direct call. Same pattern as api/wx.js: fixed layers,
// validated numbers only, no free-form URLs, short cache, clear errors, only the fields the app uses.
// Example: /api/laanc?layer=grid&lat=33.902&lon=-118.367        (optional &r=<meters, 1-2000>)
const BASE = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/";
const LAYERS = {
  grid: { svc: "FAA_UAS_FacilityMap_Data", fields: "CEILING,UNIT,MAP_EFF,ARPT_COUNT,APT1_FAAID,APT1_NAME,APT1_LAANC,APT2_FAAID,APT2_NAME,APT2_LAANC,APT3_FAAID,APT3_NAME,APT3_LAANC,APT4_FAAID,APT4_NAME,APT4_LAANC,APT5_FAAID,APT5_NAME,APT5_LAANC,AIRSPACE_1,AIRSPACE_2,AIRSPACE_3" },
  airspace: { svc: "Class_Airspace", fields: "CLASS,NAME,LOWER_VAL,ICAO_ID" },
};
const num = (v) => {
  const s = String(Array.isArray(v) ? v[0] : v == null ? "" : v);
  return /^-?\d{1,3}(\.\d{1,8})?$/.test(s) ? Number(s) : NaN;
};

module.exports = async (req, res) => {
  const q = req.query || {};
  const L = LAYERS[String(q.layer || "grid")];
  if (!L) return res.status(400).json({ error: "layer must be grid or airspace" });
  const lat = num(q.lat), lon = num(q.lon);
  // continental US plus a margin (SkyClear's charts are all inside this box)
  if (!(lat >= 24 && lat <= 50 && lon >= -126 && lon <= -66)) return res.status(400).json({ error: "lat/lon missing or outside the continental US" });
  let r = 0;
  if (q.r != null) { r = num(q.r); if (!(r >= 1 && r <= 2000)) return res.status(400).json({ error: "r must be 1-2000 meters" }); r = Math.round(r); }
  const url = BASE + L.svc + "/FeatureServer/0/query?where=1%3D1&geometry=" + lon + "%2C" + lat +
    "&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects" +
    (r ? "&distance=" + r + "&units=esriSRUnit_Meter" : "") + "&outFields=" + L.fields + "&returnGeometry=false&f=json";
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const up = await fetch(url, { headers: { "User-Agent": "SkyClear-Preflight/1.0" }, signal: ctl.signal });
    if (!up.ok) return res.status(502).json({ error: "FAA service HTTP " + up.status });
    const j = await up.json();
    if (!Array.isArray(j.features)) return res.status(502).json({ error: "FAA service returned no feature list" });
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ features: j.features.map((f) => ({ attributes: f.attributes })) });
  } catch (e) {
    res.status(504).json({ error: e && e.name === "AbortError" ? "FAA service timed out" : "FAA service unreachable" });
  } finally {
    clearTimeout(t);
  }
};
