# Ellipsoidal Lambert Conformal Conic (2SP), Snyder 1987 eq. 15-1..15-11, GRS80 / NAD83.
# Parameters and pixel geometry are read from the FAA GeoTIFF (tags 33550, 33922, 34736).
import math
import numpy as np

A = 6378137.0
INVF = 298.257222101
F = 1 / INVF
E = math.sqrt(2 * F - F * F)


def _m(phi):
    return np.cos(phi) / np.sqrt(1 - (E * np.sin(phi)) ** 2)


def _t(phi):
    s = E * np.sin(phi)
    return np.tan(np.pi / 4 - phi / 2) / ((1 - s) / (1 + s)) ** (E / 2)


class LCC:
    def __init__(self, lat0, lon0, sp1, sp2, x_corner, y_corner, px, py):
        p1, p2, p0 = map(math.radians, (sp1, sp2, lat0))
        m1, m2 = _m(p1), _m(p2)
        t1, t2, t0 = _t(p1), _t(p2), _t(p0)
        self.n = (math.log(m1) - math.log(m2)) / (math.log(t1) - math.log(t2))
        self.Fc = m1 / (self.n * t1 ** self.n)
        self.rho0 = A * self.Fc * t0 ** self.n
        self.lon0 = math.radians(lon0)
        self.xc, self.yc, self.px, self.py = x_corner, y_corner, px, py

    def forward(self, lat, lon):
        """degrees -> projected metres"""
        phi = np.radians(lat)
        lam = np.radians(lon)
        rho = A * self.Fc * _t(phi) ** self.n
        th = self.n * (lam - self.lon0)
        return rho * np.sin(th), self.rho0 - rho * np.cos(th)

    def pixel(self, lat, lon):
        """degrees -> (col, row) in the GeoTIFF; pixel (0,0) top-left corner at (xc, yc)"""
        x, y = self.forward(lat, lon)
        return (x - self.xc) / self.px, (self.yc - y) / self.py


def from_tiff(im):
    t = im.tag_v2
    sx, sy, _ = t[33550]
    _, _, _, xc, yc, _ = t[33922]
    lat0, lon0, sp1, sp2 = t[34736][:4]
    return LCC(lat0, lon0, sp1, sp2, xc, yc, sx, sy)


def inverse(P, col, row):
    """GeoTIFF pixel -> (lat, lon) degrees (Snyder 15-5, 7-9 iteration)"""
    x = P.xc + col * P.px
    y = P.yc - row * P.py
    dy = P.rho0 - y
    rho = math.copysign(math.hypot(x, dy), P.n)
    th = math.atan2(x, dy) if P.n > 0 else math.atan2(-x, -dy)
    t = (rho / (A * P.Fc)) ** (1 / P.n)
    phi = math.pi / 2 - 2 * math.atan(t)
    for _ in range(15):
        s = E * math.sin(phi)
        phi = math.pi / 2 - 2 * math.atan(t * ((1 - s) / (1 + s)) ** (E / 2))
    return math.degrees(phi), math.degrees(th / P.n + P.lon0)
