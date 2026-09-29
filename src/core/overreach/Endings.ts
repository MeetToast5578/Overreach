import { type Game, type Player, PlayerType } from "../game/Game";
import type { GameImpl } from "../game/GameImpl";
import { END_YEAR, TICKS_PER_YEAR, yearAt } from "./Calendar";

// The endings (Overreach, SANDBOX.md F7; legacy/HANDOFF.md §2), checked by
// CalendarExecution in a game with a calendar:
// - domination: a nation and its subjects hold DOMINATION_SHARE of the land;
// - monopoly: one nation earns MONOPOLY_SHARE of a year's trade gold;
// - world peace: every surviving nation is in one web of alliances, and no
//   nation has attacked another for PEACE_YEARS. Everyone wins;
// - nuclear winter: fallout covers WINTER_SHARE of the land. Everyone loses;
// - survival: 2036 arrives. Being alive is the win; the human, if alive,
//   else the biggest nation, is named.

export type EndingKind =
  | "domination"
  | "monopoly"
  | "peace"
  | "winter"
  | "survival";

export interface Ending {
  kind: EndingKind;
  winner: number; // small id, 0 for everyone or no one
}

export const DOMINATION_SHARE = 0.8;
export const MONOPOLY_SHARE = 0.75;
export const PEACE_YEARS = 10;
export const WINTER_SHARE = 0.1;

export class Endings {
  // The last tick any nation attacked another.
  lastWar = 0;
  // Each nation's trade gold when the current year began.
  yearTrade = new Map<number, bigint>();

  constructor(
    private game: Game,
    private start: number,
  ) {}

  check(ticks: number): Ending | null {
    const g = this.game;
    const land = g.numLandTiles();
    const nations = g
      .players()
      .filter((p) => p.type() !== PlayerType.Bot)
      .sort((a, b) => a.smallID() - b.smallID());
    if (g.numTilesWithFallout() >= land * WINTER_SHARE) {
      return { kind: "winter", winner: 0 };
    }
    for (const p of nations) {
      if (this.realm(p) >= land * DOMINATION_SHARE) {
        return { kind: "domination", winner: p.smallID() };
      }
    }
    if (ticks % TICKS_PER_YEAR < 60) {
      const monopoly = this.yearOfTrade(nations);
      if (monopoly !== null) return { kind: "monopoly", winner: monopoly };
    }
    if (
      nations.some((p) =>
        p.outgoingAttacks().some((a) => a.target().isPlayer()),
      )
    ) {
      this.lastWar = ticks;
    } else if (
      ticks - this.lastWar >= PEACE_YEARS * TICKS_PER_YEAR &&
      nations.length >= 2 &&
      allied(nations)
    ) {
      return { kind: "peace", winner: 0 };
    }
    if (yearAt(this.start, ticks) >= END_YEAR) {
      const human = nations.find((p) => p.type() === PlayerType.Human);
      const biggest = [...nations].sort(
        (a, b) => b.numTilesOwned() - a.numTilesOwned(),
      )[0];
      return { kind: "survival", winner: (human ?? biggest)?.smallID() ?? 0 };
    }
    return null;
  }

  // A nation's land with its subjects'.
  private realm(p: Player): number {
    const d = (this.game as GameImpl).diplomacy;
    let tiles = p.numTilesOwned();
    for (const s of d?.subjects ?? []) {
      if (s.overlord !== p.smallID()) continue;
      const v = this.game.playerBySmallID(s.subject);
      if (v.isPlayer()) tiles += v.numTilesOwned();
    }
    return tiles;
  }

  // At a year's turn: the nation that earned MONOPOLY_SHARE of the year's
  // trade gold, if any. Starts the next year's count.
  private yearOfTrade(nations: Player[]): number | null {
    const earned = nations.map((p) => {
      const before = this.yearTrade.get(p.smallID()) ?? p.tradeGold();
      return { id: p.smallID(), gold: p.tradeGold() - before };
    });
    this.yearTrade = new Map(nations.map((p) => [p.smallID(), p.tradeGold()]));
    const total = earned.reduce((sum, e) => sum + e.gold, 0n);
    if (total <= 0n) return null;
    const top = earned.reduce((a, b) => (b.gold > a.gold ? b : a));
    // Integer maths: gold * 100 >= total * 75.
    const share = BigInt(Math.round(MONOPOLY_SHARE * 100));
    return top.gold * 100n >= total * share ? top.id : null;
  }
}

// Whether the nations form one web of alliances.
function allied(nations: Player[]): boolean {
  const seen = new Set([nations[0]]);
  const queue = [nations[0]];
  while (queue.length > 0) {
    const p = queue.pop()!;
    for (const q of p.allies()) {
      if (!seen.has(q) && nations.includes(q)) {
        seen.add(q);
        queue.push(q);
      }
    }
  }
  return seen.size === nations.length;
}
