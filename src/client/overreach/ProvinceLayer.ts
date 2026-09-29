import type { CityRecord } from "../../core/overreach/Cities";
import type { Subject } from "../../core/overreach/Diplomacy";
import type { Ending } from "../../core/overreach/Endings";
import type { Pending } from "../../core/overreach/Events";
import type { ProvinceRecord } from "../../core/overreach/Provinces";
import type { ProvinceViewUpdate } from "../../core/overreach/ProvinceView";

// The client's copy of the game's provinces. GameView applies each tick's
// update; ProvincePass draws it and the sandbox panel reads it.
export class ProvinceLayer {
  readonly prov: Uint16Array;
  readonly records: (ProvinceRecord | null)[] = [];
  // Named cities by unit id.
  readonly cities = new Map<number, CityRecord>();
  subjects: Subject[] = [];
  ending: Ending | null = null;
  formed = new Set<string>();
  events: Pending[] = [];
  // Rows changed since ProvincePass last uploaded them (empty when from > to).
  dirtyFrom = 0;
  dirtyTo: number;
  version = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.prov = new Uint16Array(width * height);
    this.dirtyTo = height - 1;
  }

  apply(u: ProvinceViewUpdate | undefined): void {
    if (u === undefined) return;
    if (u.layer) {
      this.prov.set(u.layer);
      this.markRows(0, this.height - 1);
      this.cities.clear();
    }
    if (u.tiles) {
      for (let i = 0; i < u.tiles.length; i += 2) {
        this.prov[u.tiles[i]] = u.tiles[i + 1];
        const y = Math.floor(u.tiles[i] / this.width);
        this.markRows(y, y);
      }
    }
    for (const [id, rec] of u.records ?? []) this.records[id] = rec;
    for (const [id, city] of u.cities ?? []) {
      if (city) this.cities.set(id, city);
      else this.cities.delete(id);
    }
    if (u.subjects) this.subjects = u.subjects;
    if (u.ending) this.ending = u.ending;
    if (u.formed) this.formed = new Set(u.formed);
    if (u.events) this.events = u.events;
    this.version++;
  }

  subjectOf(smallID: number): Subject | undefined {
    return this.subjects.find((s) => s.subject === smallID);
  }

  province(tile: number): number {
    return this.prov[tile] ?? 0;
  }

  private markRows(from: number, to: number): void {
    if (this.dirtyFrom > this.dirtyTo) {
      this.dirtyFrom = from;
      this.dirtyTo = to;
    } else {
      this.dirtyFrom = Math.min(this.dirtyFrom, from);
      this.dirtyTo = Math.max(this.dirtyTo, to);
    }
  }
}

// The running game's layer (one game at a time), set by GameView.
export let provinceLayer: ProvinceLayer | null = null;

export function startProvinceLayer(width: number, height: number): void {
  provinceLayer = new ProvinceLayer(width, height);
}
