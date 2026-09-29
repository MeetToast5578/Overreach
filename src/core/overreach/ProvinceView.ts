import type { Game } from "../game/Game";
import type { GameImpl } from "../game/GameImpl";
import type { CityRecord } from "./Cities";
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
}

export class ProvinceViewTracker {
  private sent: Provinces | null = null;
  private shadow: (ProvinceRecord | null)[] = [];

  next(game: Game): ProvinceViewUpdate | undefined {
    const p = (game as GameImpl).provinces;
    if (p === undefined) return undefined;
    const out: ProvinceViewUpdate = {};
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
    return out.layer || out.tiles || out.records || out.cities
      ? out
      : undefined;
  }
}
