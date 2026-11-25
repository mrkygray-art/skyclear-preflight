// Vercel serverless relay for NOAA Aviation Weather Center (aviationweather.gov).
// Browsers cannot call the AWC API directly (no CORS header), so the app calls /api/wx
// and this function fetches the same data server-side.
// Example: /api/wx?path=metar&ids=KHHR,KLAX&format=json
const ALLOWED = new Set(["metar", "taf"]);
const OK_KEYS = new Set(["ids", "format", "hours", "bbox"]);

module.exports = async (req, res) => {
  const q = req.query || {};
  const path = String(q.path || "metar");
  if (!ALLOWED.has(path)) return res.status(400).json({ error: "path must be metar or taf" });
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (OK_KEYS.has(k)) p.set(k, String(Array.isArray(v) ? v[0] : v).slice(0, 200));
  }
  if (!p.get("ids") && !p.get("bbox")) return res.status(400).json({ error: "ids or bbox required" });
  if (!/^[A-Za-z0-9,.\-]+$/.test(p.get("ids") || "A") || !/^[A-Za-z0-9,.\-]+$/.test(p.get("bbox") || "0")) {
    return res.status(400).json({ error: "bad characters" });
  }
  if (!p.get("format")) p.set("format", "json");
  try {
    const r = await fetch("https://aviationweather.gov/api/data/" + path + "?" + p.toString(), {
      headers: { "User-Agent": "SkyClear-Preflight/1.0" },
    });
    const body = await r.text();
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(r.status).send(body || "[]");
  } catch (e) {
    res.status(502).json({ error: "upstream unavailable" });
  }
};
