import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { startYear } from "../../core/overreach/Calendar";
import type { Controller } from "../Controller";
import { renderTroops, translateText } from "../Utils";
import type { GameView } from "../view";
import { provinceLayer } from "./ProvinceLayer";
import { playerName } from "./Selection";

interface Line {
  text: string;
  note?: string;
}
interface Section {
  title: string;
  lines: Line[];
}

/**
 * The outliner on the right: what your nation is doing and who it is tied to (MASTERPLAN.md
 * section 4). Wars join it in G3, once a war is an object the client can list.
 */
@customElement("overreach-outliner")
export class Outliner extends LitElement implements Controller {
  game!: GameView;
  @state() private sections: Section[] = [];

  createRenderRoot() {
    return this;
  }

  getTickIntervalMs() {
    return 1000;
  }

  tick() {
    const me = this.game.myPlayer();
    const layer = provinceLayer;
    if (me === null || !me.isAlive() || layer === null) {
      this.sections = [];
      return;
    }
    const name = (smallID: number) => playerName(this.game, smallID);
    const sections: Section[] = [];
    const attacks = [
      ...me.outgoingAttacks().map((a) => ({
        text: `→ ${name(a.targetID)}`,
        note: renderTroops(a.troops),
      })),
      ...me.incomingAttacks().map((a) => ({
        text: `← ${name(a.attackerID)}`,
        note: renderTroops(a.troops),
      })),
    ];
    if (attacks.length > 0) {
      sections.push({ title: translateText("gsg.attacks"), lines: attacks });
    }
    const allies = me.allies().map((p) => ({ text: p.displayName() }));
    if (allies.length > 0) {
      sections.push({ title: translateText("gsg.allies"), lines: allies });
    }
    const subjects = layer.subjects
      .filter((s) => s.overlord === me.smallID())
      .map((s) => ({
        text: name(s.subject),
        note: translateText(`gsg.${s.kind}`),
      }));
    if (subjects.length > 0) {
      sections.push({ title: translateText("gsg.subjects"), lines: subjects });
    }
    const overlord = layer.subjectOf(me.smallID());
    if (overlord) {
      sections.push({
        title: translateText("gsg.overlord"),
        lines: [
          {
            text: name(overlord.overlord),
            note: translateText(`gsg.${overlord.kind}`),
          },
        ],
      });
    }
    this.sections = sections;
  }

  render() {
    if (this.sections.length === 0) return nothing;
    return html`<div
      class="ov-panel pointer-events-auto fixed right-2 top-12 z-[240] max-h-[40vh] w-56 overflow-y-auto rounded border p-2 text-xs"
    >
      ${this.sections.map(
        (s) =>
          html`<div class="mb-2 last:mb-0">
            <div class="ov-title mb-0.5 text-[11px] uppercase tracking-wider">
              ${s.title}
            </div>
            ${s.lines.map(
              (l) =>
                html`<div class="flex justify-between gap-2 py-px">
                  <span>${l.text}</span>${l.note
                    ? html`<span class="text-white/50">${l.note}</span>`
                    : nothing}
                </div>`,
            )}
          </div>`,
      )}
    </div>`;
  }
}

export function createOutliner(game: GameView): Outliner | null {
  const gc = game.config().gameConfig();
  if (startYear(gc) === null || gc.sandbox === true) return null;
  const o = document.createElement("overreach-outliner") as Outliner;
  o.game = game;
  document.body.appendChild(o);
  return o;
}
