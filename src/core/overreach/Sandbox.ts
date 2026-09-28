import { z } from "zod";
import { zb } from "../../../zbin";

// Sandbox mode (Overreach): god-mode edits, sent as a single "sandbox" intent.
// Only honoured when the game config has `sandbox: true` (see SandboxExecution).

// Most tiles one paint intent may carry. A brush stroke sends many intents.
export const MAX_PAINT_TILES = 20_000;
const MAX_TROOPS = 1_000_000_000;
const MAX_GOLD = 1_000_000_000_000;

const PlayerIDSchema = z.string().min(1).max(64);
const TileSchema = z.number().int().nonnegative();

export const SandboxActionSchema = z.discriminatedUnion("kind", [
  // owner null makes the tiles unclaimed. Water and impassable tiles are skipped.
  z.object({
    kind: z.literal("paint"),
    tiles: TileSchema.array().max(MAX_PAINT_TILES),
    owner: PlayerIDSchema.nullable(),
  }),
  z.object({
    kind: z.literal("create_nation"),
    tile: TileSchema,
    name: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[\p{L}\p{N} .,'()&-]+$/u),
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
]);
export type SandboxAction = z.infer<typeof SandboxActionSchema>;

export const SandboxIntentSchema = z.object({
  type: z.literal("sandbox"),
  // zb.json: varied and bursty, not worth a binary layout.
  action: zb.json(SandboxActionSchema),
});
export type SandboxIntent = z.infer<typeof SandboxIntentSchema>;
