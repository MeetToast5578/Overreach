import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  dayOfYear,
  eraOf,
  startYear,
  yearAt,
} from "../../core/overreach/Calendar";
import type { Controller } from "../Controller";
import { translateText } from "../Utils";
import type { GameView } from "../view";

/** The date and era, top centre, in a game with a calendar (Calendar.ts). */
@customElement("calendar-bar")
export class CalendarBar extends LitElement implements Controller {
  game!: GameView;
  @state() private ticks = 0;

  createRenderRoot() {
    return this;
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    this.ticks = this.game.ticks();
  }

  render() {
    const start = this.game ? startYear(this.game.config().gameConfig()) : null;
    if (start === null) return nothing;
    const year = yearAt(start, this.ticks);
    const { month, day } = dayOfYear(this.ticks);
    // Date.UTC keeps years below 100 and the time zone out of it.
    const date = new Date(Date.UTC(2000, month, day));
    date.setUTCFullYear(year);
    const text = date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return html`<div
      class="fixed left-1/2 top-2 z-[250] -translate-x-1/2 rounded-md bg-slate-900/80 px-3 py-1 text-sm text-white pointer-events-none"
    >
      ${text} · ${translateText(`calendar.era_${eraOf(year)}`)}
    </div>`;
  }
}

export function createCalendarBar(game: GameView): CalendarBar | null {
  if (startYear(game.config().gameConfig()) === null) return null;
  const bar = document.createElement("calendar-bar") as CalendarBar;
  bar.game = game;
  document.body.appendChild(bar);
  return bar;
}
