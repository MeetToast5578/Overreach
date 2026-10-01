import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import {
  Difficulty,
  GameMapSize,
  GameMode,
  GameType,
} from "../../core/game/Game";
import { type Scenario, ScenarioSchema } from "../../core/overreach/Scenario";
import { generateID } from "../../core/Util";
import { BaseModal } from "../components/BaseModal";
import { GameStartingModal } from "../GameStartingModal";
import { renderNumber, translateText } from "../Utils";
import { scenarioPlayer } from "./ScenarioFile";

// The new-game page (MASTERPLAN.md section 4.4): a start date, and the world on that date as a map you click to
// pick the nation you'll play. The map is the scenario's own owner runs, sampled to a small grid and drawn over
// the painted relief, so nothing has to be running to show it.

const BOOKMARKS = [{ id: "1836", file: "world-1836" }];
const GRID_SHRINK = 4; // tiles per preview cell, each way
const WATER = "#2c4f74";

/** The owner of each cell of the world shrunk by `shrink`, and each nation's land in tiles. */
export function previewGrid(
  owners: number[],
  width: number,
  height: number,
  shrink: number,
  nations: number,
): { cells: Uint16Array; w: number; h: number; tiles: number[] } {
  const w = Math.floor(width / shrink);
  const h = Math.floor(height / shrink);
  const cells = new Uint16Array(w * h);
  const tiles = new Array<number>(nations + 1).fill(0);
  // Walk the runs once, and the sample tiles in the same order.
  let run = 0;
  let runEnd = owners[1];
  let runValue = owners[0];
  for (let i = 0; i < owners.length; i += 2) tiles[owners[i]] += owners[i + 1];
  const half = Math.floor(shrink / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (y * shrink + half) * width + x * shrink + half;
      while (t >= runEnd && run * 2 + 3 < owners.length) {
        run++;
        runValue = owners[run * 2];
        runEnd += owners[run * 2 + 1];
      }
      cells[y * w + x] = t < runEnd ? runValue : 0;
    }
  }
  return { cells, w, h, tiles };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Each nation's bounding box on the preview grid: x0, y0, x1, y1 (inclusive), or
 * -1s for a nation with no cell. Highlighting a nation then scans its box instead
 * of all 1.4M cells, which matters because the hover follows the mouse.
 */
export function nationBoxes(
  cells: Uint16Array,
  w: number,
  h: number,
  nations: number,
): Int32Array {
  const boxes = new Int32Array((nations + 1) * 4).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = cells[y * w + x];
      if (n === 0) continue;
      const b = n * 4;
      if (boxes[b] < 0 || x < boxes[b]) boxes[b] = x;
      if (boxes[b + 2] < 0 || x > boxes[b + 2]) boxes[b + 2] = x;
      if (boxes[b + 1] < 0 || y < boxes[b + 1]) boxes[b + 1] = y;
      if (boxes[b + 3] < 0 || y > boxes[b + 3]) boxes[b + 3] = y;
    }
  }
  return boxes;
}

@customElement("overreach-newgame")
export class NewGame extends BaseModal {
  protected routerName = "new-game";

  @state() private scenario: Scenario | null = null;
  @state() private picked = 0;
  @state() private hover = -1;
  @state() private difficulty: Difficulty = Difficulty.Medium;
  @state() private failed = false;
  private grid: ReturnType<typeof previewGrid> | null = null;
  private boxes: Int32Array | null = null;
  private relief: HTMLImageElement | null = null;
  private overlay: HTMLCanvasElement | null = null;
  /** Water, relief and the owners' colours — everything but the two highlights. */
  private base: HTMLCanvasElement | null = null;
  /** `base` with the picked nation already lit: a click is what changes it, not the mouse. */
  private pickedLayer: HTMLCanvasElement | null = null;
  /** The layer the live canvas currently shows, and whose pick is in it. */
  private frameFrom: HTMLCanvasElement | null = null;
  private pickedLayerIndex = -1;
  /** The hovered nation's box as painted on the live canvas (for the next restore). */
  private hoverBox: [number, number, number, number] | null = null;
  // The tooltip's own corner of the map, in CSS pixels. Not @state on purpose:
  // the mouse moves many times a second and only a change of nation is worth a
  // repaint (see the mousemove handler).
  private tip = { x: 0, y: 0 };
  private loading = false;

  protected modalConfig() {
    return { alwaysMaximized: true, maxWidth: "1400px" };
  }

  protected onOpen(): void {
    void this.load();
  }

