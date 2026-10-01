import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { EventBus } from "../../core/EventBus";
import { startYear, yearAt } from "../../core/overreach/Calendar";
import type { Controller } from "../Controller";
import { PauseGameIntentEvent } from "../Transport";
import { translateText } from "../Utils";
import type { GameView } from "../view";
import { ShowEventAlertEvent } from "./Alerts";
import { provinceLayer } from "./ProvinceLayer";
import { SendOverreachIntentEvent } from "./SandboxEvents";
import { storyState } from "./Story";

/**
 * The event window (MASTERPLAN.md 4.4): a historical event waiting for the
 * player's answer, in a period frame over the map. Its options are the answers;
 * each one carries its own effect in its text. It pauses a single-player game so
 * the answer isn't rushed, and it flashes when the alerts row asks it to.
 */
@customElement("story-panel")
export class StoryPanel extends LitElement implements Controller {
  game!: GameView;
  eventBus!: EventBus;
  @state() private event: string | null = null;
  @state() private year = 0;
  @state() private flash = false;
  // The event this window has already paused for, so unpausing sticks.
  private pausedFor: string | null = null;
  private hideFlash: ReturnType<typeof setTimeout> | null = null;

  createRenderRoot() {
    return this;
  }

  private unsubscribe: (() => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.eventBus.on(ShowEventAlertEvent, () => this.show());
    // The game's own tick cadence stops when it is paused, and an answer can
    // clear the event while it is paused, so this follows the provinces too.
    this.unsubscribe = provinceLayer?.onUpdate(() => this.tick()) ?? null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getTickIntervalMs() {
    return 1000;
  }

  tick() {
    // The layer exists by the time a game's HUD is built; if the row was made
    // before it (it isn't today), the second's own tick picks it up.
    this.unsubscribe ??= provinceLayer?.onUpdate(() => this.tick()) ?? null;
    const layer = provinceLayer;
    const me = this.game.myPlayer();
    const event =
      layer === null || me === null || !me.isAlive()
        ? null
        : storyState(this.game, layer).event;
    const start = startYear(this.game.config().gameConfig());
    this.year = start === null ? 0 : yearAt(start, this.game.ticks());
    if (event !== this.event) {
      this.event = event;
      if (event !== null && event !== this.pausedFor) {
        this.pausedFor = event;
        // Important events pause single-player; the player unpauses when ready.
        this.eventBus.emit(new PauseGameIntentEvent(true));
      }
    }
  }

  /** A click on the event alert: bring the window forward. */
  private show() {
    if (this.event === null) return;
    this.flash = true;
    if (this.hideFlash !== null) clearTimeout(this.hideFlash);
    this.hideFlash = setTimeout(() => (this.flash = false), 1200);
  }

  private answer(option: number) {
    if (this.event === null) return;
    this.eventBus.emit(
      new SendOverreachIntentEvent({
        kind: "event",
        event: this.event,
        option,
      }),
    );
  }

  render() {
    const e = this.event;
    if (e === null) return nothing;
    // The options are the answers; their own text carries what each one does.
    const options = [0, 1];
    return html`<div
      class="pointer-events-none fixed inset-x-0 top-24 z-[248] flex justify-center px-4"
    >
      <div
        class="ov-panel pointer-events-auto w-full max-w-xl rounded-lg border-2 p-4 text-white shadow-2xl transition-shadow ${this
          .flash
          ? "ov-event-flash"
          : ""}"
      >
        <div
          class="mb-1 flex items-baseline justify-between gap-3 border-b border-[#8a6d3b]/60 pb-1.5"
        >
          <span class="ov-title text-xs uppercase tracking-[0.2em]"
            >${translateText("event_window.waits")}</span
          >
          <span class="text-xs text-white/50">${this.year}</span>
        </div>
        <div class="ov-title text-2xl">
          ${translateText(`event.${e}_title`)}
        </div>
        <p class="mt-2 text-sm leading-relaxed text-white/85">
          ${translateText(`event.${e}_text`)}
        </p>
        <div class="mt-3 flex flex-col gap-2">
          ${options.map(
            (option) =>
              html`<button
                class="ov-button ov-event-option px-3 py-2 text-left text-sm"
                @click=${() => this.answer(option)}
              >
                ${translateText(`event.${e}_${option}`)}
              </button>`,
          )}
        </div>
      </div>
    </div>`;
  }
}

export function createStoryPanel(
  game: GameView,
  eventBus: EventBus,
): StoryPanel | null {
  const gc = game.config().gameConfig();
  if (startYear(gc) === null || gc.sandbox === true) return null;
  const panel = document.createElement("story-panel") as StoryPanel;
  panel.game = game;
  panel.eventBus = eventBus;
  document.body.appendChild(panel);
  return panel;
}
