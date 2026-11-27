// FAA TFR payloads -> normalized TFRs. Every payload is untrusted: zod checks the shape and an unknown
// shape throws (fail visible). Field names below were read from live responses on 2026-11-26.
//   list   tfrapi/exportTfrList   [{notam_id, type, facility, state, description, creation_date}]
//   shapes geoserver TFR:V_TFR_LOC GeoJSON FeatureCollection, properties.NOTAM_KEY "6/9800-1-FDC-F"
//   detail download/detail_6_9800.xml  XNOTAM-Update; one <TFRAreaGroup> per area with <aseTFRArea>
//          (name, altitude limits, <ScheduleGroup>) and <abdMergedArea> (polygon as <Avx> GRC points)
const { z } = require("zod");

const ListItem = z.object({
  notam_id: z.string().regex(/^\d{1,2}\/\d{1,5}$/),
  type: z.string().max(60).optional().default(""),
  facility: z.string().max(20).optional().default(""),
  state: z.string().max(20).optional().default(""),
  description: z.string().max(600).optional().default(""),
  creation_date: z.string().max(40).optional().default(""),
}).passthrough();
const ListSchema = z.array(ListItem).max(5000);

const Pos = z.array(z.number()).min(2);
const ShapeFeature = z.object({
  type: z.literal("Feature"),
  geometry: z.union([
    z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(Pos)) }),
    z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(z.array(Pos))) }),
  ]).nullable(),
  properties: z.object({ NOTAM_KEY: z.string(), LEGAL: z.string().nullable().optional(), TITLE: z.string().nullable().optional() }).passthrough(),
}).passthrough();
const ShapesSchema = z.object({ type: z.literal("FeatureCollection"), features: z.array(ShapeFeature).max(5000) }).passthrough();

function parseList(json) { return ListSchema.parse(json); }
function parseShapes(json) { return ShapesSchema.parse(json); }
const notamFromKey = (k) => String(k || "").split("-")[0];
const detailFile = (notamId) => "detail_" + notamId.replace("/", "_") + ".xml";

// ---- detail XML (regex reader for the small, fixed XNOTAM subset we use) ----
const tags = (xml, name) => [...xml.matchAll(new RegExp("<" + name + ">([^<]*)</" + name + ">", "g"))].map((m) => m[1].trim());
const tag = (xml, name) => tags(xml, name)[0];
const blocks = (xml, name) => [...xml.matchAll(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">", "g"))].map((m) => m[1]);
function coord(s) { // "39.97750645N" / "086.13W"
  const m = /^(\d{1,3}(?:\.\d+)?)([NSEW])$/.exec(String(s || "").trim());
  if (!m) return NaN;
  const v = Number(m[1]);
  return m[2] === "S" || m[2] === "W" ? -v : v;
}
function altitude(area, which) { // which = "Upper" | "Lower"
  const v = tag(area, "valDistVer" + which), u = tag(area, "uomDistVer" + which), c = tag(area, "codeDistVer" + which);
  if (v == null || v === "") return null;
  let ft = Number(v);
  if (!isFinite(ft)) return null;
  if (u === "FL") ft = ft * 100;
  const ref = c === "HEI" ? "AGL" : c === "ALT" || c === "STD" || u === "FL" ? "MSL" : "unknown";
  return { ft, ref };
}
const iso = (s) => (s && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 19) + "Z" : null); // XNOTAM times are UTC
function schedule(area) {
  const g = blocks(area, "ScheduleGroup")[0] || "";
  const from = iso(tag(g, "dateEffective") || tag(area, "dateEffective"));
  const to = iso(tag(g, "dateExpire") || tag(area, "dateExpire"));
  const scheduled = tag(area, "isScheduledTfrArea") === "TRUE" && tag(g, "isTimeSeparate") === "TRUE";
  let daily = null;
  if (scheduled) {
    const day = (tag(area, "dayCode") || "").toLowerCase();
    const st = iso(tag(g, "startTime")), en = iso(tag(g, "endTime"));
    // Only a plain "Daily" pattern is modelled. Anything else stays "active for the whole range" (cautious).
    if (day === "daily" && st && en) daily = { start: st.slice(11, 16), end: en.slice(11, 16) };
  }
  return { from, to, daily, scheduled };
}
function ringFrom(avxBlocks) {
  const ring = [];
  for (const a of avxBlocks) {
    const lat = coord(tag(a, "geoLat")), lon = coord(tag(a, "geoLong"));
    if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) ring.push([lon, lat]);
  }
  if (ring.length < 3) return null;
  const [f, l] = [ring[0], ring[ring.length - 1]];
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
  return ring.length >= 4 ? ring : null;
}
// -> { name, areas: [{ name, polygon: GeoJSON Polygon | null, lower, upper, schedule }] }
function parseDetail(xml) {
  if (typeof xml !== "string" || !/<XNOTAM-Update[\s>]/.test(xml)) throw new Error("not an FAA TFR detail file");
  const name = tag(xml, "txtLocalName") || "";
  const areas = blocks(xml, "TFRAreaGroup").map((g) => {
    const ase = blocks(g, "aseTFRArea")[0] || g;
    const merged = blocks(g, "abdMergedArea")[0];
    const ring = merged ? ringFrom(blocks(merged, "Avx")) : null;
    return { name: tag(ase, "txtName") || "", polygon: ring ? { type: "Polygon", coordinates: [ring] } : null,
      lower: altitude(ase, "Lower"), upper: altitude(ase, "Upper"), schedule: schedule(ase) };
  });
  return { name, areas };
}

module.exports = { parseList, parseShapes, parseDetail, notamFromKey, detailFile, coord };
