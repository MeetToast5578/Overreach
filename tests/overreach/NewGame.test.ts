import { describe, expect, test } from "vitest";
import { previewGrid } from "../../src/client/overreach/NewGame";

describe("new game preview grid", () => {
  test("samples the owner runs onto a shrunk grid, and counts each nation's land", () => {
    // An 8 x 4 world: the left 3 columns are nation 1, the next 3 nation 2, the last two nobody's.
    const runs: number[] = [];
    for (let y = 0; y < 4; y++) runs.push(1, 3, 2, 3, 0, 2);
    const g = previewGrid(runs, 8, 4, 2, 2);
    expect([g.w, g.h]).toEqual([4, 2]);
    // Cell (x, y) looks at tile (2x + 1, 2y + 1): columns 1, 3, 5, 7 -> nations 1, 2, 2, nobody.
    expect([...g.cells]).toEqual([1, 2, 2, 0, 1, 2, 2, 0]);
    expect(g.tiles).toEqual([8, 12, 12]); // nobody, nation 1, nation 2
  });

  test("a world that is one run is one owner", () => {
    const g = previewGrid([3, 100], 10, 10, 5, 3);
    expect([...g.cells]).toEqual([3, 3, 3, 3]);
  });
});
