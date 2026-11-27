// Point check against the stored NOTAMs, reusing the TFR import's turf distance and schedule logic.
const { checkRadius } = require("../_tfr/check");
// great-circle miles between two points (for the rough location of notices whose area can't be placed)
function pointMi(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

const toTfrShape = (n) => ({
  notamId: n.number + (n.kind === "uas" ? " " + n.location : ""), nmsId: n.nmsId, kind: n.kind, location: n.location, text: n.text,
  // only areas SkyClear could place; unplaceable ones are handled by refPoint below, so a far notice with one
  // unknown area is not pulled into every check
  areas: n.areas.map((a, i) => [a, i]).filter(([a]) => a.polygon).map(([a, i]) => ({ name: n.areas.length > 1 ? "Area " + (i + 1) : "", polygon: a.polygon, lower: a.lower, upper: a.upper, schedule: n.schedule, note: a.note })),
});
const UNKNOWN_NEAR_MI = 30; // list "area unknown" notices whose rough location is this close

function check(state, lat, lon, radiusMi, fromMs, toMs) {
  const all = Object.values(state.notams || {});
  const placed = all.filter((n) => n.areas.some((a) => a.polygon));
  const hits = checkRadius(placed.map(toTfrShape), lat, lon, radiusMi, fromMs, toMs).map((h) => {
    const n = state.notams[h.nmsId];
    return { number: n.number, kind: n.kind, location: n.location, text: n.text, mi: h.mi, inside: h.inside, areaKnown: true, schedule: n.schedule, areas: h.areas };
  });
  // Unknown areas: never dropped; listed when the notice's rough location is nearby, counted otherwise.
  const unk = all.filter((n) => n.areas.some((a) => !a.polygon)).map((n) => {
    const p = n.refPoint; const mi = p ? +pointMi(lat, lon, p.lat, p.lon).toFixed(1) : null;
    return { n, mi };
  });
  const near = unk.filter((x) => x.mi != null && x.mi <= UNKNOWN_NEAR_MI).sort((a, b) => a.mi - b.mi)
    .map(({ n, mi }) => ({ number: n.number, kind: n.kind, location: n.location, text: n.text, roughMi: mi, notes: n.areas.filter((a) => !a.polygon).map((a) => a.note), schedule: n.schedule }));
  return { matches: hits, unknownArea: near, unknownElsewhere: unk.length - near.length, totalStored: all.length };
}

module.exports = { check, toTfrShape, pointMi, UNKNOWN_NEAR_MI };
