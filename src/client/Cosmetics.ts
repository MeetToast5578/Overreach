import type { Cosmetics } from "../core/CosmeticSchemas";
import type { PlayerCosmetics } from "../core/Schemas";

// Overreach has no cosmetics store, so nobody owns or selects any. These three
// keep the callers (the frame builder's FX catalog, the single-player start) as
// they were.
export function getCachedCosmetics(): Cosmetics | null {
  return null;
}

export async function getPlayerCosmetics(
  _opts: { verified?: boolean } = {},
): Promise<PlayerCosmetics> {
  return {};
}

export function prewarmCosmetics(): Promise<void> {
  return Promise.resolve();
}
