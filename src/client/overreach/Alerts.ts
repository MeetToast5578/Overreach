import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import type { EventBus } from "../../core/EventBus";
import { startYear } from "../../core/overreach/Calendar";
import type { Controller } from "../Controller";
import { translateText } from "../Utils";
import type { GameView } from "../view";
import { provinceLayer } from "./ProvinceLayer";
import { SendOverreachIntentEvent } from "./SandboxEvents";
import { selection } from "./Selection";
import { storyState } from "./Story";

// The alerts row (MASTERPLAN.md 4.3/4.4): under the top bar, the few things
// asking for the player. Every alert is one line of the same shape - an icon, a
// label, an action - so a system adds its own when it lands. Today: a formable
// is ready, an event waits, a coalition forms. Truces, peace offers,
// bankruptcy and unrest arrive with G3 (war and peace) and G6 (unrest).

const icon = (path: TemplateResult) =>
  html`<svg
    viewBox="0 0 24 24"
    class="h-4 w-4 shrink-0"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    ${path}
  </svg>`;

const crown = html`<path d="M3 18h18M4 18 3 7l5 4 4-6 4 6 5-4-1 11" />`;
const letter = html`<path d="M3 5h18v14H3zM3 6l9 7 9-7" />`;
const swords = html`<path
  d="M4 4l7 7M4 4v4h4M20 4l-7 7M20 4v4h-4M4 20l7-7M4 20v-4h4M20 20l-7-7M20 20v-4h-4"
/>`;

/** One alert: what it says, its icon, and what clicking it does. */
interface Alert {
  key: "formable" | "event" | "coalition";
  label: string;
  icon: TemplateResult;
  title: string;
  act?: () => void;
}

/** The coalition against `who`, by member small ids. */
export function coalitionAgainst(
  coalitions: readonly [number, number[]][],
  who: number,
): number[] {
  return coalitions.find(([target]) => target === who)?.[1] ?? [];
}

/**
 * The alerts asking for the player's attention right now. Pure enough to test:
 * everything it reads comes in as arguments.
 */
export function alertsFor(args: {
  formable: readonly { id: string; name: string }[];
  event: string | null;
  coalition: readonly number[];
  name: (smallID: number) => string;
  form: (id: string) => void;
  showEvent: () => void;
  showCoalition: (smallID: number) => void;
}): Alert[] {
  const out: Alert[] = [];
  for (const f of args.formable) {
    out.push({
      key: "formable",
      label: translateText("alerts.formable", { name: f.name }),
      icon: crown,
      title: translateText("alerts.formable_tip", { name: f.name }),
      act: () => args.form(f.id),
    });
  }
  if (args.event !== null) {
    out.push({
      key: "event",
      label: translateText("alerts.event"),
      icon: letter,
      title: translateText(`event.${args.event}_title`),
      act: args.showEvent,
    });
  }
  if (args.coalition.length > 0) {
    const names = args.coalition.map(args.name).join(", ");
    out.push({
      key: "coalition",
      label: translateText("alerts.coalition"),
      icon: swords,
      title: translateText("alerts.coalition_tip", { names }),
      act: () => args.showCoalition(args.coalition[0]),
    });
  }
  return out;
}

/** The alert the event window is asked to show (a click on its alert). */
export class ShowEventAlertEvent extends Event {
  constructor() {
    super("overreach-show-event");
  }
}

@customElement("overreach-alerts")
export class Alerts extends LitElement implements Controller {
  game!: GameView;
  eventBus!: EventBus;
  private alerts: Alert[] = [];

  createRenderRoot() {
    return this;
  }

  private unsubscribe: (() => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
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
    if (layer === null || me === null || !me.isAlive()) {
      this.set([]);
      return;
    }
    const story = storyState(this.game, layer);
    this.set(
      alertsFor({
        formable: story.formable,
        event: story.event,
        coalition: coalitionAgainst(layer.coalitions, me.smallID()),
        name: (id) => {
          const p = this.game.playerBySmallID(id);
          return p.isPlayer() ? p.displayName() : "";
        },
        form: (id) =>
          this.eventBus.emit(
            new SendOverreachIntentEvent({ kind: "form", id }),
          ),
        showEvent: () => this.eventBus.emit(new ShowEventAlertEvent()),
        showCoalition: (id) => this.selectNation(id),
      }),
    );
  }

  // Show the coalition's first member: the province its centroid sits in.
  private selectNation(smallID: number) {
    const layer = provinceLayer;
    if (layer === null) return;
    const province = layer.records.findIndex(
      (rec, i) => i !== 0 && rec !== null && rec.owner === smallID,
    );
    if (province < 0) return;
    const count = layer.count[province];
    if (!count) return;
    const x = Math.floor(layer.cx[province] / count);
    const y = Math.floor(layer.cy[province] / count);
    selection.set({ tile: y * layer.width + x, province, owner: smallID });
  }

  private set(alerts: Alert[]) {
    const same =
      alerts.length === this.alerts.length &&
      alerts.every((a, i) => a.title === this.alerts[i].title);
    if (!same) {
      this.alerts = alerts;
      this.requestUpdate();
    }
  }

  render() {
    if (this.alerts.length === 0) return nothing;
    return html`<div
      class="pointer-events-none fixed left-0 top-10 z-[249] flex flex-wrap gap-1.5 p-1.5"
    >
      ${this.alerts.map(
        (a) =>
          html`<button
            class="ov-alert ov-panel pointer-events-auto flex items-center gap-1.5 rounded border px-2 py-1 text-xs"
            title=${a.title}
            @click=${() => a.act?.()}
          >
            ${icon(a.icon)}<span>${a.label}</span>
          </button>`,
      )}
    </div>`;
  }
}

export function createAlerts(
  game: GameView,
  eventBus: EventBus,
): Alerts | null {
  const gc = game.config().gameConfig();
  if (startYear(gc) === null || gc.sandbox === true) return null;
  const row = document.createElement("overreach-alerts") as Alerts;
  row.game = game;
  row.eventBus = eventBus;
  document.body.appendChild(row);
  return row;
}
