import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { EventBus } from "../../core/EventBus";
import { startYear } from "../../core/overreach/Calendar";
import { type Formable, formableBy } from "../../core/overreach/Formables";
import type { Controller } from "../Controller";
import { translateText } from "../Utils";
import type { GameView } from "../view";
import { provinceLayer } from "./ProvinceLayer";
import { SendOverreachIntentEvent } from "./SandboxEvents";

/**
 * Under the date: nations you may form (Formables.ts) and a historical event
 * waiting for your answer (Events.ts), in a game with a calendar.
 */
@customElement("story-panel")
export class StoryPanel extends LitElement implements Controller {
  game!: GameView;
  eventBus!: EventBus;
  @state() private formable: Formable[] = [];
  @state() private event: string | null = null;
  private sizes: number[] = [];
  private sizesVersion = -1;

  createRenderRoot() {
    return this;
  }

  getTickIntervalMs() {
    return 1000;
  }

  tick() {
    const layer = provinceLayer;
    const me = this.game.myPlayer();
    if (layer === null || me === null || !me.isAlive()) {
      this.formable = [];
      this.event = null;
      return;
    }
    this.event =
      layer.events.find((q) => q.player === me.smallID())?.event ?? null;
    if (layer.version !== this.sizesVersion) {
      this.sizesVersion = layer.version;
      this.sizes = new Array<number>(layer.records.length).fill(0);
      for (const p of layer.prov) if (p !== 0) this.sizes[p]++;
    }
    this.formable = formableBy(
      this.game.config().gameConfig(),
      layer.formed,
      me.smallID(),
      (p) => layer.records[p]?.owner ?? 0,
      (p) => this.sizes[p] ?? 0,
      me.numTilesOwned(),
    );
  }

  private send(action: SendOverreachIntentEvent["action"]) {
    this.eventBus.emit(new SendOverreachIntentEvent(action));
  }

  render() {
    if (this.formable.length === 0 && this.event === null) return nothing;
    const button =
      "rounded bg-amber-700 px-2 py-1 hover:bg-amber-600 pointer-events-auto";
    const e = this.event;
    return html`<div
      class="fixed left-1/2 top-11 z-[250] -translate-x-1/2 max-w-md space-y-2 text-sm text-white"
    >
      ${this.formable.map(
        (f) =>
          html`<button
            class=${button}
            @click=${() => this.send({ kind: "form", id: f.id })}
          >
            ${translateText("story.form", { name: f.name })}
          </button>`,
      )}
      ${e === null
        ? nothing
        : html`<div
            class="rounded-lg bg-slate-900/95 p-3 space-y-2 pointer-events-auto"
          >
            <div class="font-bold">${translateText(`event.${e}_title`)}</div>
            <div class="text-white/80">${translateText(`event.${e}_text`)}</div>
            ${[0, 1].map(
              (option) =>
                html`<button
                  class="${button} block w-full text-left"
                  @click=${() => this.send({ kind: "event", event: e, option })}
                >
                  ${translateText(`event.${e}_${option}`)}
                </button>`,
            )}
          </div>`}
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
