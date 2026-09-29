import type { Player, PlayerInfo } from "../game/Game";
import type { GameConfig } from "../Schemas";
import { formatPlayerDisplayName } from "../Util";

// Formable nations (Overreach, SANDBOX.md F7; ROADMAP.md M13). A nation that
// holds FORM_PERCENT% of a formable's homeland (its provinces in today's
// countries, from the scenario) may form it, once per game: it takes the
// name, flag and colour, and the homeland it holds becomes its core. The AI
// forms as soon as it can (Diplomacy.ts); a human decides (the "form"
// action, OverreachIntent.ts).

export interface Formable {
  id: string;
  name: string;
  flag: string | null;
  color: string;
  homeland: string[]; // ISO3 codes
}

export const FORMABLES: Formable[] = [
  {
    id: "germany",
    name: "Germany",
    flag: "German Empire",
    color: "#5c6a7a",
    homeland: ["DEU"],
  },
  {
    id: "italy",
    name: "Italy",
    flag: "it",
    color: "#4f9d5d",
    homeland: ["ITA"],
  },
  {
    id: "romania",
    name: "Romania",
    flag: "ro",
    color: "#d9b33b",
    homeland: ["ROU"],
  },
  {
    id: "yugoslavia",
    name: "Yugoslavia",
    flag: null,
    color: "#4a6fb5",
    homeland: ["SRB", "HRV", "BIH", "SVN", "MNE", "MKD"],
  },
];

export const FORM_PERCENT = 70;

/** Each formable's homeland province ids, from the scenario. */
export function homelands(gc: GameConfig): Map<string, number[]> {
  const countries = gc.scenario?.provinces?.countries ?? [];
  const out = new Map<string, number[]>();
  for (const f of FORMABLES) {
    const ids = countries.flatMap((c, i) =>
      f.homeland.includes(c) ? [i + 1] : [],
    );
    if (ids.length > 0) out.set(f.id, ids);
  }
  return out;
}

/**
 * The formables `who` (a small id, holding `ownTiles`) may form: not formed
 * yet, it holds FORM_PERCENT% of the homeland's land, and at least half its
 * own land is there. Works on the worker's provinces and the
 * client's copy alike.
 */
export function formableBy(
  gc: GameConfig,
  formed: ReadonlySet<string>,
  who: number,
  ownerOf: (p: number) => number,
  sizeOf: (p: number) => number,
  ownTiles: number,
): Formable[] {
  const lands = homelands(gc);
  return FORMABLES.filter((f) => {
    const ids = lands.get(f.id);
    if (ids === undefined || formed.has(f.id)) return false;
    let held = 0;
    let total = 0;
    for (const p of ids) {
      total += sizeOf(p);
      if (ownerOf(p) === who) held += sizeOf(p);
    }
    // And it lies mainly inside: Austria's Croatia doesn't make it Yugoslav.
    return (
      total > 0 && held * 100 >= total * FORM_PERCENT && held * 2 >= ownTiles
    );
  });
}

/**
 * Renames a player in place (its PlayerInfo, which snapshots and the client
 * both read from), with a new flag and colour.
 */
export function renamePlayer(
  p: Player,
  name: string,
  flag: string | null,
  color: string,
): void {
  const info = p.info() as { -readonly [K in keyof PlayerInfo]: PlayerInfo[K] };
  info.name = name;
  info.displayName = formatPlayerDisplayName(name, info.clanTag);
  info.nationFlag = flag;
  info.color = color;
}
