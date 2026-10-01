import type { Game } from "../game/Game";
import type { GameImpl } from "../game/GameImpl";
import type { CityRecord } from "./Cities";
import type { Subject } from "./Diplomacy";
import type { Ending } from "./Endings";
import type { Pending } from "./Events";
import type { ProvinceRecord, Provinces } from "./Provinces";

// What the client needs to draw provinces (GameUpdateViewData.provinces):
// every tile's current province once, then the tiles and records that
// changed. A layer arrives again when the provinces are new (a restore).
export interface ProvinceViewUpdate {
  layer?: Uint16Array;
  // [tile, province] pairs.
  tiles?: Uint32Array;
  // Changed records by id; null for a deleted province.
  records?: [number, ProvinceRecord | null][];
  // Named cities by unit id, new or (null) gone; all of them with a layer.
  cities?: [number, CityRecord | null][];
  // Every subject bond, when any changed.
  subjects?: Subject[];
  // Every coalition, as [the nation it is against, its members], when any changed.
  coalitions?: [number, number[]][];
  // How the game ended (Endings.ts), once.
  ending?: Ending;
  // Formables formed and events awaiting an answer, when either changed.
  formed?: string[];
  events?: Pending[];
}

export class ProvinceViewTracker {
  private sent: Provinces | null = null;
  private shadow: (ProvinceRecord | null)[] = [];
  private subjectsSent = "";
  private coalitionsSent = "";
  private endingSent = false;
  private storySent = "";

  next(game: Game): ProvinceViewUpdate | undefined {
    const out: ProvinceViewUpdate = {};
    const ending = (game as GameImpl).ending;
    if (ending !== undefined && !this.endingSent) {
      this.endingSent = true;
      out.ending = { ...ending };
    }
    const formed = [...((game as GameImpl).diplomacy?.formed ?? [])];
    const events = (game as GameImpl).events?.pending ?? [];
    const story = JSON.stringify([formed, events]);
    if (story !== this.storySent) {
      this.storySent = story;
      out.formed = formed;
      out.events = events.map((q) => ({ ...q }));
    }
    const p = (game as GameImpl).provinces;
    if (p === undefined) return Object.keys(out).length > 0 ? out : undefined;
    if (p !== this.sent || p.clientOverflow) {
      this.sent = p;
      this.shadow = [];
      out.layer = p.prov.slice();
    } else if (p.clientChanges.length > 0) {
      const pairs = new Uint32Array(p.clientChanges.length * 2);
      p.clientChanges.forEach((t, i) => {
        pairs[2 * i] = t;
        pairs[2 * i + 1] = p.prov[t];
      });
      out.tiles = pairs;
    }
    p.clientChanges = [];
    p.clientOverflow = false;

    const records: [number, ProvinceRecord | null][] = [];
    const n = Math.max(p.records.length, this.shadow.length);
    for (let i = 1; i < n; i++) {
      const r = p.records[i] ?? null;
      const s = this.shadow[i] ?? null;
      const same =
        r === null || s === null
          ? r === s
          : r.name === s.name &&
            r.owner === s.owner &&
            r.capital === s.capital &&
            r.population === s.population;
      if (same) continue;
      this.shadow[i] = r && { ...r };
      records.push([i, r && { ...r }]);
    }
    if (records.length > 0) out.records = records;

    const cities = p.cities;
    if (cities !== null) {
      const ids = out.layer
        ? [...cities.records.keys()]
        : [...cities.clientChanges];
      cities.clientChanges.clear();
      if (ids.length > 0) {
        out.cities = ids.map((id) => [id, cities.records.get(id) ?? null]);
      }
    }
    const subjects = (game as GameImpl).diplomacy?.subjects ?? [];
    const key = JSON.stringify(subjects);
    if (key !== this.subjectsSent || out.layer) {
      this.subjectsSent = key;
      out.subjects = subjects.map((s) => ({ ...s }));
    }
    const coalitions = [
      ...((game as GameImpl).diplomacy?.coalitions ?? []),
    ].map(([target, members]) => [target, [...members]] as [number, number[]]);
    const coalitionKey = JSON.stringify(coalitions);
    if (coalitionKey !== this.coalitionsSent || out.layer) {
      this.coalitionsSent = coalitionKey;
      out.coalitions = coalitions;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
}