  private async load() {
    if (this.scenario !== null || this.loading) return;
    this.loading = true;
    try {
      const res = await fetch(assetUrl(`scenarios/${BOOKMARKS[0].file}.json`));
      if (!res.ok) throw new Error(String(res.status));
      const s = ScenarioSchema.parse(await res.json());
      const map = await this.mapSize(s);
      this.grid = previewGrid(
        s.owners,
        map.width,
        map.height,
        GRID_SHRINK,
        s.nations.length,
      );
      this.scenario = { ...s, player: s.player ?? 0 };
      this.picked = this.scenario.player ?? 0;
      this.boxes = nationBoxes(
        this.grid.cells,
        this.grid.w,
        this.grid.h,
        s.nations.length,
      );
      this.buildOverlay();
      const img = new Image();
      img.onload = () => {
        this.relief = img;
        this.buildBase();
        this.paint();
      };
      img.src = assetUrl(`maps/${s.map.toLowerCase()}/relief.png`);
    } catch (error) {
      console.warn("Failed to load the scenario:", error);
      this.failed = true;
    } finally {
      this.loading = false;
    }
  }

  private async mapSize(
    s: Scenario,
  ): Promise<{ width: number; height: number }> {
    const res = await fetch(
      assetUrl(`maps/${s.map.toLowerCase()}/manifest.json`),
    );
    return (await res.json()).map;
  }

