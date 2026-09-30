#!/usr/bin/env python3
"""Builds the Earth map for OpenFront's map generator (MASTERPLAN.md G1).

    python tools/overreach/build_earth.py --legacy "../My Map Game/build" \
        --etopo tools/overreach/data/ETOPO_2022_v1_60s_surface.tif \
        --relief tools/overreach/data/NE2_LR_LC_SR_W.zip [--width 5632] [--name earth]
    cd map-generator && go run . --maps=earth

Writes map-generator/assets/maps/<name>/{image.png, relief.png, info.json}. The map is equirectangular from
80 N to about 58 S (see earthgeo.py), with
  * land and water from the legacy builder's Natural Earth raster (terrain.npy, 7680x3840),
  * elevation from NOAA ETOPO 2022 (public domain), mapped to OpenFront's blue-channel terrain key,
  * the Greenland ice sheet impassable,
  * a painted relief layer from Natural Earth II (public domain), land only.
"""
import argparse
import json
import os
import zipfile

import numpy as np
import tifffile
from PIL import Image, ImageDraw
from scipy import ndimage

from earthgeo import LAT_TOP, Earth

Image.MAX_IMAGE_PIXELS = None
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The legacy raster: 7680x3840, lon -180..180, lat 90..-90. Classes from its builder.
LW, LH = 7680, 3840
LPX = LW / 360
T_OCEAN, T_LAND, T_RIVER, T_LAKE, T_ICE = 0, 1, 2, 3, 4

# map-generator's terrain key (map_generator.go): blue 106 is water, 140-158 plains, 159-178 highland,
# 179-200 mountain, black is impassable.
WATER, IMPASSABLE = 106, 0
ELEV_M = [0, 250, 500, 501, 1000, 1600, 1601, 2500, 4000]
ELEV_BLUE = [140, 150, 158, 159, 170, 178, 179, 190, 200]
ICE_SHEET_M = 1200  # ice above this is the sheet (Greenland), not a coastal glacier

# Channels too narrow for the tile size, opened the way the legacy builder opens its three: (name, line, width in tiles).
STRAITS = [
    ("Bosphorus", [(29.13, 41.23), (29.07, 41.13), (29.03, 41.07), (28.99, 41.01)], 2),
    ("Dardanelles", [(26.18, 40.03), (26.40, 40.15), (26.55, 40.30), (26.70, 40.43)], 2),
    ("Kerch", [(36.62, 45.46), (36.58, 45.30), (36.55, 45.15), (36.52, 45.05)], 2),
    ("Oresund", [(12.80, 56.05), (12.66, 55.88), (12.60, 55.68), (12.68, 55.45)], 2),
    ("Messina", [(15.66, 38.27), (15.62, 38.15), (15.66, 38.05)], 2),
    ("Bonifacio", [(9.12, 41.32), (9.25, 41.28)], 2),
    ("Johor", [(103.60, 1.46), (103.80, 1.45), (104.00, 1.42)], 2),
]
# Seas that must connect: (name, a lon/lat in one sea, b lon/lat in the other).
WATER_LINKS = [
    ("Black Sea - Aegean", (34.0, 43.0), (25.0, 38.0)),
    ("Mediterranean - Atlantic", (4.0, 38.0), (-20.0, 35.0)),
    ("Baltic - North Sea", (19.0, 57.0), (3.0, 56.0)),
    ("Red Sea - Arabian Sea", (38.0, 20.0), (62.0, 15.0)),
    ("Persian Gulf - Arabian Sea", (51.0, 27.0), (62.0, 15.0)),
    ("Azov - Black Sea", (36.8, 46.2), (34.0, 43.0)),
    ("Adriatic - Ionian", (15.0, 43.0), (19.0, 37.0)),
    ("Caribbean - Atlantic", (-75.0, 15.0), (-40.0, 25.0)),
    ("Sea of Japan - Pacific", (135.0, 40.0), (150.0, 35.0)),
    ("Andaman - South China Sea", (95.0, 10.0), (112.0, 12.0)),
]


