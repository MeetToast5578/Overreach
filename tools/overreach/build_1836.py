#!/usr/bin/env python3
"""Builds resources/scenarios/world-1836.json: the world on 1 January 1836 on
OpenFront's World map (SANDBOX.md F3, ROADMAP.md section 3).

    python tools/overreach/build_1836.py --legacy "../My Map Game/build" \
        --geojson world_1815.geojson [--preview preview.png]

Inputs outside the repo:
  --legacy   the old map builder's cache: map8k/ids.npy + nations.json (modern
             country per pixel), map8k/adm_raw.npy + states.json (admin-1 per
             pixel), both 7680x3840 equirectangular, and cities15000.zip
             (GeoNames) for the town checks.
  --geojson  aourednik/historical-basemaps geojson/world_1815.geojson (GPL-3.0,
             so the scenario it makes is GPL too).

What 1836 looks like (polity -> nation, rules, checks) is in world1836.py.
Rules run in order and the last match wins, as ROADMAP.md 3.3 describes.
"""
import argparse
import io
import json
import math
import os
import sys
import zipfile

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import shape

import world1836 as data
from earthgeo import Earth

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The legacy rasters: 7680x3840, lon -180..180, lat 90..-90.
LW, LH = 7680, 3840
LPX = LW / 360
POLITY_FILL_DEG = 0.55  # 1815 outlines are coarse: land within this of a polity takes it (about 55 km)


def legacy_index(lon, lat):
    px = np.clip(((lon + 180) * LPX).astype(int), 0, LW - 1)
    py = np.clip(((90 - lat) * LPX).astype(int), 0, LH - 1)
    return py, px


def paint_polities(features):
    """1815 polity index per legacy pixel (0 = none), in file order."""
    raster = np.zeros((LH, LW), np.uint16)
    names = [""]
    for f in features:
        p = f["properties"]
        name = (p.get("NAME") or "").strip() or (p.get("SUBJECTO") or "").strip() or "(none)"
        if name not in names:
            names.append(name)
        value = names.index(name)
        geom = shape(f["geometry"])
        polys = getattr(geom, "geoms", [geom])
        for poly in polys:
            if poly.is_empty:
                continue
            rings = [(poly.exterior.coords, 1)] + [(r.coords, 0) for r in poly.interiors]
            xs, ys = poly.exterior.xy
            x0 = max(0, int((min(xs) + 180) * LPX) - 1)
            x1 = min(LW - 1, int(math.ceil((max(xs) + 180) * LPX)) + 1)
            y0 = max(0, int((90 - max(ys)) * LPX) - 1)
            y1 = min(LH - 1, int(math.ceil((90 - min(ys)) * LPX)) + 1)
            if x1 <= x0 or y1 <= y0:
                continue
            img = Image.new("L", (x1 - x0 + 1, y1 - y0 + 1), 0)
            d = ImageDraw.Draw(img)
            for coords, fill in rings:
                pts = [((lon + 180) * LPX - x0, (90 - lat) * LPX - y0) for lon, lat in coords]
                if len(pts) >= 3:
                    d.polygon(pts, fill=fill)
            m = np.asarray(img, bool)
            raster[y0:y1 + 1, x0:x1 + 1][m] = value
    return raster, names


def nearest_fill(values, have, where):
    """values at `where` tiles copied from the nearest `have` tile."""
    _, (iy, ix) = ndimage.distance_transform_edt(~have, return_indices=True)
    out = values.copy()
    out[where] = values[iy[where], ix[where]]
    return out


