import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { EventBus } from "../../core/EventBus";
import { PlayerType, UnitType } from "../../core/game/Game";
import type { TileRef } from "../../core/game/GameMap";
import {
  MAX_PAINT_TILES,
  MAX_TROOPS,
  SANDBOX_STRUCTURES,
  type SandboxAction,
} from "../../core/overreach/Sandbox";
import type { Controller } from "../Controller";
import type { TransformHandler } from "../TransformHandler";
import { renderNumber, renderTroops, translateText } from "../Utils";
import type { GameView, PlayerView } from "../view";
import {
  SandboxStepEvent,
  SendSandboxIntentEvent,
  setSandboxControl,
} from "./SandboxEvents";

type Tool =
  | "select"
  | "paint"
  | "erase"
  | "nation"
  | "build"
  | "war"
  | "peace"
  | "ally";
const TOOLS: Tool[] = [
  "select",
  "paint",
  "erase",
  "nation",
  "build",
  "war",
  "peace",
  "ally",
];
type Structure = (typeof SANDBOX_STRUCTURES)[number];
const FLUSH_MS = 100;
const NAME_CHARS = /[^\p{L}\p{N} .,'()&-]/gu;

/** Creates the sandbox panel when the game is a sandbox game, else null. */
export function createSandboxPanel(
  game: GameView,
  eventBus: EventBus,
  transform: TransformHandler,
): SandboxPanel | null {
  const sandbox = game.config().gameConfig().sandbox === true;
  setSandboxControl(sandbox, null);
  document.body.classList.toggle("overreach-sandbox", sandbox); // see overreach.css
  if (!sandbox) return null;
  const panel = document.createElement("sandbox-panel") as SandboxPanel;
  panel.game = game;
  panel.eventBus = eventBus;
  panel.transform = transform;
  document.body.appendChild(panel);
  return panel;
}

/**
 * God-mode toolbar. While a tool is active, left clicks and drags on the map
 * go to the tool (captured before InputHandler sees them); right drag and the
 * wheel still move the camera. Esc puts the tool away.
 */
@customElement("sandbox-panel")
export class SandboxPanel extends LitElement implements Controller {
  game!: GameView;
  eventBus!: EventBus;
  transform!: TransformHandler;

  @state() private tool: Tool | null = null;
  @state() private brush = 4;
  @state() private share = 50;
  @state() private structure: Structure = UnitType.City;
  @state() private selectedID: string | null = null;
  @state() private hover: TileRef | null = null;
  // The player we play as (null observes), and the players whose AI is off.
  @state() private controlledID: string | null = null;
  @state() private aiOff = new Set<string>();
  private resumeAi = false;

  private stroke = false;
  private swallowUp = false;
  private last: { x: number; y: number } | null = null;
  private pending = new Set<TileRef>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    window.addEventListener("pointerdown", this.onDown, { capture: true });
    window.addEventListener("pointermove", this.onMove, { capture: true });
    window.addEventListener("pointerup", this.onUp, { capture: true });
    window.addEventListener("keydown", this.onKey);
  }

  getTickIntervalMs() {
    return 500;
  }

  tick() {
    const c = this.controlledID;
    if (c !== null && !this.game.player(c).isAlive()) this.control(null);
    this.requestUpdate();
  }

  // Plays as `p`, or observes when null. The player's AI is off while we
  // control it, and comes back on release if it was on before.
  private control(p: PlayerView | null) {
    const prev = this.controlledID;
    if (prev !== null && this.resumeAi) this.setAi(prev, true);
    this.resumeAi = p !== null && !this.aiOff.has(p.id());
    if (p !== null) this.setAi(p.id(), false);
    this.controlledID = p?.id() ?? null;
    setSandboxControl(true, this.controlledID);
    this.game.setMyPlayer(p);
  }

  private setAi(player: string, on: boolean) {
    this.send({ kind: "set_ai", player, on });
    const off = new Set(this.aiOff);
    if (on) off.delete(player);
    else off.add(player);
    this.aiOff = off;
  }

  private send(action: SandboxAction) {
    this.eventBus.emit(new SendSandboxIntentEvent(action));
  }

  private onMap(e: PointerEvent): boolean {
    return (e.target as HTMLElement | null)?.id === "game-input-overlay";
  }

  private cell(e: PointerEvent) {
    return this.transform.screenToWorldCoordinates(e.clientX, e.clientY);
  }

  private tileAt(e: PointerEvent): TileRef | null {
    const c = this.cell(e);
    return this.game.isValidCoord(c.x, c.y) ? this.game.ref(c.x, c.y) : null;
  }

  private onDown = (e: PointerEvent) => {
    if (this.tool === null || e.button !== 0 || !this.onMap(e)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.swallowUp = true;
    if (this.tool === "paint" || this.tool === "erase") {
      if (this.tool === "paint" && this.selectedID === null) return;
      this.stroke = true;
      this.last = null;
      this.stamp(e);
      return;
    }
    const tile = this.tileAt(e);
    if (tile !== null) this.useTool(tile);
  };

  private onMove = (e: PointerEvent) => {
    if (this.tool === null) return;
    if (this.onMap(e)) this.hover = this.tileAt(e);
    if (!this.stroke) return;
    e.stopImmediatePropagation();
    this.stamp(e);
  };

  private onUp = (e: PointerEvent) => {
    if (!this.swallowUp) return;
    e.stopImmediatePropagation();
    this.swallowUp = false;
    if (this.stroke) {
      this.stroke = false;
      this.flush();
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.tool !== null) this.tool = null;
  };

  // Adds the brush disc along the path from the last point, so fast drags
  // leave no gaps, and sends the tiles every FLUSH_MS.
  private stamp(e: PointerEvent) {
    const to = this.cell(e);
    const from = this.last ?? to;
    const steps = Math.max(
      1,
      Math.ceil(
        Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, this.brush / 2),
      ),
    );
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
      const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
      this.disc(x, y);
    }
    this.last = { x: to.x, y: to.y };
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  private disc(cx: number, cy: number) {
    const r = this.brush - 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.game.isValidCoord(x, y)) continue;
        const t = this.game.ref(x, y);
        if (this.game.isLand(t) && !this.game.isImpassable(t)) {
          this.pending.add(t);
        }
      }
    }
  }

  private flush() {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.pending.size === 0) return;
    const owner = this.tool === "erase" ? null : this.selectedID;
    const tiles = Array.from(this.pending);
    this.pending.clear();
    for (let i = 0; i < tiles.length; i += MAX_PAINT_TILES) {
      this.send({
        kind: "paint",
        tiles: tiles.slice(i, i + MAX_PAINT_TILES),
        owner,
      });
    }
  }

  private useTool(tile: TileRef) {
    const owner = this.game.owner(tile);
    const target = owner.isPlayer() ? (owner as PlayerView) : null;
    switch (this.tool) {
      case "select":
        this.selectedID = target?.id() ?? null;
        return;
      case "nation": {
        const typed = window.prompt(translateText("sandbox.name_prompt"));
        const name = (typed ?? "").replace(NAME_CHARS, "").trim().slice(0, 40);
        if (name.length > 0) this.send({ kind: "create_nation", tile, name });
        return;
      }
      case "build":
        this.send({ kind: "build", tile, unit: this.structure });
        return;
      case "war":
      case "peace":
      case "ally": {
        const a = this.selectedID;
        if (a === null || target === null || target.id() === a) return;
        const b = target.id();
        if (this.tool === "war") {
          this.send({
            kind: "war",
            attacker: a,
            target: b,
            ratio: this.share / 100,
          });
        } else {
          this.send({ kind: this.tool, a, b });
        }
        return;
      }
    }
  }

  private selected(): PlayerView | null {
    if (this.selectedID === null) return null;
    return (
      this.game
        .players()
        .find((p) => p.id() === this.selectedID && p.isAlive()) ?? null
    );
  }

  private numberFrom(id: string): number | null {
    const el = this.querySelector<HTMLInputElement>(`#${id}`);
    const n = Number(el?.value);
    return el && el.value !== "" && Number.isFinite(n) && n >= 0
      ? Math.floor(n)
      : null;
  }

  private hoverText(): string {
    if (this.hover === null) return "";
    const t = this.hover;
    const where = `${this.game.x(t)}, ${this.game.y(t)}`;
    if (!this.game.isLand(t))
      return `${where} · ${translateText("sandbox.water")}`;
    const owner = this.game.owner(t);
    const name = owner.isPlayer()
      ? (owner as PlayerView).displayName()
      : translateText("sandbox.unclaimed");
    return `${where} · ${name}`;
  }

  render() {
    if (this.game === undefined) return nothing;
    const sel = this.selected();
    const controlled =
      this.controlledID === null ? null : this.game.player(this.controlledID);
    const btn = (on: boolean) =>
      `px-2 py-1 rounded ${on ? "bg-blue-600" : "bg-white/10 hover:bg-white/20"}`;
    return html`
      <div
        class="fixed left-2 top-1/3 z-[300] w-64 rounded-lg bg-slate-900/90 p-2 text-xs text-white space-y-2 pointer-events-auto select-none"
      >
        <div class="flex items-center justify-between font-bold uppercase">
          <span>${translateText("sandbox.title")}</span>
          <button
            class=${btn(false)}
            title=${translateText("sandbox.step_hint")}
            @click=${() => this.eventBus.emit(new SandboxStepEvent())}
          >
            ${translateText("sandbox.step")}
          </button>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="truncate">
            ${controlled === null
              ? translateText("sandbox.observing")
              : translateText("sandbox.playing_as", {
                  name: controlled.displayName(),
                })}
          </span>
          ${controlled === null
            ? nothing
            : html`<button
                class=${btn(false)}
                @click=${() => this.control(null)}
              >
                ${translateText("sandbox.observe")}
              </button>`}
        </div>
        <div class="flex flex-wrap gap-1">
          ${TOOLS.map(
            (t) =>
              html`<button
                class=${btn(this.tool === t)}
                @click=${() => (this.tool = this.tool === t ? null : t)}
              >
                ${translateText(`sandbox.tool_${t}`)}
              </button>`,
          )}
        </div>
        ${this.tool === "paint" || this.tool === "erase"
          ? html`<label class="flex items-center gap-2">
              ${translateText("sandbox.brush")}
              <input
                type="range"
                min="1"
                max="40"
                .value=${String(this.brush)}
                @input=${(e: Event) =>
                  (this.brush = Number((e.target as HTMLInputElement).value))}
              />
              ${this.brush}
            </label>`
          : nothing}
        ${this.tool === "build"
          ? html`<select
              class="w-full rounded bg-white/10 px-1"
              @change=${(e: Event) =>
                (this.structure = (e.target as HTMLSelectElement)
                  .value as Structure)}
            >
              ${SANDBOX_STRUCTURES.map(
                (u) =>
                  html`<option
                    class="bg-slate-900"
                    value=${u}
                    ?selected=${u === this.structure}
                  >
                    ${translateText(
                      `unit_type.${u.toLowerCase().replace(/ /g, "_")}`,
                    )}
                  </option>`,
              )}
            </select>`
          : nothing}
        ${this.tool === "war"
          ? html`<label class="flex items-center gap-2">
              ${translateText("sandbox.attack_share")}
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                .value=${String(this.share)}
                @input=${(e: Event) =>
                  (this.share = Number((e.target as HTMLInputElement).value))}
              />
              ${this.share}%
            </label>`
          : nothing}
        ${this.tool !== null &&
        this.tool !== "select" &&
        this.tool !== "build" &&
        sel === null
          ? html`<div class="text-yellow-300">
              ${translateText("sandbox.none_selected")}
            </div>`
          : nothing}
        ${sel === null
          ? nothing
          : html`<div class="border-t border-white/20 pt-2 space-y-1">
              <div class="flex items-center gap-2 font-bold">
                <span
                  class="inline-block w-3 h-3 rounded-sm"
                  style="background:${sel.territoryColor().toHex()}"
                ></span>
                ${sel.displayName()}
              </div>
              <div>
                ${translateText("sandbox.tiles")}: ${sel.numTilesOwned()} ·
                ${translateText("sandbox.troops")}:
                ${renderTroops(sel.troops())} ·
                ${translateText("sandbox.gold")}: ${renderNumber(sel.gold())}
              </div>
              <div class="flex gap-1">
                <input
                  id="sandbox-troops"
                  type="number"
                  min="0"
                  class="w-24 rounded bg-white/10 px-1"
                  placeholder=${translateText("sandbox.troops")}
                />
                <button
                  class=${btn(false)}
                  @click=${() => {
                    const troops = this.numberFrom("sandbox-troops");
                    // Typed as shown on screen; the engine counts tenths.
                    if (troops !== null)
                      this.send({
                        kind: "set_troops",
                        player: sel.id(),
                        troops: Math.min(troops * 10, MAX_TROOPS),
                      });
                  }}
                >
                  ${translateText("sandbox.set")}
                </button>
              </div>
              <div class="flex gap-1">
                <input
                  id="sandbox-gold"
                  type="number"
                  min="0"
                  class="w-24 rounded bg-white/10 px-1"
                  placeholder=${translateText("sandbox.gold")}
                />
                <button
                  class=${btn(false)}
                  @click=${() => {
                    const gold = this.numberFrom("sandbox-gold");
                    if (gold !== null)
                      this.send({ kind: "set_gold", player: sel.id(), gold });
                  }}
                >
                  ${translateText("sandbox.set")}
                </button>
              </div>
              ${sel.type() === PlayerType.Human
                ? nothing
                : html`<div class="flex gap-1">
                    ${sel.id() === this.controlledID
                      ? nothing
                      : html`<button
                          class=${btn(false)}
                          @click=${() => this.control(sel)}
                        >
                          ${translateText("sandbox.play_as")}
                        </button>`}
                    <button
                      class=${btn(!this.aiOff.has(sel.id()))}
                      @click=${() =>
                        this.setAi(sel.id(), this.aiOff.has(sel.id()))}
                    >
                      ${translateText(
                        this.aiOff.has(sel.id())
                          ? "sandbox.ai_off"
                          : "sandbox.ai_on",
                      )}
                    </button>
                  </div>`}
              <div class="flex gap-1">
                <button
                  class=${btn(false)}
                  @click=${() =>
                    this.send({
                      kind: "war",
                      attacker: sel.id(),
                      target: null,
                      ratio: this.share / 100,
                    })}
                >
                  ${translateText("sandbox.expand")}
                </button>
                <button
                  class=${btn(false)}
                  @click=${() =>
                    this.send({ kind: "delete_nation", player: sel.id() })}
                >
                  ${translateText("sandbox.delete")}
                </button>
              </div>
            </div>`}
        ${this.tool !== null && this.hover !== null
          ? html`<div class="text-white/70">${this.hoverText()}</div>`
          : nothing}
      </div>
    `;
  }
}
