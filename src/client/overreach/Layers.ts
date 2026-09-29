import type { EventBus } from "../../core/EventBus";
import { lockEras } from "../../core/overreach/Calendar";
import type { Controller } from "../Controller";
import type { TransformHandler } from "../TransformHandler";
import type { GameView } from "../view";
import { createCalendarBar } from "./CalendarBar";
import { createSandboxPanel } from "./SandboxPanel";
import { createStoryPanel } from "./StoryPanel";

/** Overreach's HUD for a game (GameRenderer adds these to its controllers). */
export function overreachLayers(
  game: GameView,
  eventBus: EventBus,
  transform: TransformHandler,
): Controller[] {
  // The build menu hides units the calendar hasn't reached, as the worker does.
  lockEras(game.config(), () => game.ticks());
  return [
    createSandboxPanel(game, eventBus, transform),
    createCalendarBar(game),
    createStoryPanel(game, eventBus),
  ].filter((c): c is NonNullable<typeof c> => c !== null);
}
