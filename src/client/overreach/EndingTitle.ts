import { translateText } from "../Utils";
import type { GameView, PlayerView } from "../view";
import { provinceLayer } from "./ProvinceLayer";

/** The win screen's title for a calendar game's ending, or null. */
export function endingTitle(game: GameView): string | null {
  const e = provinceLayer?.ending;
  if (!e) return null;
  const winner = e.winner === 0 ? null : game.playerBySmallID(e.winner);
  const name = winner?.isPlayer() ? (winner as PlayerView).displayName() : "";
  const mine = winner !== null && winner === game.myPlayer();
  return translateText(`ending.${e.kind}${mine ? "_you" : ""}`, { name });
}
