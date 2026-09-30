import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import {
  dayOfYear,
  eraOf,
  startYear,
  yearAt,
} from "../../core/overreach/Calendar";
import type { Controller } from "../Controller";
import { renderNumber, renderTroops, translateText } from "../Utils";
import type { GameView } from "../view";

const coin = html`<svg
  viewBox="0 0 24 24"
  class="h-4 w-4"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
>
  <circle cx="12" cy="12" r="9" />
  <circle cx="12" cy="12" r="4.5" />
</svg>`;
const people = html`<svg
  viewBox="0 0 24 24"
  class="h-4 w-4"
  fill="currentColor"
>
  <circle cx="9" cy="8" r="3.2" />
  <circle cx="17" cy="9" r="2.6" />
  <path
    d="M3 19c0-3.6 2.6-6 6-6s6 2.4 6 6zM14.5 19c.2-2.3 1.4-4 3.6-4.4 1.8.3 3 1.9 3 4.4z"
  />
</svg>`;

/**
 * The top bar of a game with a calendar: who you are, what you hold, and the date. Its numbers
 * carry their breakdown in a tooltip, and the old bottom bar's other numbers move here as they
 * get a breakdown of their own (MASTERPLAN.md section 4).
 */
@customElement("overreach-topbar")
export class TopBar extends LitElement implements Controller {
  game!: GameView;
  @state() private ticks = 0;
  @state() private gold = 0;
  @state() private income = 0;
  @state() private troops = 0;
  @state() private maxTroops = 0;
  @state() private name = "";
  @state() private flag = "";
  private last = { tick: 0, earned: 0 };

  createRenderRoot() {
    return this;
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    this.ticks = this.game.ticks();
    const me = this.game.myPlayer();
    if (me === null || !me.isAlive()) {
      this.name = "";
      return;
    }
    this.name = me.displayName();
    this.flag = me.cosmetics.flag ?? "";
    this.gold = Number(me.gold());
    this.troops = me.troops();
    this.maxTroops = this.game.config().maxTroops(me);
    // Gold earned over the last stretch of game time, per second (10 ticks).
    const earned = me.goldEarned();
    const dt = this.ticks - this.last.tick;
    if (dt >= 10) {
      this.income = ((earned - this.last.earned) * 10) / dt;
      this.last = { tick: this.ticks, earned };
    }
  }

  private date(): { text: string; era: string } | null {
    const start = startYear(this.game.config().gameConfig());
    if (start === null) return null;
    const year = yearAt(start, this.ticks);
    const { month, day } = dayOfYear(this.ticks);
    // Date.UTC keeps years below 100 and the time zone out of it.
    const date = new Date(Date.UTC(2000, month, day));
    date.setUTCFullYear(year);
    return {
      text: date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      era: translateText(`calendar.era_${eraOf(year)}`),
    };
  }

  render() {
    const date = this.game ? this.date() : null;
    if (date === null) return nothing;
    const chip = "flex items-center gap-1.5 rounded px-2 py-0.5 bg-black/30";
    return html`<div
      class="ov-panel pointer-events-auto fixed left-0 right-[260px] top-0 z-[250] flex h-10 items-center gap-3 border-b px-3 text-sm"
    >
      ${this.name === ""
        ? nothing
        : html`<div class="flex items-center gap-2 font-semibold">
              ${this.flag
                ? html`<img
                    src=${assetUrl(this.flag)}
                    class="h-4 w-6 rounded-sm object-cover"
                  />`
                : nothing}
              <span class="ov-title">${this.name}</span>
            </div>
            <div
              class=${chip}
              title=${translateText("gsg.gold_tip", {
                gold: renderNumber(this.gold),
                rate: renderNumber(Math.round(this.income)),
              })}
            >
              ${coin}<span>${renderNumber(this.gold)}</span
              ><span class="text-xs text-emerald-300"
                >+${renderNumber(Math.round(this.income))}/s</span
              >
            </div>
            <div
              class=${chip}
              title=${translateText("gsg.troops_tip", {
                troops: renderTroops(this.troops),
                max: renderTroops(this.maxTroops),
              })}
            >
              ${people}<span
                >${renderTroops(this.troops)}<span class="text-white/50">
                  / ${renderTroops(this.maxTroops)}</span
                ></span
              >
            </div>`}
      <div class="ml-auto flex items-baseline gap-2">
        <span class="ov-title text-base">${date.text}</span>
        <span class="text-xs text-white/60">${date.era}</span>
      </div>
    </div>`;
  }
}

export function createTopBar(game: GameView): TopBar | null {
  if (startYear(game.config().gameConfig()) === null) return null;
  const bar = document.createElement("overreach-topbar") as TopBar;
  bar.game = game;
  document.body.appendChild(bar);
  return bar;
}
