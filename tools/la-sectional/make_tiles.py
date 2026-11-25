# Cut the FAA Los Angeles Sectional GeoTIFF into Web Mercator tiles for SkyClear (l/{z}/{x}/{y}.webp).
# Same tile scheme as s/ and d/: 512 px tiles, Leaflet tileSize 512 + zoomOffset -1, file zooms 9 and 10.
# Georeferencing comes from the GeoTIFF itself (Lambert Conformal Conic, NAD83); see lcc.py.
# Usage: python -I make_tiles.py "<Los Angeles SEC.tif>" l 9,10,11   (zoom 11 took ~25 min; set SS = 2 for it)
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lcc  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
SRC, OUT = sys.argv[1], sys.argv[2]
im = Image.open(SRC)
P = lcc.from_tiff(im)
IDX = np.array(im)  # palette indices, ~205 MB
H, W = IDX.shape
PAL = np.array(im.getpalette()[:768], dtype=np.uint8).reshape(-1, 3)
SS = 3  # supersampling per axis (2 is enough for zoom 11, which is finer than the 42 m source)
TILE = 512
QUALITY = 68


def valid(col, row, lat):
    """True where the pixel is chart map area (not the legend, text tables, Basin inset or margins)."""
    ok = (row >= 1372) & (col <= 16606) & (lat >= 32.0) & (col >= 0) & (row < H)
    ok &= ~((row < 6252) & (col < 1590))           # legend panel and left text (top-left)
    ok &= ~((row >= 6252) & (row < 8090) & (col < 605))  # left margin between legend and inset
    ok &= ~((row >= 8090) & (col < 4690))           # Los Angeles Basin inset (different scale)
    return ok


def tile_lonlat(z, tx, ty, n):
    s = (np.arange(n) + 0.5) / n
    lon = (tx + s) / 2 ** z * 360 - 180
    yy = (ty + s) / 2 ** z
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * yy))))
    return np.meshgrid(lon, lat)


def render(z, tx, ty):
    n = TILE * SS
    lon, lat = tile_lonlat(z, tx, ty, n)
    col, row = P.pixel(lat, lon)
    m = valid(col, row, lat)
    if not m.any():
        return None
    c = np.clip(np.floor(col).astype(np.int64), 0, W - 1)
    r = np.clip(np.floor(row).astype(np.int64), 0, H - 1)
    rgb = PAL[IDX[r, c]]
    a = (m * 255).astype(np.uint8)
    rgba = np.dstack([rgb, a])
    img = Image.fromarray(rgba, "RGBA")
    # premultiply-free downscale: average colour only where alpha is set
    big = img.resize((TILE, TILE), Image.LANCZOS)
    return big


def tiles_for(z):
    # tile range covering the chart's lat/lon extent (from the FAA metadata bounding box)
    W_, E_, S_, N_ = -122.40, -114.50, 31.89, 36.68
    def tx(lon): return int((lon + 180) / 360 * 2 ** z)
    def ty(lat):
        la = math.radians(lat)
        return int((1 - math.log(math.tan(la) + 1 / math.cos(la)) / math.pi) / 2 * 2 ** z)
    return [(x, y) for x in range(tx(W_), tx(E_) + 1) for y in range(ty(N_), ty(S_) + 1)]


count = 0
for z in [int(v) for v in (sys.argv[3].split(",") if len(sys.argv) > 3 else ["10", "9"])]:
    for x, y in tiles_for(z):
        t = render(z, x, y)
        if t is None:
            continue
        d = os.path.join(OUT, str(z), str(x))
        os.makedirs(d, exist_ok=True)
        t.save(os.path.join(d, f"{y}.webp"), "WEBP", quality=QUALITY, method=6)
        count += 1
    print("zoom", z, "done, total tiles", count, flush=True)
