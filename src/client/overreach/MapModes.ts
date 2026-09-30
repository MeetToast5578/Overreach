import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { startYear } from "../../core/overreach/Calendar";
import type { ProvinceRecord } from "../../core/overreach/Provinces";
import type { Controller } from "../Controller";
import { translateText } from "../Utils";
import type { GameView } from "../view";
import {
  mapMode,
  type ModeId,
  MODES,
  paintsProvinces,
  palette,
  paletteState,
} from "./MapMode";
import { provinceLayer } from "./ProvinceLayer";

/** How the player's nation stands to the others (small ids), for the diplomatic map. */
export interface Relations {
  me: number;
  allies: Set<number>;
  bonds: Set<number>; // overlord or subject
  hostile: Set<number>; // fighting us now
}

const ALPHA = 235;

function set(
  out: Uint8Array,
  id: number,
  r: number,
  g: number,
  b: number,
  a = ALPHA,
) {
  out.set([r, g, b, a], id * 4);
}

// A stable, muted colour per id.
function hashColour(id: number): [number, number, number] {
  const h = ((id * 2654435761) >>> 0) % 360;
  const s = 0.42;
  const l = 0.6;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(h / 60) % 6];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255].map(Math.round) as [
    number,
    number,
    number,
  ];
}

/** Fills `out` (an RGBA entry per province id) for a map mode. */
export function paintPalette(
  mode: ModeId,
  records: (ProvinceRecord | null)[],
  rel: Relations,
  out: Uint8Array,
): void {
  out.fill(0);
  records.forEach((rec, id) => {
    if (!rec || id >= 65536) return;
    if (mode === "provinces") {
      set(out, id, ...hashColour(id));
    } else if (mode === "population") {
      // 10k people is pale, 10M is deep red, on a log scale.
      if (rec.population <= 0) return set(out, id, 214, 214, 206, 150);
      const t = Math.min(1, Math.max(0, (Math.log10(rec.population) - 4) / 3));
      set(
        out,
        id,
        Math.round(250 - 100 * t),
        Math.round(238 - 208 * t),
        Math.round(170 - 150 * t),
      );
    } else if (mode === "diplomatic") {
      const o = rec.owner;
      if (o === 0) set(out, id, 128, 128, 128, 200);
      else if (o === rel.me) set(out, id, 54, 118, 204);
      else if (rel.allies.has(o)) set(out, id, 70, 170, 90);
      else if (rel.bonds.has(o)) set(out, id, 60, 170, 170);
      else if (rel.hostile.has(o)) set(out, id, 200, 60, 50);
      else set(out, id, 196, 182, 140);
    }
  });
  paletteState.version++;
}

/**
 * The map mode buttons, bottom left, and the palette they drive: while a mode that colours provinces is
 * on, the palette is refilled as provinces change hands and relations shift.
 */
@customElement("overreach-modes")
export class MapModes extends LitElement implements Controller {
  game!: GameView;
  @state() private mode: ModeId = mapMode.get();
  private seen = "";
  private stop: (() => void) | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    this.stop = mapMode.subscribe((m) => {
      this.mode = m;
      this.seen = "";
      this.tick();
    });
  }

  disconnectedCallback() {
    this.stop?.();
    super.disconnectedCallback();
  }

  getTickIntervalMs() {
    return 500;
  }

  tick() {
    const layer = provinceLayer;
    if (layer === null || !paintsProvinces()) return;
    const me = this.game.myPlayer();
    const rel: Relations = {
      me: me?.smallID() ?? -1,
      allies: new Set(me?.allies().map((p) => p.smallID())),
      bonds: new Set(),
      hostile: new Set(),
    };
    if (me !== null) {
      for (const s of layer.subjects) {
        if (s.overlord === rel.me) rel.bonds.add(s.subject);
        if (s.subject === rel.me) rel.bonds.add(s.overlord);
      }
      for (const a of me.outgoingAttacks()) rel.hostile.add(a.targetID);
      for (const a of me.incomingAttacks()) rel.hostile.add(a.attackerID);
    }
    // Repaint only when something it depends on moved.
    const key = `${this.mode}|${layer.version}|${[...rel.allies]}|${[...rel.bonds]}|${[...rel.hostile]}`;
    if (key === this.seen) return;
    this.seen = key;
    paintPalette(this.mode, layer.records, rel, palette);
  }

  private legend() {
    if (this.mode === "population") {
      return html`<div
        class="mt-1 flex items-center gap-2 text-[11px] text-white/70"
      >
        <span>10k</span
        ><span
          class="h-2 flex-1 rounded"
          style="background: linear-gradient(90deg, rgb(250,238,170), rgb(150,30,20))"
        ></span
        ><span>10M</span>
      </div>`;
    }
    if (this.mode === "diplomatic") {
      const dot = (c: string, label: string) =>
        html`<span class="flex items-center gap-1"
          ><span
            class="inline-block h-2 w-2 rounded-full"
            style="background:${c}"
          ></span
          >${label}</span
        >`;
      return html`<div
        class="mt-1 flex flex-wrap gap-x-3 text-[11px] text-white/70"
      >
        ${dot("#3676cc", translateText("gsg.you"))}
        ${dot("#46aa5a", translateText("gsg.ally"))}
        ${dot("#3caaaa", translateText("gsg.bond"))}
        ${dot("#c83c32", translateText("gsg.hostile"))}
      </div>`;
    }
    return nothing;
  }

  render() {
    if (!this.game || startYear(this.game.config().gameConfig()) === null) {
      return nothing;
    }
    return html`<div
      class="ov-panel pointer-events-auto fixed bottom-2 left-2 z-[240] rounded border p-1.5 text-xs"
    >
      <div class="flex gap-1">
        ${MODES.map(
          (m) =>
            html`<button
              class="ov-tab ${this.mode === m ? "ov-tab-on" : ""}"
              @click=${() => mapMode.set(m)}
            >
              ${translateText(`gsg.mode_${m}`)}
            </button>`,
        )}
      </div>
      ${this.legend()}
    </div>`;
  }
}

export function createMapModes(game: GameView): MapModes | null {
  const gc = game.config().gameConfig();
  if (startYear(gc) === null || gc.sandbox === true) return null;
  mapMode.set("political");
  const bar = document.createElement("overreach-modes") as MapModes;
  bar.game = game;
  document.body.appendChild(bar);
  return bar;
}
