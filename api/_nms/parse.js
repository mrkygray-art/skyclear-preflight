// NMS-API (FAA NOTAM Management Service) response parsing. Formats were read from real staging responses
// (2026-11-27, saved in tools/tests/fixtures/nms). Findings that shape this file:
// - The GeoJSON geometry on TFRs and UAS notices is a placeholder (the ARTCC or airport location), NOT the area.
//   Disneyland's TFR point sits in the Mojave Desert. Areas are therefore read from the NOTAM text.
// - Area formats seen: "3NM RADIUS OF 334805N1175517W", a polygon "<coord> (...) TO <coord> ... TO POINT OF ORIGIN",
//   navaid radial/distance points ("IPL239009"), corridors ("5NM EITHER SIDE OF A LINE FM ..."), and
//   references ("SEE HDF 02/095"). Only the first two can be placed; the rest are kept as area unknown.
// - Altitudes are in the text ("SFC-3000FT AGL", "15000FT MSL-17999FT MSL", "SFC-200FT"); separate limit fields
//   exist on only a few notices. effectiveEnd may be "PERM". Long notices come in parts ("END PART 1 OF 2 PART 2 OF 2").
// Nothing here guesses: what can't be read is returned as unknown, never dropped.
const { z } = require("zod");

const NotamSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  classification: z.string(),
  location: z.string().optional().default(""),
  effectiveStart: z.string().optional().default(""),
  effectiveEnd: z.string().optional().default(""),
  estimated: z.string().optional(),
  text: z.string().optional().default(""),
  lastUpdated: z.string().optional().default(""),
  cancelationDate: z.string().optional(),
  schedule: z.string().optional(),
  lowerLimit: z.string().optional(),
  upperLimit: z.string().optional(),
  icaoLocation: z.string().optional(),
}).passthrough();
const FeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({ coreNOTAMData: z.object({ notam: NotamSchema }).passthrough() }).passthrough(),
  geometry: z.any().optional(),
}).passthrough();
const ResponseSchema = z.object({
  status: z.string().optional(),
  data: z.object({ geojson: z.array(z.unknown()) }).passthrough(),
}).passthrough();

// Validate the envelope strictly (an unknown shape fails visibly); validate each NOTAM separately so one odd
// record is reported, not allowed to sink the whole pull.
function parseResponse(json) {
  const env = ResponseSchema.parse(json);
  const notams = [], rejected = [];
  for (const f of env.data.geojson) {
    const r = FeatureSchema.safeParse(f);
    if (r.success) notams.push(normalize(r.data));
    else rejected.push({ id: f && f.properties && f.properties.coreNOTAMData && f.properties.coreNOTAMData.notam && f.properties.coreNOTAMData.notam.id || null, error: r.error.issues[0] && r.error.issues[0].message });
  }
  return { notams, rejected };
}