def log(*a):
    print(*a, flush=True)


def resample(arr, box, size):
    """Area average of arr's `box` (x0, y0, x1, y1 in source pixels, fractional) onto size (w, h)."""
    im = Image.fromarray(np.ascontiguousarray(arr, np.float32), "F")
    return np.asarray(im.resize(size, Image.BOX, box=box), np.float32)


def land_mask(geo, legacy):
    t = np.load(os.path.join(legacy, "map8k", "terrain.npy"))
    box = (0, (90 - LAT_TOP) * LPX, LW, (90 - geo.lat_bottom) * LPX)
    frac = lambda m: resample(m.astype(np.float32), box, (geo.W, geo.H))
    land = frac(t == T_LAND) + frac(t == T_RIVER) + frac(t == T_ICE)  # lakes are water
    return land > 0.5, frac(t == T_ICE) > 0.5, t


def elevation(geo, path):
    """Mean ETOPO 2022 surface elevation in metres per tile."""
    et = tifffile.imread(path)  # int16, 10800 x 21600, 1/60 degree, 90 N to 90 S
    r0 = int((90 - LAT_TOP) * 60)
    rows = int((90 - geo.lat_bottom) * 60) - r0
    rows -= rows % 3
    blocks = np.empty((rows // 3, et.shape[1] // 3), np.float32)
    for i in range(0, rows, 600):  # 3x3 block means in chunks, to keep the float copy small
        a = et[r0 + i : r0 + min(i + 600, rows)].astype(np.float32)
        blocks[i // 3 : (i + a.shape[0]) // 3] = a.reshape(a.shape[0] // 3, 3, -1, 3).mean(axis=(1, 3))
    del et
    bottom = min((90 - geo.lat_bottom) * 60 - r0, rows) / 3
    return resample(blocks, (0, 0, blocks.shape[1], bottom), (geo.W, geo.H))


def connected(land, geo, a, b):
    lab, _ = ndimage.label(~land)
    xa, ya = geo.tile(*a)
    xb, yb = geo.tile(*b)
    la, lb = lab[ya, xa], lab[yb, xb]
    return bool(la and lb and la == lb)


def carve(land, geo):
    for name, line, width in STRAITS:
        img = Image.new("L", (geo.W, geo.H), 0)
        ImageDraw.Draw(img).line([geo.tile(*p) for p in line], fill=1, width=width)
        cut = np.asarray(img, bool) & land
        land[cut] = False
        log(f"carved {name}: {int(cut.sum())} tiles")
    closed = [n for n, a, b in WATER_LINKS if not connected(land, geo, a, b)]
    for n, a, b in WATER_LINKS:
        log(f"water link {n}: {'CLOSED' if n in closed else 'open'}")
    return closed


def terrain_image(land, ice, elev):
    blue = np.interp(np.maximum(elev, 0), ELEV_M, ELEV_BLUE).round().astype(np.uint8)
    img = np.where(land, blue, WATER).astype(np.uint8)
    img[land & ice & (elev > ICE_SHEET_M)] = IMPASSABLE
    return img


def relief_layer(geo, land, legacy_t, zip_path, data_dir):
    """Natural Earth II, land only: a tile's colour is the mean of the land pixels under it (so coast
    pixels never tint it blue); land tiles with no land pixel take the nearest tile's colour."""
    tif = os.path.join(data_dir, "NE2_LR_LC_SR_W.tif")
    if not os.path.exists(tif):
        with zipfile.ZipFile(zip_path) as z:
            name = next(n for n in z.namelist() if n.lower().endswith(".tif"))
            with z.open(name) as src, open(tif, "wb") as dst:
                dst.write(src.read())
    ne = tifffile.imread(tif)[..., :3]  # rows 90 N..90 S, columns -180..180
    ppd = ne.shape[1] / 360
    r0, r1 = int((90 - LAT_TOP) * ppd), int((90 - geo.lat_bottom) * ppd)
    ne = ne[r0:r1]
    # Legacy (Natural Earth too) says which NE2 pixels are land.
    ys = (np.arange(r0, r1) + 0.5) / ppd * LPX
    xs = (np.arange(ne.shape[1]) + 0.5) / ppd * LPX
    lt = legacy_t[np.ix_(np.clip(ys.astype(int), 0, LH - 1), np.clip(xs.astype(int), 0, LW - 1))]
    mask = ((lt == T_LAND) | (lt == T_RIVER) | (lt == T_ICE)).astype(np.float32)
    box = (0, 0, ne.shape[1], ne.shape[0])  # the crop is whole rows, so this is off by under a pixel
    size = (geo.W, geo.H)
    cover = resample(mask, box, size)
    rgb = np.empty((geo.H, geo.W, 3), np.float32)
    for c in range(3):
        rgb[..., c] = resample(ne[..., c] * mask, box, size) / np.maximum(cover, 1e-3)
    have = cover > 0.05
    _, (iy, ix) = ndimage.distance_transform_edt(~have, return_indices=True)
    rgb = rgb[iy, ix]
    alpha = np.where(land, 255, 0).astype(np.uint8)
    return np.dstack([rgb.clip(0, 255).astype(np.uint8), alpha])


def info(name, geo):
    return {
        "id": name.capitalize(),
        "name": "Earth" if name == "earth" else name.capitalize(),
        "translation_key": f"map.{name}",
        "categories": ["world"],
        "multiplayer_frequency": 1,
        "layers": [{"id": "relief", "placement": "land", "nukeable": False}],
        "nations": [],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--legacy", required=True)
    ap.add_argument("--etopo", required=True)
    ap.add_argument("--relief", help="Natural Earth II zip; omit for no relief layer")
    ap.add_argument("--width", type=int, default=5632)
    ap.add_argument("--name", default="earth")
    ap.add_argument("--out", default=os.path.join(REPO, "map-generator/assets/maps"))
    ap.add_argument("--preview", help="write a downsized preview png")
    args = ap.parse_args()

    geo = Earth(args.width)
    log(f"{geo.W}x{geo.H}, {geo.ppd:.2f} px/deg, lat {LAT_TOP} to {geo.lat_bottom:.2f}")
    land, ice, legacy_t = land_mask(geo, args.legacy)
    closed = carve(land, geo)
    if closed:
        raise SystemExit(f"water links closed: {closed}")
    elev = elevation(geo, args.etopo)
    img = terrain_image(land, ice, elev)
    log(f"land tiles {int(land.sum()):,}, impassable {int((img == IMPASSABLE).sum()):,}")

    out = os.path.join(args.out, args.name)
    os.makedirs(out, exist_ok=True)
    Image.fromarray(img, "L").save(os.path.join(out, "image.png"), optimize=True)
    json.dump(info(args.name, geo), open(os.path.join(out, "info.json"), "w", encoding="utf-8"), indent=2)
    if args.relief:
        rel = relief_layer(geo, land, legacy_t, args.relief, os.path.dirname(os.path.abspath(args.relief)))
        Image.fromarray(rel, "RGBA").save(os.path.join(out, "relief.png"), optimize=True)
    else:  # info.json names the layer, so drop it
        meta = json.load(open(os.path.join(out, "info.json"), encoding="utf-8"))
        meta.pop("layers")
        json.dump(meta, open(os.path.join(out, "info.json"), "w", encoding="utf-8"), indent=2)
    if args.preview:
        im = Image.fromarray(img, "L").convert("RGB")
        if args.relief:
            im = Image.alpha_composite(Image.new("RGBA", im.size, (20, 40, 90, 255)), Image.fromarray(rel, "RGBA")).convert("RGB")
        im.resize((im.width // 3, im.height // 3), Image.LANCZOS).save(args.preview)
    log("wrote", out)


if __name__ == "__main__":
    main()
