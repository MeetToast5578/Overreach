import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import Countries from "resources/countries.json" with { type: "json" };
import type { EventBus } from "../../core/EventBus";
import { PlayerType, UnitType } from "../../core/game/Game";
import type { TileRef } from "../../core/game/GameMap";
import {
  MAX_GOLD,
  MAX_PAINT_TILES,
  MAX_TROOPS,
  SANDBOX_STRUCTURES,
  type SandboxAction,
} from "../../core/overreach/Sandbox";
import { generateID } from "../../core/Util";
import type { Controller } from "../Controller";
import type { TransformHandler } from "../TransformHandler";
import { renderNumber, renderTroops, translateText } from "../Utils";
import type { GameView, PlayerView } from "../view";
import { provinceLayer } from "./ProvinceLayer";
import {
  SandboxStepEvent,
  SendSandboxIntentEvent,
  setSandboxControl,
} from "./SandboxEvents";
import { downloadScenario, NAME_CHARS, scenarioFromGame } from "./ScenarioFile";

type Tool =
  | "select"
  | "paint"
  | "erase"
  | "nation"
  | "build"
  | "war"
  | "peace"
  | "ally"
  | "province";
const TOOLS: Tool[] = [
  "select",
  "paint",
  "erase",
  "nation",
  "build",
  "war",
  "peace",
  "ally",
  "province",
];
// The Provinces tool's modes (Provinces.ts edits).
type ProvinceMode = "select" | "brush" | "new" | "split" | "merge" | "capital";
const PROVINCE_MODES: ProvinceMode[] = [
  "select",
  "brush",
  "new",
  "split",
  "merge",
  "capital",
];
type Structure = (typeof SANDBOX_STRUCTURES)[number];
// What Undo sends back: a stroke's tiles by their previous owner, a new
// nation to delete, or an old troop or gold value.
type UndoEntry =
  | { kind: "paint"; before: Map<string | null, TileRef[]> }
  | { kind: "nation"; id: string }
  | { kind: "troops"; player: string; troops: number }
  | { kind: "gold"; player: string; gold: number };