const ENT = { "&apos;": "'", "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#39;": "'" };
const decode = (s) => String(s || "").replace(/&(apos|quot|amp|lt|gt|#39);/g, (m) => ENT[m] || m);
// One line of text with part markers removed, so an area split across parts reads as one.
const clean = (s) => decode(s).replace(/\s+/g, " ").replace(/\s*END PART \d+ OF \d+\s*PART \d+ OF \d+\s*/g, " ").replace(/\s*END PART \d+ OF \d+\s*/g, " ").trim();

// "334805N1175517W", "335707.60N1182019W", "3348N11755W" -> {lat, lon}
const COORD = /(\d{4}(?:\d{2}(?:\.\d+)?)?)([NS])\s?(\d{5}(?:\d{2}(?:\.\d+)?)?)([EW])/;
const COORD_G = new RegExp(COORD.source, "g");
function dms(s, degDigits) {
  const d = +s.slice(0, degDigits), m = +s.slice(degDigits, degDigits + 2), sec = s.length > degDigits + 2 ? +s.slice(degDigits + 2) : 0;
  if (m >= 60 || sec >= 60) return NaN;
  return d + m / 60 + sec / 3600;
}
function coord(str) {
  const m = String(str).match(COORD);
  if (!m) return null;
  const lat = dms(m[1], 2) * (m[2] === "S" ? -1 : 1), lon = dms(m[3], 3) * (m[4] === "W" ? -1 : 1);
  return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

// Circle as a 64-point GeoJSON polygon (nautical miles; spherical earth is plenty at these sizes).
function circle(lat, lon, rNM, n = 64) {
  const R = 3440.065, d = rNM / R, la = lat * Math.PI / 180, lo = lon * Math.PI / 180, ring = [];
  for (let i = 0; i <= n; i++) {
    const b = (i % n) / n * 2 * Math.PI;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    ring.push([+(lo2 * 180 / Math.PI).toFixed(6), +(la2 * 180 / Math.PI).toFixed(6)]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

// "SFC" | "3000FT AGL" | "15000FT MSL" | "200FT" | "FL180" | "UNL" -> {ft, ref}
function limit(s) {
  s = String(s || "").trim().toUpperCase();
  if (s === "SFC" || s === "SURFACE" || s === "GND") return { ft: 0, ref: "AGL" };
  if (s === "UNL" || s === "UNLTD") return { ft: Infinity, ref: "MSL" };
  let m = s.match(/^FL\s?(\d{2,3})$/);
  if (m) return { ft: +m[1] * 100, ref: "MSL" };
  m = s.match(/^(\d{1,6})\s?FT(?:\s?(AGL|MSL|AMSL))?$/);
  if (m) return { ft: +m[1], ref: m[2] ? (m[2] === "AGL" ? "AGL" : "MSL") : "unknown" };
  return null;
}
const LIM = "(SFC|FL\\s?\\d{2,3}|\\d{1,6}\\s?FT(?:\\s?(?:AGL|MSL|AMSL))?)";
const LIMITS = new RegExp("^\\s*(?:\\([^)]*\\)\\s*)?" + LIM + "\\s?-\\s?(" + LIM.slice(1, -1) + "|UNL)");
function limitsAfter(rest) {
  const m = rest.match(LIMITS);
  return m ? { lower: limit(m[1]), upper: limit(m[2]) } : { lower: null, upper: null };
}

// Every area definition in the text. Each returns {kind, polygon|null, lower, upper, note}.
function parseAreas(text) {
  const t = clean(text), out = [];
  const re = /AREA DEFINED AS /g;
  let m;
  while ((m = re.exec(t))) {
    const rest = t.slice(m.index + m[0].length);
    // circle
    let c = rest.match(/^(\d*\.?\d+)\s?NM RADIUS OF (\S+)/);
    if (c) {
      const p = coord(c[2]), r = +c[1];
      const after = rest.slice(c[0].length);
      if (p && r > 0 && r < 500) { out.push({ kind: "circle", polygon: circle(p.lat, p.lon, r), center: p, radiusNM: r, ...limitsAfter(after), note: "" }); continue; }
      out.push({ kind: "unknown", polygon: null, ...limitsAfter(after), note: "radius around a point SkyClear can't place (" + c[2] + ")" });
      continue;
    }
    // polygon: points joined by TO, ending at (THE) POINT OF ORIGIN
    const end = rest.search(/TO (?:THE )?POINT OF ORIGIN/);
    if (end > 0) {
      const body = rest.slice(0, end);
      const parts = body.split(/\s?\bTO\b\s?/).map((s) => s.trim()).filter(Boolean);
      const pts = parts.map((s) => coord(s));
      const after = rest.slice(end).replace(/^TO (?:THE )?POINT OF ORIGIN/, "");
      if (pts.length >= 3 && pts.every(Boolean)) {
        const ring = pts.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)]);
        ring.push(ring[0]);
        out.push({ kind: "polygon", polygon: { type: "Polygon", coordinates: [ring] }, ...limitsAfter(after), note: "" });
      } else {
        out.push({ kind: "unknown", polygon: null, ...limitsAfter(after), note: "boundary uses navigation-aid bearings or points SkyClear can't place" });
      }
      continue;
    }
    if (/^\d*\.?\d+\s?NM EITHER SIDE OF/.test(rest)) { out.push({ kind: "unknown", polygon: null, ...limitsAfter(rest.replace(/^.*?(?=SFC|\d+FT)/, "")), note: "corridor along a line; SkyClear can't draw it" }); continue; }
    out.push({ kind: "unknown", polygon: null, lower: null, upper: null, note: "area description SkyClear can't read" });
  }
  if (!out.length) out.push({ kind: "unknown", polygon: null, lower: null, upper: null, note: /\bSEE [A-Z0-9]{3,4} \d{1,2}\/\d{3,4}\b/.test(t) ? "refers to another NOTAM" : "no area in the text" });
  return out;
}

// Schedule: only a plain daily window ("DLY 1600-0500", schedule "Daily:1600-0500~DLY 1600-0500") is modelled;
// anything else (weekdays, SR-SS) is treated as active for the whole effective range, which is cautious.
function parseSchedule(n, text) {
  const iso = (s) => (/^\d{4}-\d{2}-\d{2}T/.test(s || "") && isFinite(Date.parse(s)) ? new Date(s).toISOString() : null);
  const from = iso(n.effectiveStart), to = iso(n.effectiveEnd);
  const src = String(n.schedule || "") + " " + clean(text);
  const m = src.match(/\b(?:DLY|Daily:)\s?(\d{2})(\d{2})-(\d{2})(\d{2})\b/);
  const daily = m && +m[1] < 24 && +m[3] <= 24 ? { start: m[1] + ":" + m[2], end: m[3] + ":" + m[4] } : null;
  return { from, to, perm: /^PERM$/i.test(n.effectiveEnd || ""), estimated: n.estimated === "true", daily, raw: n.schedule || null };
}

// tfr | uas | other. Text patterns from real samples; the raw text is always kept.
function classify(n, text) {
  const t = clean(text);
  if (/^FDC$/i.test(n.classification) && /TEMPORARY FLIGHT RESTRICTION|SPECIAL SECURITY INSTRUCTIONS|NATIONAL DEFENSE AIRSPACE/.test(t)) return "tfr";
  if (/^AIRSPACE\b.*\bUAS\b/.test(t) || /\bUAS\b.*\bAREA DEFINED AS\b/.test(t)) return "uas";
  return "other";
}

// The feature's own point: NOT the restricted area (see the top of this file), only a rough "which part of the
// country" hint used to list notices whose area SkyClear can't place.
function refPoint(g) {
  const gs = g && (g.type === "GeometryCollection" ? g.geometries : [g]) || [];
  const p = gs.find((x) => x && x.type === "Point" && Array.isArray(x.coordinates));
  return p && isFinite(p.coordinates[0]) && isFinite(p.coordinates[1]) ? { lon: +p.coordinates[0], lat: +p.coordinates[1] } : null;
}

function normalize(f) {
  const n = f.properties.coreNOTAMData.notam, text = n.text || "";
  return {
    nmsId: n.id, number: n.number, classification: n.classification, location: n.location || "", icao: n.icaoLocation || "", refPoint: refPoint(f.geometry),
    kind: classify(n, text), text: clean(text), lastUpdated: n.lastUpdated || "", cancelationDate: n.cancelationDate || null,
    schedule: parseSchedule(n, text), areas: classify(n, text) === "other" ? [] : parseAreas(text),
  };
}

module.exports = { parseResponse, normalize, parseAreas, parseSchedule, classify, coord, limit, clean, decode, circle };
