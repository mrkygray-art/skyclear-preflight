// Vercel serverless relay for address lookup (address or place name -> latitude/longitude).
// 1. OpenStreetMap Nominatim (addresses and place names). Usage policy: identify the app,
//    keep volume low (one search per button press), cache results, show the attribution.
// 2. If OpenStreetMap finds nothing, the US Census Bureau geocoder (street addresses only).
// No keys. United States only. Example: /api/geo?q=200 N Spring St, Los Angeles, CA
const UA = "SkyClear-Preflight/1.0 (drone pre-flight web app; https://skyclear-preflight.vercel.app)";

function clean(q) {
  return String(Array.isArray(q) ? q[0] : q || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

async function getJson(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) throw new Error("status " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  const q = clean((req.query || {}).q);
  if (q.length < 3) return res.status(400).json({ error: "Type at least 3 characters." });
  let results = [];
  let osmOk = false;
  try {
    const j = await getJson(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=us&q=" + encodeURIComponent(q),
      8000
    );
    osmOk = true;
    results = (Array.isArray(j) ? j : [])
      .map((o) => ({ lat: Number(o.lat), lon: Number(o.lon), label: String(o.display_name || "").slice(0, 200), src: "OpenStreetMap" }))
      .filter((o) => isFinite(o.lat) && isFinite(o.lon));
  } catch (e) {}
  if (!results.length) {
    try {
      const j = await getJson(
        "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" + encodeURIComponent(q),
        8000
      );
      results = ((j.result && j.result.addressMatches) || [])
        .slice(0, 5)
        .map((m) => ({ lat: Number(m.coordinates.y), lon: Number(m.coordinates.x), label: String(m.matchedAddress || "").slice(0, 200), src: "US Census Bureau" }))
        .filter((o) => isFinite(o.lat) && isFinite(o.lon));
    } catch (e) {
      if (!osmOk) return res.status(502).json({ error: "Address search is unavailable right now. Use GPS or type coordinates." });
    }
  }
  // The same place often comes back twice (a building and its entrance, a few meters apart).
  // Keep the first of any results within about 200 m of each other.
  const km = (a, b) => {
    const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  results = results.filter((o, i) => !results.slice(0, i).some((p) => km(o, p) < 0.2));
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  res.status(200).json({ results });
};
