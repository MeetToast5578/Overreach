import { z } from "zod";
import { GameMapSize, GameMapType } from "../game/Game";
import {
  ColorSchema,
  FlagSchema,
  MAX_GOLD,
  MAX_TROOPS,
  NationNameSchema,
  NewPlayerIDSchema,
} from "./Sandbox";

// A scenario (Overreach): nations that start with pre-drawn territory. It rides
// in GameConfig.scenario; ScenarioExecution places it on the first tick and
// ends the spawn phase. The sandbox saves the current world as one.

// 12 bits of owner id per tile, less a margin for the other players.
export const MAX_SCENARIO_NATIONS = 4000;

export const ScenarioNationSchema = z.object({
  id: NewPlayerIDSchema,
  name: NationNameSchema,
  color: ColorSchema.optional(),
  flag: FlagSchema.optional(),
  // Omitted: half the nation's troop limit.
  troops: z.number().min(0).max(MAX_TROOPS).optional(),
  gold: z.number().int().min(0).max(MAX_GOLD).optional(),
});
export type ScenarioNation = z.infer<typeof ScenarioNationSchema>;

export const ScenarioSchema = z.object({
  version: z.literal(1),
  map: z.enum(GameMapType),
  mapSize: z.enum(GameMapSize),
  nations: ScenarioNationSchema.array().max(MAX_SCENARIO_NATIONS),
  // Pairs of indexes into `nations`.
  alliances: z.tuple([z.number().int(), z.number().int()]).array(),
  // Every tile's owner in map order, as runs: [owner, length, owner, length,
  // ...]. The owner is 1 + an index into `nations`, or 0 for nobody.
  owners: z.number().int().nonnegative().array(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export function encodeOwners(
  tiles: number,
  ownerOf: (tile: number) => number,
): number[] {
  const runs: number[] = [];
  let owner = -1;
  for (let t = 0; t < tiles; t++) {
    const o = ownerOf(t);
    if (o === owner) runs[runs.length - 1]++;
    else runs.push((owner = o), 1);
  }
  return runs;
}

// Calls fn for each owned tile. Returns the number of tiles the runs cover.
export function forEachOwnedTile(
  runs: readonly number[],
  fn: (tile: number, owner: number) => void,
): number {
  let t = 0;
  for (let i = 0; i + 1 < runs.length; i += 2) {
    const owner = runs[i];
    const end = t + runs[i + 1];
    if (owner > 0) for (let tile = t; tile < end; tile++) fn(tile, owner);
    t = end;
  }
  return t;
}
