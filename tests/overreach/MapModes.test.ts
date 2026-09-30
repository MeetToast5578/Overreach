import { describe, expect, test } from "vitest";
import {
  paintPalette,
  type Relations,
} from "../../src/client/overreach/MapModes";
import type { ProvinceRecord } from "../../src/core/overreach/Provinces";

const rec = (owner: number, population = 0): ProvinceRecord => ({
  name: "P",
  owner,
  capital: null,
  population,
  growth: 1000,
});
const rel: Relations = {
  me: 1,
  allies: new Set([2]),
  bonds: new Set([3]),
  hostile: new Set([4]),
};
const entry = (out: Uint8Array, id: number) => [
  ...out.slice(id * 4, id * 4 + 4),
];

describe("map mode palettes", () => {
  test("the diplomatic map colours by how the owner stands to us", () => {
    const out = new Uint8Array(65536 * 4);
    // Province ids 1..6: ours, an ally, a subject, an enemy, a stranger, nobody's.
    paintPalette(
      "diplomatic",
      [null, rec(1), rec(2), rec(3), rec(4), rec(5), rec(0)],
      rel,
      out,
    );
    const colours = [1, 2, 3, 4, 5, 6].map((id) => entry(out, id).join());
    expect(new Set(colours).size).toBe(6);
    expect(entry(out, 1)).toEqual([54, 118, 204, 235]);
    expect(entry(out, 0)).toEqual([0, 0, 0, 0]); // the sea is left alone
  });

  test("the population map gets darker as a town grows, and pale grey without one", () => {
    const out = new Uint8Array(65536 * 4);
    paintPalette(
      "population",
      [null, rec(1, 20_000), rec(1, 2_000_000), rec(1, 0)],
      rel,
      out,
    );
    expect(entry(out, 1)[1]).toBeGreaterThan(entry(out, 2)[1]);
    expect(entry(out, 3)[3]).toBeLessThan(200);
  });

  test("the province map gives neighbours their own colours and the palette is refilled each time", () => {
    const out = new Uint8Array(65536 * 4);
    paintPalette("provinces", [null, rec(1), rec(1), rec(2)], rel, out);
    expect(entry(out, 1).join()).not.toBe(entry(out, 2).join());
    paintPalette("political", [null, rec(1)], rel, out);
    expect(entry(out, 1)).toEqual([0, 0, 0, 0]); // a mode that paints nothing clears it
  });
});
