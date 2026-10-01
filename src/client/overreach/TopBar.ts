import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { UnitType } from "../../core/game/Game";
import { startYear, yearAt } from "../../core/overreach/Calendar";
import type { Controller } from "../Controller";
import { renderNumber, renderTroops, translateText } from "../Utils";
import type { GameView } from "../view";
import { dateText } from "./DateText";
import { saveGame } from "./Saves";

const AUTOSAVE_EVERY_YEARS = 5;

/** One line of a breakdown tooltip: where a number came from, and how much. */
function row(label: string, value: string) {
  return html`<div class="flex justify-between gap-6">
    <span class="text-white/60">${label}</span><span>${value}</span>
  </div>`;
}

/**
 * The troop cap's parts, as Config.maxTroops builds it for a human:
 * 2 x (land^0.6 x 1000 + 50,000) + city levels x cityTroopIncrease. `other` is
 * whatever the cap holds beyond those two (settings or a difficulty rule).
 */
export function troopCapParts(
  tiles: number,
  cityLevels: number,
  cityTroopIncrease: number,
  cap: number,
): { land: number; cities: number; other: number } {
  const land = Math.round(2 * (Math.pow(tiles, 0.6) * 1000 + 50_000));
  const cities = Math.round(cityLevels * cityTroopIncrease);
  return { land, cities, other: Math.round(cap) - land - cities };
}

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
const disk = html`<svg
  viewBox="0 0 24 24"
  class="h-4 w-4"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
>
  <path d="M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7" />
</svg>`;

/**
 * The top bar of a game with a calendar: who you are, what you hold, and the date. Its numbers
 * carry their breakdown in a tooltip, and the old bottom bar's other numbers move here as they
 * get a breakdown of their own (MASTERPLAN.md section 4). It also saves the game: on its button,
 * and by itself every few years.
 */
@customElement("overreach-topbar")
export class TopBar extends LitElement implements Controller {
  game!: GameView;
  @state() private ticks = 0;
  @state() private gold = 0;
  @state() private income = 0;
  @state() private troops = 0;
  @state() private maxTroops = 0;
  @state() private cap = { land: 0, cities: 0, other: 0 };
  @state() private cityLevels = 0;
  @state() private name = "";
  @state() private flag = "";
  @state() private notice = "";
  private last = { tick: 0, earned: 0 };
  private autosavedYear: number | null = null;

  createRenderRoot() {
    return this;
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    this.ticks = this.game.ticks();
    const start = startYear(this.game.config().gameConfig());
    if (start !== null) {
      const year = yearAt(start, this.ticks);
      // The first look at the year sets the mark, so loading a game doesn't save it again.
      this.autosavedYear ??= year;
      if (year % AUTOSAVE_EVERY_YEARS === 0 && year !== this.autosavedYear) {
        this.autosavedYear = year;
        void this.save("auto");
      }
    }
    const me = this.game.myPlayer();
    if (me === null || !me.isAlive()) {
      this.name = "";
      return;
    }
    this.name = me.displayName();
    this.flag = me.cosmetics.flag ?? "";
    this.gold = Number(me.gold());
    this.troops = me.troops();
    const config = this.game.config();
    this.maxTroops = config.maxTroops(me);
    this.cityLevels = me
      .units(UnitType.City)
      .filter((u) => !u.isUnderConstruction())
      .reduce((a, u) => a + u.level(), 0);
    this.cap = troopCapParts(
      me.numTilesOwned(),
      this.cityLevels,
      config.cityTroopIncrease(),
      this.maxTroops,
    );
    // Gold earned over the last stretch of game time, per second (10 ticks).
    const earned = me.goldEarned();
    const dt = this.ticks - this.last.tick;
    if (dt >= 10) {
      this.income = ((earned - this.last.earned) * 10) / dt;
      this.last = { tick: this.ticks, earned };
    }
  }

  private async save(kind: "manual" | "auto") {
    try {
      const saved = await saveGame(this.game, kind);
      if (saved) this.say(translateText(`gsg.saved_${kind}`));
    } catch (error) {
      console.warn("Failed to save the game:", error);
      this.say(translateText("gsg.save_failed"));
    }
  }

  private say(text: string) {
    this.notice = text;
    setTimeout(() => {
      if (this.notice === text) this.notice = "";
    }, 2500);
  }

  render() {
    const start = this.game ? startYear(this.game.config().gameConfig()) : null;
    if (start === null) return nothing;
    const date = dateText(start, this.ticks);
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
            <div class="${chip} ov-tip-wrap">
              ${coin}<span>${renderNumber(this.gold)}</span
              ><span class="text-xs text-emerald-300"
                >+${renderNumber(Math.round(this.income))}/s</span
              >
              <div class="ov-tip">
                <div class="ov-title mb-1">${translateText("gsg.gold")}</div>
                ${row(translateText("gsg.gold_now"), renderNumber(this.gold))}
                ${row(
                  translateText("gsg.gold_income"),
                  `+${renderNumber(Math.round(this.income))} /s`,
                )}
                <div class="mt-1 text-white/50">
                  ${translateText("gsg.gold_source")}
                </div>
              </div>
            </div>
            <div class="${chip} ov-tip-wrap">
              ${people}<span
                >${renderTroops(this.troops)}<span class="text-white/50">
                  / ${renderTroops(this.maxTroops)}</span
                ></span
              >
              <div class="ov-tip">
                <div class="ov-title mb-1">
                  ${translateText("gsg.troops_label")}
                </div>
                ${row(
                  translateText("gsg.troops_now"),
                  renderTroops(this.troops),
                )}
                ${row(
                  translateText("gsg.troops_cap"),
                  renderTroops(this.maxTroops),
                )}
                <div
                  class="mt-1 border-t border-[#8a6d3b]/50 pt-1 text-white/50"
                >
                  ${translateText("gsg.troops_cap_breakdown")}
                </div>
                ${row(
                  translateText("gsg.troops_from_land", {
                    tiles: renderNumber(
                      this.game.myPlayer()?.numTilesOwned() ?? 0,
                    ),
                  }),
                  renderTroops(this.cap.land),
                )}
                ${row(
                  translateText("gsg.troops_from_cities", {
                    levels: renderNumber(this.cityLevels),
                  }),
                  renderTroops(this.cap.cities),
                )}
                ${this.cap.other !== 0
                  ? row(
                      translateText("gsg.troops_from_settings"),
                      renderTroops(this.cap.other),
                    )
                  : nothing}
              </div>
            </div>`}
      <div class="ml-auto flex items-center gap-3">
        ${this.notice === ""
          ? nothing
          : html`<span class="text-xs text-emerald-300">${this.notice}</span>`}
        <button
          class="ov-tab flex items-center gap-1"
          title=${translateText("gsg.save")}
          @click=${() => this.save("manual")}
        >
          ${disk}
        </button>
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