class Grid:
    def __init__(self, args):
        maps = os.path.join(REPO, "resources/maps", args.map)
        manifest = json.load(open(os.path.join(maps, "manifest.json"), encoding="utf-8"))
        self.geo = Earth(manifest["map"]["width"])
        assert self.geo.H == manifest["map"]["height"], "build_earth.py and the map disagree on the size"
        of = np.fromfile(os.path.join(maps, "map.bin"), np.uint8).reshape(self.geo.H, self.geo.W)
        self.land = ((of & 0x80) > 0) & ((of & 0x1F) != 31)
        self.lon, self.lat = self.geo.lonlat_grid()
        py, px = legacy_index(self.lon, self.lat)

        cache = os.path.join(args.legacy, "map8k")
        nations = json.load(open(os.path.join(cache, "nations.json"), encoding="utf-8"))
        self.a3_id = {a3: i for a3, i in nations["a3"].items()}
        states = json.load(open(os.path.join(cache, "states.json"), encoding="utf-8"))
        self.adm_names = {}  # (name, a3) -> ids
        for s in states:
            self.adm_names.setdefault((s["name"], s["a3"]), []).append(s["id"])
        a3 = np.load(os.path.join(cache, "ids.npy"))[py, px].astype(np.int32)
        adm = np.load(os.path.join(cache, "adm_raw.npy"))[py, px].astype(np.int32)

        geo = json.load(open(args.geojson, encoding="utf-8"))
        pol8k, self.polity_names = paint_polities(geo["features"])
        pol = pol8k[py, px].astype(np.int32)

        # The map's coasts can differ from Natural Earth's: its land beyond
        # theirs takes the nearest values, and polity gaps of up to 0.55 degrees
        # (coastline mismatch) the nearest polity.
        ne = a3 > 0
        a3 = nearest_fill(a3, ne, self.land & ~ne)
        adm = nearest_fill(adm, ne & (adm > 0), self.land & (adm == 0))
        has_pol = pol > 0
        dist = ndimage.distance_transform_edt(~has_pol)
        pol = nearest_fill(pol, has_pol, self.land & ~has_pol & (dist <= POLITY_FILL_DEG * self.geo.ppd))
        self.a3, self.adm, self.pol = a3, adm, pol


class Sel:
    """A tile selector for the rules: combine with |, & and ~."""

    def __init__(self, f):
        self.f = f

    def __call__(self, g):
        return self.f(g)

    def __or__(self, o):
        return Sel(lambda g: self(g) | o(g))

    def __and__(self, o):
        return Sel(lambda g: self(g) & o(g))

    def __invert__(self):
        return Sel(lambda g: ~self(g))


def _ids(table, keys, what):
    missing = [k for k in keys if k not in table]
    if missing:
        raise KeyError(f"unknown {what}: {missing}")
    return [table[k] for k in keys]


def C(*a3s):
    """Modern countries (Natural Earth ISO3)."""
    return Sel(lambda g: np.isin(g.a3, _ids(g.a3_id, a3s, "country")))


def A(c, *names):
    """Admin-1 regions of country c (Natural Earth names)."""

    def f(g):
        ids = [i for key in _ids(g.adm_names, [(n, c) for n in names], "admin-1") for i in key]
        return np.isin(g.adm, ids)

    return Sel(f)


def P(*names):
    """1815 polities (historical-basemaps NAME, or SUBJECTO when unnamed)."""
    return Sel(lambda g: np.isin(g.pol, _ids({n: i for i, n in enumerate(g.polity_names)}, names, "polity")))


def B(lon0, lat0, lon1, lat1):
    """A lon/lat box (west, south, east, north)."""
    return Sel(lambda g: (g.lon >= lon0) & (g.lon < lon1) & (g.lat >= lat0) & (g.lat < lat1))


ALL = Sel(lambda g: np.ones(g.land.shape, bool))


def assign(g):
    tags = [None] + list(data.NATIONS)
    index = {t: i for i, t in enumerate(tags)}
    index["-"] = 0
    owner = np.zeros(g.land.shape, np.int32)
    for name, tag in data.POLITIES.items():
        owner[P(name)(g) & g.land] = index[tag]
    for tag, sel in data.RULES(C, A, P, B, ALL):
        if tag not in index:
            raise KeyError(f"rule for unknown tag {tag}")
        owner[sel(g) & g.land] = index[tag]
    return owner, tags


