import { z } from "zod";
import { zb } from "../../../zbin";
import { UnitType } from "../game/Game";
import { MAX_PROVINCES } from "./Provinces";

// Sandbox mode (Overreach): god-mode edits, sent as a single "sandbox" intent.
// Only honoured when the game config has `sandbox: true` (see SandboxExecution).

// Most tiles one paint intent may carry. A brush stroke sends many intents.
export const MAX_PAINT_TILES = 20_000;
export const MAX_TROOPS = 1_000_000_000;
export const MAX_GOLD = 1_000_000_000_000;

// Orders a player gives. In a sandbox the client sends these as `as` actions
// for the nation it controls, and drops them while observing.
export const SANDBOX_AS_TYPES = [
  "attack",
  "cancel_attack",
  "spawn",
  "boat",
  "cancel_boat",
  "allianceRequest",
  "allianceReject",
  "breakAlliance",
  "allianceExtension",
  "targetPlayer",
  "emoji",
  "quick_chat",
  "donate_gold",
  "donate_troops",
  "build_unit",
  "upgrade_structure",
  "delete_unit",
  "embargo",
  "embargo_all",
  "move_warship",
] as const;

// What the sandbox's Build tool places.
export const SANDBOX_STRUCTURES = [
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
] as const;

const PlayerIDSchema = z.string().min(1).max(64);
const TileSchema = z.number().int().nonnegative();
const ProvinceIDSchema = z.number().int().min(1).max(MAX_PROVINCES);

// Shared with scenarios (Scenario.ts).
export const NewPlayerIDSchema = z.string().regex(/^[A-Za-z0-9]{8,10}$/); // Schemas.GAME_ID_REGEX
export const NationNameSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N} .,'’()&-]+$/u);
export const ColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
// A resources/flags file name (without .svg). No "/" or ".", so it can't
// leave that folder when it becomes a URL.
export const FlagSchema = z.string().regex(/^[\p{L}\p{N} '()_-]{1,40}$/u);

export const SandboxActionSchema = z.discriminatedUnion("kind", [
  // owner null makes the tiles unclaimed. Water and impassable tiles are skipped.
  z.object({
    kind: z.literal("paint"),
    tiles: TileSchema.array().max(MAX_PAINT_TILES),
    owner: PlayerIDSchema.nullable(),
  }),
  // The client picks the id (so it can select and undo the nation); an id
  // already in use is ignored.
  z.object({
    kind: z.literal("create_nation"),
    id: NewPlayerIDSchema,
    tile: TileSchema,
    name: NationNameSchema,
    color: ColorSchema.optional(),
    flag: FlagSchema.optional(),
  }),
  z.object({ kind: z.literal("delete_nation"), player: PlayerIDSchema }),
  z.object({
    kind: z.literal("set_troops"),
    player: PlayerIDSchema,
    troops: z.number().min(0).max(MAX_TROOPS),
  }),
  z.object({
    kind: z.literal("set_gold"),
    player: PlayerIDSchema,
    gold: z.number().int().min(0).max(MAX_GOLD),
  }),
  // target null expands into unclaimed land. ratio is the share of the
  // attacker's troops sent.
  z.object({
    kind: z.literal("war"),
    attacker: PlayerIDSchema,
    target: PlayerIDSchema.nullable(),
    ratio: z.number().gt(0).max(1),
  }),
  z.object({ kind: z.literal("peace"), a: PlayerIDSchema, b: PlayerIDSchema }),
  z.object({ kind: z.literal("ally"), a: PlayerIDSchema, b: PlayerIDSchema }),
  // A structure for the tile's owner, free and finished at once. The usual
  // placement rules (own land, spacing, coast for ports) still apply.
  z.object({
    kind: z.literal("build"),
    tile: TileSchema,
    unit: z.enum(SANDBOX_STRUCTURES),
  }),
  // Turns a nation's or tribe's AI off or back on.
  z.object({
    kind: z.literal("set_ai"),
    player: PlayerIDSchema,
    on: z.boolean(),
  }),
  // Provinces (Provinces.ts). New ones go to whoever holds most of them; a
  // split takes the tiles left of the line from a to b.
  z.object({
    kind: z.literal("province_create"),
    tiles: TileSchema.array().max(MAX_PAINT_TILES),
    name: NationNameSchema,
  }),
  z.object({
    kind: z.literal("province_assign"),
    tiles: TileSchema.array().max(MAX_PAINT_TILES),
    province: ProvinceIDSchema,
  }),
  z.object({
    kind: z.literal("province_split"),
    province: ProvinceIDSchema,
    a: TileSchema,
    b: TileSchema,
    name: NationNameSchema,
  }),
  z.object({
    kind: z.literal("province_merge"),
    into: ProvinceIDSchema,
    from: ProvinceIDSchema,
  }),
  z.object({
    kind: z.literal("province_rename"),
    province: ProvinceIDSchema,
    name: NationNameSchema,
  }),
  z.object({
    kind: z.literal("province_capital"),
    province: ProvinceIDSchema,
    tile: TileSchema.nullable(),
  }),
  // Runs `intent` as `player`. The intent is checked against IntentSchema
  // when it arrives (sandboxExec), not here, to keep Schemas.ts out of this file.
  z.object({
    kind: z.literal("as"),
    player: PlayerIDSchema,
    intent: z.looseObject({ type: z.enum(SANDBOX_AS_TYPES) }),
  }),
]);
export type SandboxAction = z.infer<typeof SandboxActionSchema>;

export const SandboxIntentSchema = z.object({
  type: z.literal("sandbox"),
  // zb.json: varied and bursty, not worth a binary layout.
  action: zb.json(SandboxActionSchema),
});
export type SandboxIntent = z.infer<typeof SandboxIntentSchema>;
