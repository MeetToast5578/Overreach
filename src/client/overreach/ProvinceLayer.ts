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
  // Each province's tiles: their summed x and y (tile centres) and their number, kept as tiles
  // change province so nothing rescans the map.
  cx = new Float64Array(0);
  cy = new Float64Array(0);
  count = new Float64Array(0);
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
      this.recount();
      this.markRows(0, this.height - 1);
      this.cities.clear();
    }
    if (u.tiles) {
      for (let i = 0; i < u.tiles.length; i += 2) {
        const t = u.tiles[i];
        const old = this.prov[t];
        this.prov[t] = u.tiles[i + 1];
        this.move(t, old, u.tiles[i + 1]);
        const y = Math.floor(t / this.width);
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

  // The centroid sums from scratch (a whole layer arrived).
  private recount(): void {
    let max = 0;
    for (const p of this.prov) if (p > max) max = p;
    this.cx = new Float64Array(max + 1);
    this.cy = new Float64Array(max + 1);
    this.count = new Float64Array(max + 1);
    for (let y = 0, t = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++, t++) {
        const id = this.prov[t];
        if (id === 0) continue;
        this.cx[id] += x + 0.5;
        this.cy[id] += y + 0.5;
        this.count[id]++;
      }
    }
  }

  // Tile t moved from province `from` to `to`.
  private move(t: number, from: number, to: number): void {
    const x = (t % this.width) + 0.5;
    const y = Math.floor(t / this.width) + 0.5;
    if (to >= this.count.length) this.grow(to + 1);
    if (from !== 0) {
      this.cx[from] -= x;
      this.cy[from] -= y;
      this.count[from]--;
    }
    if (to !== 0) {
      this.cx[to] += x;
      this.cy[to] += y;
      this.count[to]++;
    }
  }

  private grow(n: number): void {
    const size = Math.max(n, this.count.length * 2);
    for (const key of ["cx", "cy", "count"] as const) {
      const bigger = new Float64Array(size);
      bigger.set(this[key]);
      this[key] = bigger;
    }
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
