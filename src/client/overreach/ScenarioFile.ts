import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import {
  FlagSchema,
  MAX_GOLD,
  MAX_TROOPS,
  NewPlayerIDSchema,
} from "../../core/overreach/Sandbox";
import {
  encodeOwners,
  type Scenario,
  ScenarioSchema,
} from "../../core/overreach/Scenario";
import type { PlayerCosmetics } from "../../core/Schemas";
import { generateID } from "../../core/Util";
import { sanitizePersona } from "../PlayerName";
import { getMapName, translateText } from "../Utils";
import type { GameView } from "../view";

// Characters a nation name may not hold (Sandbox.NationNameSchema allows the rest).
export const NAME_CHARS = /[^\p{L}\p{N} .,'’()&-]/gu;

/** The world as a scenario: every player holding land becomes a nation. */
export function scenarioFromGame(game: GameView): Scenario {
  const players = game.players().filter((p) => p.isAlive());
  const index = new Map(players.map((p, i) => [p.smallID(), i + 1]));
  const nations = players.map((p) => {
    const flag = /^\/flags\/(.+)\.svg$/.exec(p.equippedCosmetics.flag ?? "");
    const name = p.name().replace(NAME_CHARS, "").trim().slice(0, 40);
    return {
      id: NewPlayerIDSchema.safeParse(p.id()).success ? p.id() : generateID(),
      name: name || "Nation",
      color: p.territoryColor().toHex().slice(0, 7),
      ...(flag && FlagSchema.safeParse(flag[1]).success
        ? { flag: flag[1] }
        : {}),
      troops: Math.min(Math.floor(p.troops()), MAX_TROOPS),
      gold: Math.min(Number(p.gold()), MAX_GOLD),
    };
  });
  const alliances: [number, number][] = [];
  for (let i = 0; i < players.length; i++)
    for (let j = i + 1; j < players.length; j++)
      if (players[i].isAlliedWith(players[j])) alliances.push([i, j]);
  const config = game.config().gameConfig();
  return {
    version: 1,
    map: config.gameMap,
    mapSize: config.gameMapSize,
    nations,
    alliances,
    owners: encodeOwners(
      game.width() * game.height(),
      (t) => index.get(game.ownerID(t)) ?? 0,
    ),
  };
}

export function downloadScenario(scenario: Scenario): void {
  const blob = new Blob([JSON.stringify(scenario)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${scenario.map.toLowerCase().replace(/\W+/g, "-")}.scenario.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Scenarios that ship with the game, in resources/scenarios/.
const BUILT_IN = [{ file: "world-1836", label: "sandbox.scenario_world_1836" }];

/**
 * The single-player human as the nation they picked: its name, flag and
 * colour. Empty when the scenario has no pick.
 */
export function scenarioPlayer(s: Scenario): {
  username?: string;
  clanTag?: null;
  cosmetics?: PlayerCosmetics;
} {
  const n = s.nations[s.player ?? -1];
  if (n === undefined) return {};
  // Usernames are Latin-1: "Māori" becomes "Maori", "Đại Nam" "Dai Nam".
  const latin1 = n.name
    .replace(/Đ/g, "D")
    .replace(/[^\u0000-\u00ff]/g, (c) =>
      c.normalize("NFD").replace(/\p{M}/gu, ""),
    );
  const username = sanitizePersona(latin1);
  return {
    ...(username !== null ? { username } : {}),
    clanTag: null,
    cosmetics: {
      ...(n.flag ? { flag: assetUrl(`flags/${n.flag}.svg`) } : {}),
      ...(n.color ? { color: { color: n.color } } : {}),
    },
  };
}

/**
 * Picks a scenario: a built-in one or a file ("Load scenario"). With `pick`
 * (a normal game, not a sandbox) it also picks the nation the player plays.
 * Fires `scenario-change` with the checked scenario, or null when removed.
 */
@customElement("scenario-picker")
export class ScenarioPicker extends LitElement {
  @property({ attribute: false }) scenario: Scenario | null = null;
  @property({ type: Boolean }) pick = false;
  @state() private error = false;

  createRenderRoot() {
    return this;
  }

  private emit(scenario: Scenario | null) {
    this.dispatchEvent(
      new CustomEvent("scenario-change", { detail: scenario, bubbles: true }),
    );
  }

  // Checks and emits a scenario's JSON text (null when it couldn't be read).
  private load(text: string | null) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text ?? "");
    } catch {
      // Not JSON: reported below like any other bad file.
    }
    const result = ScenarioSchema.safeParse(parsed);
    this.error = !result.success;
    if (result.success) {
      this.emit({ ...result.data, player: result.data.player ?? 0 });
    }
  }

  private async onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) this.load(await file.text());
  }

  private async onBuiltIn(file: string) {
    const res = await fetch(assetUrl(`scenarios/${file}.json`)).catch(
      () => null,
    );
    this.load(res?.ok ? await res.text() : null);
  }

  render() {
    const s = this.scenario;
    const button =
      "px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer";
    return html`<div class="mb-4 flex flex-wrap items-center gap-3 text-sm">
      ${s === null
        ? html`${BUILT_IN.map(
              (b) =>
                html`<button
                  class=${button}
                  @click=${() => this.onBuiltIn(b.file)}
                >
                  ${translateText(b.label)}
                </button>`,
            )}
            <label class=${button}>
              ${translateText("sandbox.load_scenario")}
              <input
                type="file"
                accept=".json,application/json"
                class="hidden"
                @change=${this.onFile}
              />
            </label>`
        : html`<span class="text-white/80">
              ${translateText("sandbox.scenario_loaded", {
                nations: s.nations.length,
                map: getMapName(s.map) ?? s.map,
              })}
            </span>
            <button class=${button} @click=${() => this.emit(null)}>
              ${translateText("sandbox.remove_scenario")}
            </button>
            ${this.pick ? this.renderNationPick(s) : nothing}`}
      ${this.error
        ? html`<span class="text-red-400">
            ${translateText("sandbox.scenario_invalid")}
          </span>`
        : nothing}
    </div>`;
  }

  private renderNationPick(s: Scenario) {
    const flag = s.nations[s.player ?? 0]?.flag;
    return html`<label class="flex items-center gap-2">
      ${translateText("sandbox.your_nation")}
      <select
        class="px-2 py-1.5 rounded-lg border border-white/10 bg-zinc-900 text-white"
        @change=${(e: Event) =>
          this.emit({
            ...s,
            player: Number((e.target as HTMLSelectElement).value),
          })}
      >
        ${s.nations.map(
          (n, i) =>
            html`<option value=${i} ?selected=${i === s.player}>
              ${n.name}
            </option>`,
        )}
      </select>
      ${flag
        ? html`<img
            class="h-5 w-auto"
            src=${assetUrl(`flags/${flag}.svg`)}
            alt=""
          />`
        : nothing}
    </label>`;
  }
}