  // The nations drawn once, in their colours, with a dark line where two meet.
  private buildOverlay() {
    const g = this.grid!;
    const colours = this.scenario!.nations.map((n) =>
      rgb(n.color ?? "#888888"),
    );
    const canvas = document.createElement("canvas");
    canvas.width = g.w;
    canvas.height = g.h;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(g.w, g.h);
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const i = y * g.w + x;
        const o = g.cells[i];
        if (o === 0) continue;
        const [r, gr, b] = colours[o - 1];
        const edge =
          (x + 1 < g.w && g.cells[i + 1] !== o) ||
          (y + 1 < g.h && g.cells[i + g.w] !== o);
        img.data.set(
          edge ? [r * 0.45, gr * 0.45, b * 0.45, 255] : [r, gr, b, 230],
          i * 4,
        );
      }
    }
    ctx.putImageData(img, 0, 0);
    this.overlay = canvas;
    this.buildBase();
    this.paint();
  }

  // Water, relief and the owners' colours, drawn once per load (and once more
  // when the relief image arrives). Hovers are painted on a copy of this.
  private buildBase() {
    const g = this.grid;
    if (g === null || this.overlay === null) return;
    const canvas = document.createElement("canvas");
    canvas.width = g.w;
    canvas.height = g.h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = WATER;
    ctx.fillRect(0, 0, g.w, g.h);
    if (this.relief) ctx.drawImage(this.relief, 0, 0, g.w, g.h);
    ctx.globalAlpha = 0.62;
    ctx.drawImage(this.overlay, 0, 0);
    ctx.globalAlpha = 1;
    this.base = canvas;
    this.buildPickedLayer();
  }

  /** The base with the picked nation lit. Rebuilt only when the pick changes. */
  private buildPickedLayer() {
    if (this.base === null) return;
    const canvas = document.createElement("canvas");
    canvas.width = this.base.width;
    canvas.height = this.base.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(this.base, 0, 0);
    this.paintNation(ctx, this.picked, 0.45);
    this.pickedLayer = canvas;
    this.pickedLayerIndex = this.picked;
    // The live canvas is now out of date; the next paint redraws it whole.
    this.frameFrom = null;
  }

  /** Light one nation's cells, scanning only the box that holds them. */
  private paintNation(
    ctx: CanvasRenderingContext2D,
    index: number,
    alpha: number,
  ) {
    if (index < 0) return;
    const g = this.grid!;
    const b = (index + 1) * 4;
    const x0 = this.boxes![b];
    if (x0 < 0) return;
    const [y0, x1, y1] = [
      this.boxes![b + 1],
      this.boxes![b + 2],
      this.boxes![b + 3],
    ];
    ctx.fillStyle = `rgba(255, 244, 214, ${alpha})`;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (g.cells[y * g.w + x] === index + 1) ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  protected updated(): void {
    if (this.picked !== this.pickedLayerIndex) this.buildPickedLayer();
    this.paint();
    this.positionTip();
  }

  private paint() {
    const canvas = this.querySelector<HTMLCanvasElement>("#ov-newgame-map");
    const g = this.grid;
    const from = this.pickedLayer;
    if (canvas === null || g === null || from === null) return;
    const ctx = canvas.getContext("2d")!;
    if (canvas.width !== g.w || canvas.height !== g.h) {
      canvas.width = g.w;
      canvas.height = g.h;
      this.frameFrom = null;
    }
    if (this.frameFrom !== from) {
      ctx.drawImage(from, 0, 0);
      this.frameFrom = from;
      this.hoverBox = null;
    } else if (this.hoverBox) {
      // A hover only touches two small squares of the canvas: the one the
      // pointer just left, and the one it is in now.
      const [x0, y0, x1, y1] = this.hoverBox;
      ctx.drawImage(
        from,
        x0,
        y0,
        x1 - x0 + 1,
        y1 - y0 + 1,
        x0,
        y0,
        x1 - x0 + 1,
        y1 - y0 + 1,
      );
    }
    const hover = this.hover;
    if (hover >= 0 && hover !== this.picked) {
      this.paintNation(ctx, hover, 0.3);
      const b = (hover + 1) * 4;
      this.hoverBox = [
        this.boxes![b],
        this.boxes![b + 1],
        this.boxes![b + 2],
        this.boxes![b + 3],
      ];
    } else {
      this.hoverBox = null;
    }
  }

  /** Keep the hover card beside the pointer, inside the map near its edges. */
  private positionTip() {
    const canvas = this.querySelector<HTMLCanvasElement>("#ov-newgame-map");
    const card = this.querySelector<HTMLElement>("#ov-newgame-tip");
    if (canvas === null || card === null) return;
    const gap = 14;
    let left = this.tip.x + gap;
    if (left + card.offsetWidth > canvas.clientWidth) {
      left = Math.max(0, this.tip.x - gap - card.offsetWidth);
    }
    let top = this.tip.y + gap;
    if (top + card.offsetHeight > canvas.clientHeight) {
      top = Math.max(0, this.tip.y - gap - card.offsetHeight);
    }
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  private nationAt(e: MouseEvent): number {
    const g = this.grid;
    const canvas = e.currentTarget as HTMLCanvasElement;
    if (g === null) return -1;
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * g.w);
    const y = Math.floor(((e.clientY - r.top) / r.height) * g.h);
    return (g.cells[y * g.w + x] ?? 0) - 1;
  }

  private start() {
    const s = this.scenario;
    if (s === null) return;
    const clientID = generateID();
    const gameID = generateID();
    const asNation = scenarioPlayer({ ...s, player: this.picked });
    const starting = document.querySelector("game-starting-modal");
    if (starting instanceof GameStartingModal) starting.show();
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID,
          gameStartInfo: {
            gameID,
            players: [
              { clientID, username: "Player", clanTag: null, ...asNation },
            ],
            config: {
              gameMap: s.map,
              gameMapSize: GameMapSize.Normal,
              gameType: GameType.Singleplayer,
              gameMode: GameMode.FFA,
              difficulty: this.difficulty,
              bots: 0,
              nations: "disabled" as const,
              infiniteGold: false,
              infiniteTroops: false,
              donateGold: false,
              donateTroops: false,
              instantBuild: false,
              randomSpawn: false,
              disabledUnits: [],
              scenario: { ...s, player: this.picked },
            },
            lobbyCreatedAt: Date.now(),
          },
          source: "singleplayer",
          playerName: asNation.username,
        },
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }

  private flag(i: number, cls = "h-4 w-6") {
    const f = this.scenario?.nations[i]?.flag;
    return f
      ? html`<img
          class="${cls} rounded-sm object-cover"
          src=${assetUrl(`flags/${f}.svg`)}
          alt=""
        />`
      : nothing;
  }

  /** A nation's land in tiles and its rank among the scenario's nations. */
  private land(i: number): { tiles: number; rank: number } {
    const tiles = this.grid!.tiles;
    const land = tiles[i + 1];
    return {
      tiles: land,
      rank: 1 + tiles.slice(1).filter((t) => t > land).length,
    };
  }

  private nationCard(): TemplateResult {
    const s = this.scenario!;
    const n = s.nations[this.picked];
    const { tiles, rank } = this.land(this.picked);
    const name = (i: number) => s.nations[i]?.name ?? "";
    const bond = s.subjects?.find(([, sub]) => sub === this.picked);
    const subjects = (s.subjects ?? []).filter(([o]) => o === this.picked);
    const allies = s.alliances.flatMap(([a, b]) =>
      a === this.picked ? [b] : b === this.picked ? [a] : [],
    );
    const row = (label: string, value: unknown) =>
      html`<div class="flex justify-between gap-3 py-0.5">
        <span class="text-white/60">${label}</span
        ><span class="text-right">${value}</span>
      </div>`;
    return html`<div class="ov-panel rounded border p-3 text-sm">
      <div class="mb-1 flex items-center gap-2">
        ${this.flag(this.picked, "h-5 w-8")}
        <span class="ov-title text-xl">${n.name}</span>
      </div>
      ${row(translateText("newgame.land"), renderNumber(tiles))}
      ${row(translateText("newgame.rank"), `${rank} / ${s.nations.length}`)}
      ${bond
        ? row(
            translateText("gsg.overlord"),
            `${name(bond[0])} (${translateText(`gsg.${bond[2]}`)})`,
          )
        : nothing}
      ${subjects.length > 0
        ? row(
            translateText("gsg.subjects"),
            subjects.map(([, sub]) => name(sub)).join(", "),
          )
        : nothing}
      ${allies.length > 0
        ? row(translateText("gsg.allies"), allies.map(name).join(", "))
        : nothing}
    </div>`;
  }

  protected renderBody(): TemplateResult {
    const s = this.scenario;
    const button =
      "rounded border border-white/10 bg-white/5 px-2 py-1 hover:bg-white/10";
    if (this.failed) {
      return html`<div class="p-8 text-red-300">
        ${translateText("newgame.failed")}
      </div>`;
    }
    if (s === null || this.grid === null) {
      return this.renderLoadingSpinner(translateText("newgame.loading"));
    }
    const hover = this.hover >= 0 ? this.land(this.hover) : null;
    return html`<div
      class="flex h-full flex-col gap-3 overflow-y-auto p-4 text-white"
    >
      <div class="flex items-center gap-3">
        <button class=${button} @click=${() => this.close()}>←</button>
        <h2 class="ov-title text-2xl">${translateText("newgame.title")}</h2>
      </div>
      <div class="relative">
        <canvas
          id="ov-newgame-map"
          class="w-full cursor-pointer rounded border border-[#8a6d3b] [image-rendering:auto]"
          @mousemove=${(e: MouseEvent) => {
            this.tip = { x: e.offsetX, y: e.offsetY };
            const i = this.nationAt(e);
            // Only a change of nation repaints the map: the pointer moves far
            // more often than it crosses a border.
            if (i !== this.hover) this.hover = i;
            this.positionTip();
          }}
          @mouseleave=${() => (this.hover = -1)}
          @click=${(e: MouseEvent) => {
            const i = this.nationAt(e);
            if (i >= 0) this.picked = i;
          }}
        ></canvas>
        ${this.hover >= 0
          ? html`<div
              id="ov-newgame-tip"
              class="ov-panel pointer-events-none absolute flex items-center gap-2 whitespace-nowrap rounded border px-2 py-1 text-sm"
            >
              ${this.flag(this.hover)}${s.nations[this.hover].name}
              <span class="text-white/50"
                >#${hover!.rank} · ${renderNumber(hover!.tiles)}</span
              >
            </div>`
          : nothing}
      </div>
      <div class="grid items-start gap-3 lg:grid-cols-[1fr_340px]">
        <div class="flex flex-col gap-3">
          <div class="ov-panel rounded border p-3 text-sm">
            <div class="ov-title text-lg">
              ${translateText("newgame.bookmark_1836")}
            </div>
            <div class="mt-1 text-white/70">
              ${translateText("newgame.bookmark_1836_text")}
            </div>
          </div>
          <div class="ov-panel rounded border p-3">
            <div class="mb-2 text-xs uppercase tracking-widest text-white/50">
              ${translateText("newgame.great_powers")}
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${s.nations
                .slice(0, 10)
                .map(
                  (n, i) =>
                    html`<button
                      class="${button} flex items-center gap-1.5 text-xs ${i ===
                      this.picked
                        ? "ov-tab-on"
                        : ""}"
                      @click=${() => (this.picked = i)}
                    >
                      ${this.flag(i, "h-3 w-5")}${n.name}
                    </button>`,
                )}
            </div>
          </div>
        </div>
        <div class="flex flex-col gap-3">
          ${this.nationCard()}
          <label class="flex items-center justify-between gap-3 text-sm">
            ${translateText("difficulty.difficulty")}
            <select
              class="rounded border border-white/10 bg-zinc-900 px-2 py-1.5 text-white"
              @change=${(e: Event) =>
                (this.difficulty = (e.target as HTMLSelectElement)
                  .value as Difficulty)}
            >
              ${Object.values(Difficulty).map(
                (d) =>
                  html`<option value=${d} ?selected=${d === this.difficulty}>
                    ${translateText(`difficulty.${d.toLowerCase()}`)}
                  </option>`,
              )}
            </select>
          </label>
          <button
            class="ov-button py-2 text-base uppercase tracking-wider"
            @click=${() => this.start()}
          >
            ${translateText("newgame.start", {
              nation: s.nations[this.picked].name,
            })}
          </button>
        </div>
      </div>
    </div>`;
  }
}
