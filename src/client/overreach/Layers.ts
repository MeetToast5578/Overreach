import type { EventBus } from "../../core/EventBus";
import { lockEras, startYear } from "../../core/overreach/Calendar";
import type { Controller } from "../Controller";
import type { MapRenderer } from "../render/gl";
import type { TransformHandler } from "../TransformHandler";
import type { GameView } from "../view";
import { createAlerts } from "./Alerts";
import { createCountryNames } from "./CountryNames";
import { createMapModes } from "./MapModes";
import { createOutliner } from "./Outliner";
import { createSandboxPanel } from "./SandboxPanel";
import { createSelectionWindow } from "./SelectionWindow";
import { createStoryPanel } from "./StoryPanel";
import { createTopBar } from "./TopBar";

/** Overreach's HUD for a game (GameRenderer adds these to its controllers). */
export function overreachLayers(
  game: GameView,
  eventBus: EventBus,
  transform: TransformHandler,
  view: MapRenderer,
): Controller[] {
  // The build menu hides units the calendar hasn't reached, as the worker does.
  lockEras(game.config(), () => game.ticks());
  // A calendar game swaps OpenFront's leaderboard and side bars for ours (overreach.css).
  const gc = game.config().gameConfig();
  document.body.classList.toggle(
    "overreach-gsg",
    startYear(gc) !== null && gc.sandbox !== true,
  );
  return [
    createSandboxPanel(game, eventBus, transform),
    createCountryNames(game, transform, view),
    createTopBar(game),
    createSelectionWindow(game, eventBus),
    createOutliner(game),
    createMapModes(game),
    createAlerts(game, eventBus),
    createStoryPanel(game, eventBus),
  ].filter((c): c is NonNullable<typeof c> => c !== null);
}
