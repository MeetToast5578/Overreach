import { describe, expect, test } from "vitest";
import { labelGeometry } from "../../src/client/overreach/CountryNames";

const line = (n: number, f: (i: number) => [number, number]) =>
  Array.from({ length: n }, (_, i) => {
    const [x, y] = f(i);
    return { x, y, w: 100 };
  });

describe("country name geometry", () => {
  test("a nation that is long and level gets a level name, as long as the land", () => {
    const g = labelGeometry(line(12, (i) => [1000 + i * 20, 500]))!;
    expect(Math.abs(g.angle)).toBeLessThan(0.05);
    expect(g.length).toBeGreaterThan(150);
    expect(g.length).toBeLessThan(300);
    expect(g.x).toBeCloseTo(1110, 0);
  });

  test("a diagonal nation gets a diagonal name, still read left to right", () => {
    const g = labelGeometry(line(12, (i) => [1000 + i * 20, 500 - i * 20]))!;
    expect(g.angle).toBeCloseTo(-Math.PI / 4, 1);
    const back = labelGeometry(line(12, (i) => [1000 + i * 20, 500 + i * 20]))!;
    expect(back.angle).toBeCloseTo(Math.PI / 4, 1);
  });

  test("a colony far away does not drag the name off the homeland", () => {
    const home = line(10, (i) => [1000 + i * 10, 500 + (i % 3) * 5]);
    const g = labelGeometry([...home, { x: 5000, y: 2000, w: 30 }])!;
    expect(g.x).toBeLessThan(1200);
    expect(g.y).toBeLessThan(600);
  });

  test("a bent nation gets a bent name, and a single province a level one", () => {
    const arc = labelGeometry(
      line(15, (i) => [1000 + i * 20, 500 + (i - 7) ** 2 * 0.8]),
    )!;
    expect(arc.a).not.toBe(0);
    const one = labelGeometry([{ x: 300, y: 300, w: 400 }])!;
    expect(one.angle).toBe(0);
    expect(labelGeometry([])).toBeNull();
  });
});
