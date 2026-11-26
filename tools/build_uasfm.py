#!/usr/bin/env python3
"""Build data/uasfm_ca_lv.json (compact LAANC ceiling lookup) from an FAA UAS FacilityMap GeoJSON export.

Usage: python3 tools/build_uasfm.py path/to/california_lasvegas.json [data/uasfm_ca_lv.json]

Source: FAA UAS FacilityMap Data (FAA UAS Data Delivery System, https://udds-faa.opendata.arcgis.com/).
Export tip: in mapshaper keep only the area you need (see CLAUDE.md), then export GeoJSON.
Grid: 30 arc-seconds = 1/120 degree. Cell key = "<floor(west*120)>,<floor(south*120)>".
Value = [ceiling_ft_AGL, facility_index, ...]. Lowest ceiling wins if cells overlap.
"""
import json, sys, collections

src = sys.argv[1]
dst = sys.argv[2] if len(sys.argv) > 2 else "data/uasfm_ca_lv.json"
d = json.load(open(src))
cells = collections.defaultdict(list)
names = {}
eff = set()
for f in d["features"]:
    p = f["properties"]
    ring = f["geometry"]["coordinates"][0]
    xs = [c[0] for c in ring]; ys = [c[1] for c in ring]
    w, s = min(xs), min(ys)
    x, y = round(w * 120), round(s * 120)
    # sanity: every feature must be one 1/120-degree grid square
    assert abs(w * 120 - x) < 0.02 and abs(s * 120 - y) < 0.02 and abs((max(xs) - w) * 120 - 1) < 0.02, "not a grid square: %r" % p.get("OBJECTID")
    ids = []
    for i in range(1, 6):
        k = p.get("APT%d_ICAO" % i) or p.get("APT%d_FAAID" % i)
        if k:
            ids.append(k); names[k] = p.get("APT%d_NAME" % i, "")
    cells[(x, y)].append((p["CEILING"], ids))
    eff.add(p.get("MAP_EFF"))
fac = {}
out = {}
for (x, y), v in cells.items():
    v.sort(key=lambda t: t[0])
    ids = sorted({a for t in v for a in t[1]})
    out["%d,%d" % (x, y)] = [v[0][0]] + [fac.setdefault(a, len(fac)) for a in ids]
doc = {"v": 1, "cell": 120, "mapEff": sorted(e for e in eff if e), "builtFrom": src.split("/")[-1],
       "fac": [[k, names.get(k, "")] for k, _ in sorted(fac.items(), key=lambda t: t[1])], "c": out}
json.dump(doc, open(dst, "w"), separators=(",", ":"))
print("cells:", len(out), "facilities:", len(fac), "effective:", doc["mapEff"])
