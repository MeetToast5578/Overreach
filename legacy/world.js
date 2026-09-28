/* Overreach — the world: nations -> regions -> provinces.
 *
 * The province map is built offline by tools/build_map.py and shipped as a raster
 * (province id per pixel) plus a table (names, cities, regions, terrain, adjacency,
 * sea links). This file only loads it: it indexes the pixels of whichever resolution
 * the page chose (8k, or 4k on small devices) and answers questions about it.
 *
 * Positions (centroid, bbox, city) are in pixels of the loaded raster. Distances that
 * matter to the simulation (area, travel) come from the table, so the engine behaves
 * the same at either resolution.
 *
 * No DOM: the page and the headless tests both load this file.
 */
(function (global) {
  'use strict';

  let MD = null, T = null;           // MAPDATA and its province table
  let W = 0, H = 0, N = 0, K = 1;    // loaded raster size; K = loaded px per 8k px
  let PROV = null, CORE = null, TERR = null;
  let count = 0, totalLand = 0;
  let pSize, pX0, pY0, pX1, pY1;
  let pixStart, pixList, adjStart, adjList, natStart, natList;
  let seaOf = [], straitSet = new Set();
  const NAT = [], IDS = [], CAPITAL = [];
  const REGION = [], REG_PROVS = [];

  /** md: window.MAPDATA; prov: Uint16Array of province ids per pixel; terr: Uint8Array of
   *  terrain classes per pixel (0 ocean, 1 land, 2 river, 3 lake, 4 ice); w, h: raster size. */
  function build(md, prov, terr, w, h) {
    const t0 = now();
    MD = md; T = md.provinces; PROV = prov; TERR = terr;
    W = w; H = h; N = W * H; K = W / md.w;
    count = T.count;
    NAT.length = 0; IDS.length = 0; CAPITAL.length = 0; REGION.length = 0; REG_PROVS.length = 0;
    for (const n of md.nations) { NAT[n.id] = n; IDS.push(n.id); }
    for (const r of md.regions) { REGION[r.id] = r; REG_PROVS[r.id] = []; }
    for (let i = 1; i <= count; i++) REG_PROVS[T.region[i - 1]].push(i);

    // Nation id per pixel, and each province's pixels and bounding box.
    const natLut = new Uint8Array(count + 1);
    for (let i = 1; i <= count; i++) natLut[i] = T.nation[i - 1];
    CORE = new Uint8Array(N);
    pSize = new Int32Array(count + 1);
    pX0 = new Int32Array(count + 1).fill(W); pY0 = new Int32Array(count + 1).fill(H);
    pX1 = new Int32Array(count + 1).fill(-1); pY1 = new Int32Array(count + 1).fill(-1);
    totalLand = 0;
    for (let y = 0, p = 0; y < H; y++) {
      for (let x = 0; x < W; x++, p++) {
        const id = PROV[p];
        if (!id) continue;
        CORE[p] = natLut[id];
        pSize[id]++;
        if (x < pX0[id]) pX0[id] = x;
        if (x > pX1[id]) pX1[id] = x;
        if (y < pY0[id]) pY0[id] = y;
        if (y > pY1[id]) pY1[id] = y;
        totalLand++;
      }
    }
    pixStart = new Int32Array(count + 2);
    for (let i = 1; i <= count; i++) pixStart[i + 1] = pixStart[i] + pSize[i];
    pixList = new Int32Array(totalLand);
    const cur = pixStart.slice();
    for (let p = 0; p < N; p++) { const id = PROV[p]; if (id) pixList[cur[id]++] = p; }

    // Adjacency straight from the table (CSR, 1-based province ids).
    adjStart = new Int32Array(count + 2);
    for (let i = 1; i <= count + 1; i++) adjStart[i] = T.adjStart[i - 1];
    adjList = Uint16Array.from(T.adj);
    seaOf = Array.from({ length: count + 1 }, () => []);
    for (const [a, b] of T.sea) { seaOf[a].push(b); seaOf[b].push(a); }
    straitSet = new Set();
    for (const [a, b] of T.straits) { straitSet.add(a * 65536 + b); straitSet.add(b * 65536 + a); }

    const deg = new Int32Array(258);
    for (let i = 1; i <= count; i++) deg[natLut[i] + 1]++;
    natStart = new Int32Array(258);
    for (let i = 1; i < 258; i++) natStart[i] = natStart[i - 1] + deg[i];
    natList = new Uint16Array(count);
    const nc = natStart.slice();
    for (let i = 1; i <= count; i++) natList[nc[natLut[i]]++] = i;

    // Capital: the nation's capital city if it has one, else its most populous province.
    for (const id of IDS) {
      let best = 0, bestScore = -1;
      for (const i of provincesOf(id)) {
        const c = T.city[i - 1];
        const score = (c && c[4] ? 1e12 : 0) + T.pop[i - 1];
        if (score > bestScore) { bestScore = score; best = i; }
      }
      CAPITAL[id] = best;
    }
    return { provinces: count, regions: md.regions.length, totalLand, ms: now() - t0, scale: K };
  }

  const provincesOf = (nat) => natList.subarray(natStart[nat], natStart[nat + 1]);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const PX_PER_DEG = () => W / 360;

  global.World = {
    build,
    dims: () => ({ W, H, N, scale: K }),
    prov: () => PROV,
    core: () => CORE,
    terrain: () => TERR,
    count: () => count,
    nationOf: (i) => T.nation[i - 1],
    regionOf: (i) => T.region[i - 1],
    region: (r) => REGION[r],
    regionProvinces: (r) => REG_PROVS[r] || [],
    regions: () => MD.regions,
    sizeOf: (i) => pSize[i],
    areaKm: (i) => T.areaKm[i - 1],
    popOf: (i) => T.pop[i - 1],
    nameOf: (i) => T.name[i - 1],
    /** { name, lon, lat, pop, capital } or null when the province has no town. */
    cityOf: (i) => {
      const c = T.city[i - 1];
      return c ? { name: c[0], lon: c[1], lat: c[2], pop: c[3], capital: !!c[4] } : null;
    },
    /** Where to draw the province's town (its city, else its centroid), in loaded pixels. */
    cityPx: (i) => {
      const c = T.city[i - 1];
      if (!c) return [T.cx[i - 1] * K, T.cy[i - 1] * K];
      return [((c[1] + 180) * PX_PER_DEG()) % W, (90 - c[2]) * PX_PER_DEG()];
    },
    terrainClass: (i) => T.terrain[i - 1],
    coastal: (i) => T.coastal[i - 1] === 1,
    riverShare: (i) => T.river[i - 1],
    centroid: (i) => [T.cx[i - 1] * K, T.cy[i - 1] * K],
    bbox: (i) => [pX0[i], pY0[i], pX1[i], pY1[i]],
    pixels: (i) => pixList.subarray(pixStart[i], pixStart[i + 1]),
    neighbours: (i) => adjList.subarray(adjStart[i], adjStart[i + 1]),
    seaLinks: (i) => seaOf[i] || [],
    isStrait: (a, b) => straitSet.has(a * 65536 + b),
    provincesOf,
    nation: (id) => NAT[id],
    nations: () => IDS,
    colour: (id) => (NAT[id] ? NAT[id].colour : '#777777'),
    capital: (id) => CAPITAL[id],
    totalLand: () => totalLand,
    at: (p) => PROV[p],
  };
})(typeof window !== 'undefined' ? window : globalThis);