def load_towns(legacy):
    towns = {}
    with zipfile.ZipFile(os.path.join(legacy, "cities15000.zip")) as z:
        with z.open("cities15000.txt") as f:
            for line in io.TextIOWrapper(f, encoding="utf-8"):
                c = line.rstrip("\n").split("\t")
                name, ascii_name, alt, lat, lon, cc, pop = c[1], c[2], c[3], float(c[4]), float(c[5]), c[8], int(c[14])
                for n in {name, ascii_name, *alt.split(",")}:
                    key = (n.lower(), cc)
                    if key not in towns or towns[key][2] < pop:
                        towns[key] = (lon, lat, pop)
    return towns


def town_tile(g, name, lon, lat):
    """A town's tile: the nearest land within 3 tiles (towns on small islands
    or coasts), or None. data.TOWN_AT moves towns the map's coast misplaces."""
    lon, lat = data.TOWN_AT.get(name, (lon, lat))
    H, W = g.land.shape
    x, y = g.geo.tile(lon, lat)
    x, y = min(max(x, 0), W - 1), min(max(y, 0), H - 1)
    for r in range(0, 4):
        ys, xs = np.mgrid[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1]
        ok = g.land[ys, xs]
        if ok.any():
            d = np.where(ok, (ys - y) ** 2 + (xs - x) ** 2, 1 << 30)
            i = np.unravel_index(np.argmin(d), d.shape)
            return int(xs[i]), int(ys[i])
    return None


def check_towns(g, owner, tags, towns):
    failures = []
    for town, cc, want in data.CHECKS:
        t = towns.get((town.lower(), cc))
        if t is None:
            failures.append(f"{town} ({cc}): not in GeoNames")
            continue
        at = town_tile(g, town, t[0], t[1])
        got = None if at is None else tags[owner[at[1], at[0]]] or "-"
        if got != want:
            failures.append(f"{town} ({cc}): {got}, expected {want}")
    return failures


def scenario(owner, tags, map_name):
    present = [t for t in tags[1:] if (owner == tags.index(t)).any()]
    empty = [t for t in tags[1:] if t not in present]
    order = {t: i + 1 for i, t in enumerate(present)}
    remap = np.zeros(len(tags), np.int32)
    for t, i in order.items():
        remap[tags.index(t)] = i
    flags = os.path.join(REPO, "resources/flags")
    nations = []
    for t in present:
        name, color, flag = data.NATIONS[t]
        n = {"id": f"o1836{t}", "name": name, "color": color or palette(t)}
        if flag and os.path.exists(os.path.join(flags, f"{flag}.svg")):
            n["flag"] = flag
        elif flag:
            print(f"warning: no flag file {flag}.svg for {t}")
        nations.append(n)
    alliances = []
    for group in data.ALLIANCES:
        members = [order[t] - 1 for t in group if t in order]
        alliances += [[a, b] for i, a in enumerate(members) for b in members[i + 1:]]
    return {
        "version": 1,
        "map": map_name,
        "mapSize": "Normal",
        "startYear": 1836,
        "nations": nations,
        "alliances": alliances,
        "subjects": [[order[o] - 1, order[s] - 1, kind] for o, s, kind in data.SUBJECTS
                     if o in order and s in order],
        "owners": runs_of(remap[owner]),
    }, empty


def runs_of(grid):
    """A grid in tile order (row by row) as [value, length, ...] runs."""
    flat = grid.ravel()
    starts = np.concatenate([[0], np.flatnonzero(np.diff(flat)) + 1])
    lengths = np.diff(np.concatenate([starts, [flat.size]]))
    runs = np.empty(2 * len(starts), np.int64)
    runs[0::2], runs[1::2] = flat[starts], lengths
    return runs.tolist()


MIN_PIECE = 24  # tiles, about 650 km2 on the Earth map


