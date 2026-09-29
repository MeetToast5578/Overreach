import type { Game } from "../game/Game";
import type { GameImpl } from "../game/GameImpl";

// The province economy (Overreach, SANDBOX.md F7), in a game with a calendar:
// a province's town grows GROWTH_PERCENT a year, and its people pay their
// owner, on top of OpenFront's own income, a gold a tick for every
// PEOPLE_PER_GOLD (half from a province that isn't its owner's core yet).
// Integer maths throughout, so every client agrees.

export const GROWTH_PERCENT = 1;
export const PEOPLE_PER_GOLD = 50_000;
export const PAY_EVERY = 10; // ticks

/** A year's growth for every town. */
export function grow(game: Game): void {
  const provinces = (game as GameImpl).provinces;
  for (const rec of provinces?.records ?? []) {
    if (rec && rec.population > 0) {
      rec.population += Math.floor((rec.population * GROWTH_PERCENT) / 100);
    }
  }
}

/** Pays each nation for PAY_EVERY ticks of its provinces' people. */
export function payProvinces(game: Game): void {
  const g = game as GameImpl;
  const people = new Map<number, number>();
  g.provinces?.records.forEach((rec, p) => {
    if (!rec || rec.owner === 0 || rec.population === 0) return;
    const core = g.diplomacy?.core.get(p) ?? rec.owner;
    const share = core === rec.owner ? rec.population : rec.population / 2;
    people.set(rec.owner, (people.get(rec.owner) ?? 0) + share);
  });
  for (const [id, n] of people) {
    const gold = Math.floor((n * PAY_EVERY) / PEOPLE_PER_GOLD);
    const p = g.playerBySmallID(id);
    if (gold > 0 && p.isPlayer() && p.isAlive()) p.addGold(BigInt(gold));
  }
}
