import type { PlayerUpdate } from "../../core/game/GameUpdates";
import type { PlayerCosmetics } from "../../core/Schemas";
import type { PlayerView } from "../view";

// Players renamed mid-game (a formable nation, Formables.ts): GameView hands
// every update here; the name, flag and colour are refreshed on the player,
// and WebGLFrameBuilder re-uploads cosmetics once (takeRenames).

let renamed = false;

/** True if `pu` renamed or recoloured `view`. */
export function applyRename(view: PlayerView, pu: PlayerUpdate): boolean {
  if (
    pu.name === undefined &&
    pu.nationFlag === undefined &&
    pu.color === undefined
  ) {
    return false;
  }
  if (pu.name !== undefined) {
    view.static = {
      ...view.static,
      name: pu.name,
      displayName: pu.displayName ?? pu.name,
    };
    // Your own name shows as itself, even with anonymous names on.
    if (view.isMe()) view.anonymousName = pu.name;
  }
  const cosmetics: PlayerCosmetics = { ...view.equippedCosmetics };
  if (pu.nationFlag !== undefined) {
    cosmetics.flag = pu.nationFlag ? `/flags/${pu.nationFlag}.svg` : undefined;
  }
  if (pu.color !== undefined) {
    cosmetics.color = pu.color ? { color: pu.color } : undefined;
  }
  (view as { equippedCosmetics: PlayerCosmetics }).equippedCosmetics =
    cosmetics;
  view.refreshCosmetics();
  renamed = true;
  return true;
}

/** Whether a rename happened since the last call. */
export function takeRenames(): boolean {
  const was = renamed;
  renamed = false;
  return was;
}