const MAX_UNDO = 100;
const FLUSH_MS = 100;
// Flags for new nations, by name; "xx" is the list's "None".
const FLAGS = Countries.filter((c) => c.code !== "xx").sort((a, b) =>
  a.name.localeCompare(b.name),
);
const randomColor = () =>
  `#${Math.floor(Math.random() * 0x1000000)
    .toString(16)
    .padStart(6, "0")}`;

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
  // The New nation form.
  @state() private newName = "";
  @state() private newColor = randomColor();
  @state() private newFlag = "";
  @state() private selectedID: string | null = null;
  @state() private hover: TileRef | null = null;
  // The player we play as (null observes), and the players whose AI is off.
  @state() private controlledID: string | null = null;
  @state() private aiOff = new Set<string>();
  private resumeAi = false;
  // The Provinces tool: its mode, the selected province (0 for none), the
  // name box, a split's first point and a new province's stroke.
  @state() private provinceMode: ProvinceMode = "select";
  @state() private provinceID = 0;
  @state() private provinceName = "";
  private splitFrom: TileRef | null = null;
  private newProvince = new Set<TileRef>();
  private selectProvinceAt: TileRef | null = null;

  private stroke = false;
  private swallowUp = false;
  private last: { x: number; y: number } | null = null;
  private pending = new Set<TileRef>();
  // Each tile's owner before the current stroke, for Undo.
  private strokeBefore = new Map<TileRef, string | null>();
  @state() private undoStack: UndoEntry[] = [];
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
    // A new province exists once the update after its intent arrives.
    if (this.selectProvinceAt !== null && provinceLayer !== null) {
      const id = provinceLayer.province(this.selectProvinceAt);
      if (id !== 0) this.provinceID = id;
      this.selectProvinceAt = null;
    }
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
    // preventDefault keeps focus where it was; a map click should take it
    // from the panel's inputs, or Ctrl+Z would undo their text instead.
    (document.activeElement as HTMLElement | null)?.blur();
    this.swallowUp = true;
    if (this.brushing()) {
      if (this.tool === "paint" && this.selectedID === null) return;
      if (this.provinceBrush() && this.provinceID === 0) return;
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
      this.endStroke();
      if (this.tool === "province" && this.provinceMode === "new") {
        this.createProvince();
      }
    }
  };

  private brushing(): boolean {
    return (
      this.tool === "paint" ||
      this.tool === "erase" ||
      (this.tool === "province" &&
        (this.provinceMode === "brush" || this.provinceMode === "new"))
    );
  }

  // The brush paints home tiles into the selected province (not "new").
  private provinceBrush(): boolean {
    return this.tool === "province" && this.provinceMode === "brush";
  }

  private typedProvinceName(): string {
    const name = this.provinceName.replace(NAME_CHARS, "").trim().slice(0, 40);
    return name || translateText("sandbox.province_default");
  }

  private createProvince() {
    const tiles = [...this.newProvince].slice(0, MAX_PAINT_TILES);
    this.newProvince.clear();
    if (tiles.length === 0) return;
    this.send({
      kind: "province_create",
      tiles,
      name: this.typedProvinceName(),
    });
    this.selectProvinceAt = tiles[0];
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.tool !== null) this.tool = null;
    const typing = (e.target as HTMLElement | null)?.tagName === "INPUT";
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !typing) {
      e.preventDefault();
      this.undo();
    }
  };

  private pushUndo(entry: UndoEntry) {
    this.undoStack = [...this.undoStack, entry].slice(-MAX_UNDO);
  }

  private endStroke() {
    if (this.strokeBefore.size === 0) return;
    const before = new Map<string | null, TileRef[]>();
    for (const [t, owner] of this.strokeBefore) {
      const tiles = before.get(owner) ?? [];
      tiles.push(t);
      before.set(owner, tiles);
    }
    this.strokeBefore.clear();
    this.pushUndo({ kind: "paint", before });
  }

  // Sends the inverse of the last edit. It reverts that edit, not time: the
  // world keeps whatever else happened since.
  private undo() {
    const entry = this.undoStack[this.undoStack.length - 1];
    if (entry === undefined) return;
    this.undoStack = this.undoStack.slice(0, -1);
    switch (entry.kind) {
      case "paint":
        for (const [owner, tiles] of entry.before) {
          for (let i = 0; i < tiles.length; i += MAX_PAINT_TILES) {
            const chunk = tiles.slice(i, i + MAX_PAINT_TILES);
            this.send({ kind: "paint", tiles: chunk, owner });
          }
        }
        return;
      case "nation":
        if (this.controlledID === entry.id) this.control(null);
        if (this.selectedID === entry.id) this.selectedID = null;
        this.send({ kind: "delete_nation", player: entry.id });
        return;
      case "troops":
        this.send({ ...entry, kind: "set_troops" });
        return;
      case "gold":
        this.send({ ...entry, kind: "set_gold" });
        return;
    }
  }

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
    if (this.tool === "province") {
      if (this.provinceMode === "new") {
        tiles.forEach((t) => this.newProvince.add(t));
        return;
      }
      for (let i = 0; i < tiles.length; i += MAX_PAINT_TILES) {
        this.send({
          kind: "province_assign",
          tiles: tiles.slice(i, i + MAX_PAINT_TILES),
          province: this.provinceID,
        });
      }
      return;
    }
    for (const t of tiles) {
      const o = this.game.owner(t);
      const was = o.isPlayer() ? (o as PlayerView).id() : null;
      if (was !== owner && !this.strokeBefore.has(t)) {
        this.strokeBefore.set(t, was);
      }
    }
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
      case "province":
        return this.useProvinceTool(tile);
      case "nation": {
        const name = this.newName.replace(NAME_CHARS, "").trim().slice(0, 40);
        if (name.length === 0) {
          this.querySelector<HTMLInputElement>("#sandbox-name")?.focus();
          return;
        }
        const id = generateID();
        this.send({
          kind: "create_nation",
          id,
          tile,
          name,
          color: this.newColor,
          ...(this.newFlag ? { flag: this.newFlag } : {}),
        });
        this.pushUndo({ kind: "nation", id });
        // Selected, so Paint works on it at once; the form is ready for the next.
        this.selectedID = id;
        this.newName = "";
        this.newColor = randomColor();
        this.newFlag = "";
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

  private useProvinceTool(tile: TileRef) {
    const here = provinceLayer?.province(tile) ?? 0;
    const selected = this.provinceID;
    switch (this.provinceMode) {
      case "select":
        this.provinceID = here;
        this.provinceName = provinceLayer?.records[here]?.name ?? "";
        return;
      case "split":
        if (selected === 0) return;
        if (this.splitFrom === null) {
          this.splitFrom = tile;
          return;
        }
        this.send({
          kind: "province_split",
          province: selected,
          a: this.splitFrom,
          b: tile,
          name: this.typedProvinceName(),
        });
        this.splitFrom = null;
        return;
      case "merge":
        if (selected !== 0 && here !== 0 && here !== selected) {
          this.send({ kind: "province_merge", into: selected, from: here });
        }
        return;
      case "capital":
        if (selected !== 0) {
          this.send({ kind: "province_capital", province: selected, tile });
        }
        return;
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
    const province =
      provinceLayer?.records[provinceLayer.province(t)]?.name ?? "";
    return `${where} · ${name}${province ? ` · ${province}` : ""}`;
  }

  private renderProvinceTool(btn: (on: boolean) => string) {
    const id = this.provinceID;
    const layer = provinceLayer;
    const rec = layer?.records[id] ?? null;
    const needsOne =
      this.provinceMode !== "select" && this.provinceMode !== "new";
    let tiles = 0;
    if (rec !== null) for (const p of layer!.prov) if (p === id) tiles++;
    const owner = rec?.owner ? this.game.playerBySmallID(rec.owner) : null;
    return html`<div class="space-y-1">
      <div class="flex flex-wrap gap-1">
        ${PROVINCE_MODES.map(
          (m) =>
            html`<button
              class=${btn(this.provinceMode === m)}
              @click=${() => {
                this.provinceMode = m;
                this.splitFrom = null;
              }}
            >
              ${translateText(`sandbox.province_${m}`)}
            </button>`,
        )}
      </div>
      <div class="flex gap-1">
        <input
          class="min-w-0 flex-1 rounded bg-white/10 px-1"
          maxlength="40"
          placeholder=${translateText("sandbox.province_name")}
          .value=${this.provinceName}
          @input=${(e: Event) =>
            (this.provinceName = (e.target as HTMLInputElement).value)}
        />
        <button
          class="${btn(false)} disabled:opacity-40"
          ?disabled=${rec === null}
          @click=${() =>
            this.send({
              kind: "province_rename",
              province: id,
              name: this.typedProvinceName(),
            })}
        >
          ${translateText("sandbox.rename")}
        </button>
      </div>
      ${rec === null
        ? nothing
        : html`<div>
            ${translateText("sandbox.province_info", {
              name: rec.name,
              tiles,
              owner: owner?.isPlayer()
                ? (owner as PlayerView).displayName()
                : translateText("sandbox.unclaimed"),
            })}
          </div>`}
      <div
        class=${needsOne && rec === null ? "text-yellow-300" : "text-white/60"}
      >
        ${translateText(
          needsOne && rec === null
            ? "sandbox.province_none"
            : `sandbox.province_hint_${this.provinceMode}`,
        )}
      </div>
    </div>`;
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
          <span class="flex gap-1">
            <button
              class="${btn(false)} disabled:opacity-40"
              title=${translateText("sandbox.undo_hint")}
              ?disabled=${this.undoStack.length === 0}
              @click=${() => this.undo()}
            >
              ${translateText("sandbox.undo")}
            </button>
            <button
              class=${btn(false)}
              title=${translateText("sandbox.save_hint")}
              @click=${() => downloadScenario(scenarioFromGame(this.game))}
            >
              ${translateText("sandbox.save")}
            </button>
            <button
              class=${btn(false)}
              title=${translateText("sandbox.step_hint")}
              @click=${() => this.eventBus.emit(new SandboxStepEvent())}
            >
              ${translateText("sandbox.step")}
            </button>
          </span>
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
        ${this.tool === "province" ? this.renderProvinceTool(btn) : nothing}
        ${this.brushing()
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
        ${this.tool === "nation"
          ? html`<div class="space-y-1">
              <div class="flex gap-1">
                <input
                  id="sandbox-name"
                  class="min-w-0 flex-1 rounded bg-white/10 px-1"
                  maxlength="40"
                  placeholder=${translateText("sandbox.name_prompt")}
                  .value=${this.newName}
                  @input=${(e: Event) =>
                    (this.newName = (e.target as HTMLInputElement).value)}
                />
                <input
                  type="color"
                  class="h-5 w-8 rounded bg-transparent"
                  title=${translateText("sandbox.color")}
                  .value=${this.newColor}
                  @input=${(e: Event) =>
                    (this.newColor = (e.target as HTMLInputElement).value)}
                />
              </div>
              <select
                class="w-full rounded bg-white/10 px-1"
                @change=${(e: Event) =>
                  (this.newFlag = (e.target as HTMLSelectElement).value)}
              >
                <option
                  class="bg-slate-900"
                  value=""
                  ?selected=${!this.newFlag}
                >
                  ${translateText("sandbox.no_flag")}
                </option>
                ${FLAGS.map(
                  (c) =>
                    html`<option
                      class="bg-slate-900"
                      value=${c.code}
                      ?selected=${c.code === this.newFlag}
                    >
                      ${c.name}
                    </option>`,
                )}
              </select>
              <div class="text-white/60">
                ${translateText("sandbox.nation_hint")}
              </div>
            </div>`
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
        ${(this.tool === "paint" ||
          this.tool === "war" ||
          this.tool === "peace" ||
          this.tool === "ally") &&
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
                    if (troops === null) return;
                    this.pushUndo({
                      kind: "troops",
                      player: sel.id(),
                      troops: Math.min(sel.troops(), MAX_TROOPS),
                    });
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
                    if (gold === null) return;
                    this.pushUndo({
                      kind: "gold",
                      player: sel.id(),
                      gold: Math.min(Number(sel.gold()), MAX_GOLD),
                    });
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
