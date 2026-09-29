import type { ProvinceRecord } from "../../core/overreach/Provinces";
import type { ProvinceViewUpdate } from "../../core/overreach/ProvinceView";

// The client's copy of the game's provinces. GameView applies each tick's
// update; ProvincePass draws it and the sandbox panel reads it.
export class ProvinceLayer {
  readonly prov: Uint16Array;
  readonly records: (ProvinceRecord | null)[] = [];
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
    }
    if (u.tiles) {
      for (let i = 0; i < u.tiles.length; i += 2) {
        this.prov[u.tiles[i]] = u.tiles[i + 1];
        const y = Math.floor(u.tiles[i] / this.width);
        this.markRows(y, y);
      }
    }
    for (const [id, rec] of u.records ?? []) this.records[id] = rec;
    this.version++;
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
