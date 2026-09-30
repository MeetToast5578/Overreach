"""Geometry of the Earth map (MASTERPLAN.md section 3): equirectangular, longitude -180..180, from 80 N
down to about 58 S, square pixels. Shared by build_earth.py and build_1836.py."""
import numpy as np

LAT_TOP = 80.0
LAT_SPAN = 138.0  # 80 N to 58 S; the exact bottom follows from the height, which is a multiple of 4


class Earth:
    def __init__(self, width):
        self.W = width
        self.H = round(width * LAT_SPAN / 360 / 4) * 4
        self.ppd = width / 360  # pixels per degree, both ways
        self.lat_bottom = LAT_TOP - self.H / self.ppd

    def lon(self, x):
        return (np.asarray(x) + 0.5) / self.ppd - 180

    def lat(self, y):
        return LAT_TOP - (np.asarray(y) + 0.5) / self.ppd

    def tile(self, lon, lat):
        """The (x, y) tile holding a lon/lat."""
        return int((lon + 180) * self.ppd) % self.W, int((LAT_TOP - lat) * self.ppd)

    def lonlat_grid(self):
        lon = np.broadcast_to(self.lon(np.arange(self.W)), (self.H, self.W))
        lat = np.broadcast_to(self.lat(np.arange(self.H))[:, None], (self.H, self.W))
        return lon, lat
