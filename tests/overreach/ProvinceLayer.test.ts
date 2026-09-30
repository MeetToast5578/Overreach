import { describe, expect, test } from "vitest";
import { ProvinceLayer } from "../../src/client/overreach/ProvinceLayer";

// A province's centroid sums, counted tile by tile from the layer.
function recount(layer: ProvinceLayer): Map<number, [number, number, number]> {
  const sums = new Map<number, [number, number, number]>();
  for (let t = 0; t < layer.prov.length; t++) {
    const id = layer.prov[t];
    if (id === 0) continue;
    const s = sums.get(id) ?? [0, 0, 0];
    s[0] += (t % layer.width) + 0.5;
    s[1] += Math.floor(t / layer.width) + 0.5;
    s[2]++;
    sums.set(id, s);
  }
  return sums;
}

describe("ProvinceLayer centroids", () => {
  test("follow tiles changing province, including into a new province", () => {
    const layer = new ProvinceLayer(10, 10);
    const first = new Uint16Array(100);
    for (let t = 0; t < 100; t++) first[t] = t % 10 < 5 ? 1 : 2;
    layer.apply({ layer: first });

    // A few tiles move to the other province, one to a new province 3, one to nobody.
    layer.apply({ tiles: new Uint32Array([0, 2, 5, 1, 27, 3, 99, 0, 44, 3]) });

    const want = recount(layer);
    for (const [id, [sx, sy, n]] of want) {
      expect(layer.cx[id]).toBeCloseTo(sx);
      expect(layer.cy[id]).toBeCloseTo(sy);
      expect(layer.count[id]).toBe(n);
    }
    expect(layer.count[3]).toBe(2);
    // Nothing is left counted for a province that has no tiles.
    let counted = 0;
    for (const n of layer.count) counted += n;
    expect(counted).toBe(99);
  });
});
