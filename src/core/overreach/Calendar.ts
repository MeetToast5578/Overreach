import type { Config } from "../configuration/Config";
import { UnitType } from "../game/Game";
import type { GameConfig } from "../Schemas";

// The calendar and eras (Overreach, SANDBOX.md F7). A scenario with a start
// year runs a calendar: a year per TICKS_PER_YEAR ticks, 1836 to 2036. Eras
// unlock OpenFront's modern units by year (nukes and SAMs in the atomic era,
// factories and trains with the railways); a sandbox has them all. Pure
// functions of the game config and the tick, so the worker and the client
// agree without sending anything.

export const TICKS_PER_YEAR = 600; // a year a minute at 10 ticks a second
export const END_YEAR = 2036;

export const ERAS = [
  { id: "industrial", from: 1836 },
  { id: "railways", from: 1850 },
  { id: "machine", from: 1900 },
  { id: "atomic", from: 1945 },
] as const;
export type Era = (typeof ERAS)[number]["id"];

// Units a scenario's calendar holds back until a year.
export const UNLOCKS: Partial<Record<UnitType, number>> = {
  [UnitType.Factory]: 1850,
  [UnitType.Train]: 1850,
  [UnitType.MissileSilo]: 1945,
  [UnitType.AtomBomb]: 1945,
  [UnitType.HydrogenBomb]: 1952,
  [UnitType.SAMLauncher]: 1955,
  [UnitType.SAMMissile]: 1955,
  [UnitType.MIRV]: 1970,
  [UnitType.MIRVWarhead]: 1970,
};

/** The calendar's first year, or null for a game without one. */
export function startYear(gc: GameConfig): number | null {
  return gc.scenario?.startYear ?? null;
}

export function yearAt(start: number, ticks: number): number {
  return start + Math.floor(ticks / TICKS_PER_YEAR);
}

export function eraOf(year: number): Era {
  let era: Era = ERAS[0].id;
  for (const e of ERAS) if (year >= e.from) era = e.id;
  return era;
}

/** Month (0-11) and day (1-31) within the year, for display. */
export function dayOfYear(ticks: number): { month: number; day: number } {
  const days = Math.floor(((ticks % TICKS_PER_YEAR) * 365) / TICKS_PER_YEAR);
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let month = 0;
  let left = days;
  while (left >= lengths[month]) left -= lengths[month++];
  return { month, day: left + 1 };
}

export function eraLocked(
  gc: GameConfig,
  ticks: number,
  type: UnitType,
): boolean {
  const start = startYear(gc);
  const from = UNLOCKS[type];
  if (start === null || from === undefined || gc.sandbox === true) {
    return false;
  }
  return yearAt(start, ticks) < from;
}

/** Makes `config` hold back units the calendar hasn't reached. */
export function lockEras(config: Config, ticks: () => number): void {
  const gc = config.gameConfig();
  config.eraLocked =
    startYear(gc) === null ? null : (type) => eraLocked(gc, ticks(), type);
}
