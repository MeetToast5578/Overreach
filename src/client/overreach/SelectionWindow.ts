import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { EventBus } from "../../core/EventBus";
import { Structures, TerrainType } from "../../core/game/Game";
import { startYear } from "../../core/overreach/Calendar";
import type { Controller } from "../Controller";
import type { PlayerPanel } from "../hud/layers/PlayerPanel";
import { renderNumber, translateText } from "../Utils";
import type { GameView, PlayerView } from "../view";
import { provinceLayer } from "./ProvinceLayer";
import { playerName, type Selected, selection } from "./Selection";

type Tab = "province" | "nation";

const TERRAIN: Record<number, string> = {
  [TerrainType.Plains]: "plains",
  [TerrainType.Highland]: "highland",
  [TerrainType.Mountain]: "mountain",
};

/**
 * The window on the left: the province you clicked, and the nation that owns it (MASTERPLAN.md
 * section 4). Esc closes it. Diplomacy reuses OpenFront's own player panel for now.
 */
@customElement("selection-window")
export class SelectionWindow extends LitElement implements Controller {
  game!: GameView;
  eventBus!: EventBus;
  @state() private selected: Selected | null = null;
  @state() private tab: Tab = "province";
  @state() private version = 0;
  private stop: (() => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.selected !== null) selection.set(null);
  };

  createRenderRoot() {
    return this;
  }

  init() {
    this.stop = selection.subscribe((s) => {
      this.selected = s;
      if (s !== null && s.province === 0) this.tab = "nation";
    });
    window.addEventListener("keydown", this.onKey);
  }

  disconnectedCallback() {
    this.stop?.();
    window.removeEventListener("keydown", this.onKey);
    super.disconnectedCallback();
  }

  getTickIntervalMs() {
    return 500;
  }

  tick() {
    // Its numbers follow the game: re-render on the province layer's changes.
    const v = provinceLayer?.version ?? 0;
    if (v !== this.version) this.version = v;
  }

  private owner(): PlayerView | null {
    const s = this.selected;
    if (s === null || s.owner === 0) return null;
    const p = this.game.playerBySmallID(s.owner);
    return p.isPlayer() ? p : null;
  }

  private row(label: string, value: unknown) {
    return html`<div class="flex justify-between gap-3 py-0.5">
      <span class="text-white/60">${label}</span><span>${value}</span>
    </div>`;
  }

  private flag(p: PlayerView) {
    const f = p.cosmetics.flag;
    return f
      ? html`<img src=${assetUrl(f)} class="h-4 w-6 rounded-sm object-cover" />`
      : nothing;
  }

  private provinceTab(s: Selected) {
    const layer = provinceLayer!;
    const rec = layer.records[s.province];
    if (!rec) return nothing;
    let tiles = 0;
    for (const p of layer.prov) if (p === s.province) tiles++;
    const owner = this.owner();
    const buildings = new Map<string, number>();
    for (const u of this.game.units(...Structures.types)) {
      if (layer.province(u.tile()) !== s.province) continue;
      const key = u.type().toLowerCase().replace(/ /g, "_");
      buildings.set(key, (buildings.get(key) ?? 0) + 1);
    }
    return html`
      <div class="ov-title mb-1 text-lg">${rec.name}</div>
      ${this.row(
        translateText("gsg.owner"),
        owner
          ? html`<span class="flex items-center gap-1.5"
              >${this.flag(owner)}${owner.displayName()}</span
            >`
          : translateText("gsg.unowned"),
      )}
      ${rec.capital !== null
        ? this.row(translateText("gsg.capital"), rec.name)
        : nothing}
      ${rec.population > 0
        ? this.row(translateText("gsg.people"), renderNumber(rec.population))
        : nothing}
      ${rec.population > 0
        ? this.row(
            translateText("gsg.growth"),
            `${(rec.growth / 1000).toFixed(2)}%`,
          )
        : nothing}
      ${this.row(translateText("gsg.land"), renderNumber(tiles))}
      ${this.row(
        translateText("gsg.terrain"),
        translateText(
          `gsg.terrain_${TERRAIN[this.game.terrainType(s.tile)] ?? "plains"}`,
        ),
      )}
      ${buildings.size > 0
        ? this.row(
            translateText("gsg.buildings"),
            [...buildings]
              .map(([k, n]) => `${n} ${translateText(`unit_type.${k}`)}`)
              .join(", "),
          )
        : nothing}
    `;
  }

  private nationTab(p: PlayerView) {
    const layer = provinceLayer!;
    const me = this.game.myPlayer();
    let provinces = 0;
    let people = 0;
    for (const r of layer.records) {
      if (r && r.owner === p.smallID()) {
        provinces++;
        people += r.population;
      }
    }
    const name = (id: number) => playerName(this.game, id);
    const overlord = layer.subjectOf(p.smallID());
    const subjects = layer.subjects.filter((x) => x.overlord === p.smallID());
    const relation =
      me === null
        ? null
        : p.isMe()
          ? translateText("gsg.you")
          : me.isAlliedWith(p)
            ? translateText("gsg.ally")
            : null;
    return html`
      <div class="mb-1 flex items-center gap-2">
        ${this.flag(p)}<span class="ov-title text-lg">${p.displayName()}</span>
      </div>
      ${relation ? this.row(translateText("gsg.relation"), relation) : nothing}
      ${overlord
        ? this.row(
            translateText("gsg.overlord"),
            `${name(overlord.overlord)} (${translateText(`gsg.${overlord.kind}`)})`,
          )
        : nothing}
      ${this.row(translateText("gsg.land"), renderNumber(p.numTilesOwned()))}
      ${this.row(translateText("gsg.provinces"), renderNumber(provinces))}
      ${this.row(translateText("gsg.people"), renderNumber(people))}
      ${this.row(translateText("gsg.troops_label"), renderNumber(p.troops()))}
      ${this.row(translateText("gsg.gold"), renderNumber(Number(p.gold())))}
      ${subjects.length > 0
        ? this.row(
            translateText("gsg.subjects"),
            subjects.map((x) => name(x.subject)).join(", "),
          )
        : nothing}
      ${me !== null && !p.isMe()
        ? html`<button
            class="ov-button mt-2 w-full"
            @click=${() => this.diplomacy()}
          >
            ${translateText("gsg.diplomacy")}
          </button>`
        : nothing}
    `;
  }

  private async diplomacy() {
    const me = this.game.myPlayer();
    const tile = this.selected?.tile;
    if (me === null || tile === undefined) return;
    const panel = document.querySelector("player-panel") as PlayerPanel | null;
    if (panel === null) return;
    // The panel shows a player through the tile it was opened on.
    panel.show(await me.actions(tile), tile);
  }

  render() {
    const s = this.selected;
    if (s === null || provinceLayer === null) return nothing;
    if (startYear(this.game.config().gameConfig()) === null) return nothing;
    const owner = this.owner();
    const tab = (t: Tab, label: string) =>
      html`<button
        class="ov-tab ${this.tab === t ? "ov-tab-on" : ""}"
        @click=${() => (this.tab = t)}
      >
        ${label}
      </button>`;
    return html`<div
      class="ov-panel pointer-events-auto fixed left-2 top-12 z-[250] w-72 rounded border p-3 text-sm"
    >
      <div class="mb-2 flex items-center gap-1 border-b border-white/10 pb-1">
        ${s.province !== 0
          ? tab("province", translateText("gsg.province"))
          : nothing}
        ${owner ? tab("nation", translateText("gsg.nation")) : nothing}
        <button
          class="ml-auto px-1 text-white/50 hover:text-white"
          @click=${() => selection.set(null)}
          title=${translateText("gsg.close")}
        >
          ✕
        </button>
      </div>
      ${this.tab === "nation" && owner
        ? this.nationTab(owner)
        : s.province !== 0
          ? this.provinceTab(s)
          : nothing}
    </div>`;
  }
}

export function createSelectionWindow(
  game: GameView,
  eventBus: EventBus,
): SelectionWindow | null {
  const gc = game.config().gameConfig();
  if (startYear(gc) === null || gc.sandbox === true) return null;
  const w = document.createElement("selection-window") as SelectionWindow;
  w.game = game;
  w.eventBus = eventBus;
  document.body.appendChild(w);
  return w;
}
