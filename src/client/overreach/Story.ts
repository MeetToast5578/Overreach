import { startYear } from "../../core/overreach/Calendar";
import { type Formable, formableBy } from "../../core/overreach/Formables";
import type { GameView } from "../view";
import type { ProvinceLayer } from "./ProvinceLayer";

// What waits for the player's answer: a nation they may form, and a historical
// event. Both the alerts row and the event window read this, so the province
// scan behind it (sizes per province) runs once.

export interface StoryState {
  /** The nations the player may form right now (Formables.ts). */
  formable: Formable[];
  /** The event waiting for the player, by id; null when none does. */
  event: string | null;
}

const EMPTY: StoryState = { formable: [], event: null };

interface Cached {
  key: string;
  state: StoryState;
  sizes: number[];
  sizesVersion: number;
}

const caches = new WeakMap<GameView, Cached>();

/** The story state of `game`, recomputed when the game or the provinces move. */
export function storyState(
  game: GameView | null,
  layer: ProvinceLayer | null,
): StoryState {
  if (game === null || layer === null) return EMPTY;
  const me = game.myPlayer();
  const gc = game.config().gameConfig();
  if (
    me === null ||
    !me.isAlive() ||
    startYear(gc) === null ||
    gc.sandbox === true
  ) {
    return EMPTY;
  }
  // The layer's version counts every province update, so this recomputes only
  // when something actually moved.
  const key = `${game.ticks()}:${layer.version}:${me.smallID()}`;
  const cached = caches.get(game);
  if (cached !== undefined && cached.key === key) return cached.state;
  const sizes = cached?.sizes ?? [];
  const sizesVersion = cached?.sizesVersion ?? -1;
  if (layer.version !== sizesVersion) {
    sizes.length = 0;
    for (let p = 0; p < layer.records.length; p++) sizes.push(0);
    for (const p of layer.prov) if (p !== 0) sizes[p]++;
  }
  const pending = layer.events.find((q) => q.player === me.smallID());
  const state: StoryState = {
    formable: formableBy(
      gc,
      layer.formed,
      me.smallID(),
      (p) => layer.records[p]?.owner ?? 0,
      (p) => sizes[p] ?? 0,
      me.numTilesOwned(),
    ),
    event: pending?.event ?? null,
  };
  caches.set(game, { key, state, sizes, sizesVersion: layer.version });
  return state;
}