def provinces(args, g, owner):
    """The scenario's home provinces: the legacy builder's 5,245, cut where
    1836 borders cross them. Cut pieces under MIN_PIECE tiles join the
    same-owner neighbour they share most edge with. A piece holding its
    province's main town is named after it and has it as capital; the rest
    take the subregion's name."""
    cache = os.path.join(args.legacy, "map8k")
    H, W = g.land.shape
    py, px = legacy_index(g.lon, g.lat)
    pro = np.load(os.path.join(cache, "provinces.npy"))[py, px].astype(np.int64)
    has = pro > 0
    pro = nearest_fill(pro, has, g.land & ~has)
    key = np.where(g.land, pro * 1024 + owner, -1)
    uniq, piece = np.unique(key, return_inverse=True)  # piece 0 is water
    piece = piece.reshape(H, W)
    legacy_of, owner_of = uniq // 1024, uniq % 1024

    size = np.bincount(piece.ravel(), minlength=len(uniq))
    small = size < MIN_PIECE
    small[0] = False
    a = np.concatenate([piece[:, :-1].ravel(), piece[:-1, :].ravel()])
    b = np.concatenate([piece[:, 1:].ravel(), piece[1:, :].ravel()])
    keep = (a != b) & (a > 0) & (b > 0)
    pairs = np.concatenate([np.stack([a[keep], b[keep]], 1), np.stack([b[keep], a[keep]], 1)])
    pairs = pairs[small[pairs[:, 0]] & (owner_of[pairs[:, 0]] == owner_of[pairs[:, 1]])]
    edges, counts = np.unique(pairs, axis=0, return_counts=True)
    target = np.arange(len(uniq))
    best = {}
    for (s, n), c in zip(edges.tolist(), counts.tolist()):
        if s not in best or c > best[s][1]:
            best[s] = (n, c)

    def root(i):
        while target[i] != i:
            i = target[i]
        return i

    for s in sorted(best, key=lambda s: size[s]):
        if root(best[s][0]) != s:
            target[s] = best[s][0]
    target = np.array([root(i) for i in range(len(uniq))])
    ids, home = np.unique(target[piece], return_inverse=True)  # ids[0] is water
    home = home.reshape(H, W)

    records = json.load(open(os.path.join(cache, "provinces.json"), encoding="utf-8"))
    subs = {s["id"]: s["name"] for s in records["subregions"]}
    legacy = {p["id"]: p for p in records["provinces"]}
    # A province's town is the biggest whose tile lies in it, from any legacy
    # province (small ones, like Cairo's, vanish or merge at this size); a
    # nation's capital (data.CAPITALS) beats any size.
    rank = lambda c: (c["name"] in data.CAPITALS.values(), c["pop"])
    towns = {}
    for rec in records["provinces"]:
        city = rec["city"]
        at = city and town_tile(g, city["name"], city["lon"], city["lat"])
        i = home[at[1], at[0]] if at else 0
        if i and (i not in towns or rank(city) > rank(towns[i][0])):
            towns[i] = (city, at)
    names, capitals, populations = [], [], []
    for i, root_pc in enumerate(ids[1:], 1):
        best = towns.get(i)
        sub = legacy[int(legacy_of[root_pc])]["sub"]
        names.append(best[0]["name"] if best else subs.get(sub, f"Province {i}"))
        capitals.append(best[1][1] * W + best[1][0] if best else None)
        # 1836 people: today's (GeoNames) times 1836's share of today's world,
        # ~1.1 of 8 billion; the calendar grows them 1% a year back to about
        # today's by 2036. ponytail: one factor for the world; ROADMAP 3.6
        # scales each country to its own 1836 total.
        populations.append(best[0]["pop"] * 137 // 1000 if best else 0)
    # Each province's modern country (most of its tiles), the homelands of
    # formable nations (Formables.ts): Germany is the provinces in DEU.
    vals, counts = np.unique((home.astype(np.int64) * 1024 + g.a3)[home > 0], return_counts=True)
    most = {}
    for v, c in zip(vals.tolist(), counts.tolist()):
        pid, a = divmod(v, 1024)
        if c > most.get(pid, (0, 0))[0]:
            most[pid] = (c, a)
    code = {i: a3 for a3, i in g.a3_id.items()}
    countries = [code.get(most[i][1], "") if i in most else "" for i in range(1, len(names) + 1)]
    return {"names": names, "capitals": capitals, "populations": populations,
            "countries": countries, "home": runs_of(home)}, home


def nation_capitals(out, owner, tags):
    """Each nation's capital town, where it starts with a City: CAPITALS
    names it, else its biggest town."""
    prov = out["provinces"]
    towns = {}
    for name, cap, pop in zip(prov["names"], prov["capitals"], prov["populations"]):
        if cap is not None and tags[owner.flat[cap]]:
            towns.setdefault(tags[owner.flat[cap]], []).append((name, cap, pop))
    for n in out["nations"]:
        tag = n["id"][5:]
        mine = towns.get(tag)
        if not mine:
            continue
        want = data.CAPITALS.get(tag)
        if tag in data.CAPITALS and want is None:
            continue
        pick = next((t for t in mine if t[0] == want), None)
        if want and pick is None:
            print(f"warning: no town {want} for {tag}'s capital")
        n["capital"] = (pick or max(mine, key=lambda t: t[2]))[1]


def palette(tag):
    """A stable, muted colour for nations without a chosen one."""
    h = int.from_bytes(tag.encode(), "big") * 2654435761 % 360
    s, l = 0.45 + (h % 7) * 0.03, 0.5 + (h % 5) * 0.03
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    r, g_, b = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)][h // 60 % 6]
    m = l - c / 2
    return "#%02x%02x%02x" % tuple(int(round((v + m) * 255)) for v in (r, g_, b))


def preview(path, g, owner, tags, scenario_nations, home):
    colors = np.zeros((len(tags), 3), np.uint8)
    for n in scenario_nations:
        t = n["id"][5:]
        colors[tags.index(t)] = [int(n["color"][i:i + 2], 16) for i in (1, 3, 5)]
    img = np.where(g.land[..., None], np.uint8([200, 190, 160]), np.uint8([40, 70, 110]))
    owned = owner > 0
    img[owned] = colors[owner[owned]]
    for grid, shade in ((home, 0.7), (owner, 0.15)):
        edge = np.zeros_like(owned)
        edge[:, 1:] |= grid[:, 1:] != grid[:, :-1]
        edge[1:, :] |= grid[1:, :] != grid[:-1, :]
        img[edge & g.land] = (img[edge & g.land] * shade).astype(np.uint8)
    Image.fromarray(img).save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--legacy", required=True)
    ap.add_argument("--geojson", required=True)
    ap.add_argument("--map", default="earth", help="a folder of resources/maps (built by build_earth.py)")
    ap.add_argument("--out", default=os.path.join(REPO, "resources/scenarios/world-1836.json"))
    ap.add_argument("--preview")
    ap.add_argument("--polities", action="store_true", help="list 1815 polities with their centres and exit")
    args = ap.parse_args()

    g = Grid(args)
    g.map_name = json.load(open(os.path.join(REPO, "resources/maps", args.map, "manifest.json"), encoding="utf-8"))["name"]
    if args.polities:
        for i, name in enumerate(g.polity_names[1:], 1):
            m = (g.pol == i) & g.land
            if m.any():
                print(f"{int(m.sum()):7d}  {g.lon[m].mean():7.1f} {g.lat[m].mean():6.1f}  {name}")
        return

    owner, tags = assign(g)
    out, empty = scenario(owner, tags, g.map_name)
    if empty:
        print(f"warning: no land for {', '.join(empty)}")
    failures = check_towns(g, owner, tags, load_towns(args.legacy))
    owned = int((owner > 0).sum())
    print(f"{len(out['nations'])} nations, {owned} of {int(g.land.sum())} land tiles owned, "
          f"{len(out['owners']) // 2} runs, {len(data.CHECKS) - len(failures)}/{len(data.CHECKS)} town checks pass")
    for f in failures:
        print("  FAIL", f)
    out["provinces"], home = provinces(args, g, owner)
    nation_capitals(out, owner, tags)
    print(f"{len(out['provinces']['names'])} provinces, "
          f"{sum(c is not None for c in out['provinces']['capitals'])} with a capital town")
    if args.preview:
        preview(args.preview, g, owner, tags, out["nations"], home)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {args.out} ({os.path.getsize(args.out) // 1024} KB)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
