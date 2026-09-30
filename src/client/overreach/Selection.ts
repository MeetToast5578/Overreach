import type { TileRef } from "../../core/game/GameMap";
import { startYear } from "../../core/overreach/Calendar";
import type { GameView } from "../view";
import { provinceLayer } from "./ProvinceLayer";

/** What the player has clicked: a province, the nation that owns it, and the tile itself. */
export interface Selected {
  tile: TileRef;
  province: number;
  owner: number; // small id, 0 for nobody
}

type Listener = (s: Selected | null) => void;

let current: Selected | null = null;
const listeners = new Set<Listener>();

export const selection = {
  get(): Selected | null {
    return current;
  },
  set(s: Selected | null): void {
    current = s;
    for (const l of listeners) l(s);
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** A player's name by small id, empty for nobody. */
export function playerName(game: GameView, smallID: number): string {
  const p = game.playerBySmallID(smallID);
  return p.isPlayer() ? p.displayName() : "";
}

/** In a calendar game (not the sandbox) a left click selects; the right-click wheel acts. */
export function leftClickSelects(game: GameView): boolean {
  const gc = game.config().gameConfig();
  return startYear(gc) !== null && gc.sandbox !== true;
}

/** Select what lies under a tile: nothing on water or impassable land. */
export function selectTile(game: GameView, tile: TileRef): void {
  const layer = provinceLayer;
  if (layer === null || !game.isLand(tile) || game.isImpassable(tile)) {
    selection.set(null);
    return;
  }
  selection.set({
    tile,
    province: layer.province(tile),
    owner: game.ownerID(tile),
  });
}
