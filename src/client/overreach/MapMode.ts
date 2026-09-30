// Map modes (MASTERPLAN.md section 4.5): the same map coloured by something else. The political map is
// OpenFront's own territory colours; terrain hides them; the others paint each province from a palette
// (a province id -> colour table) that MapModes.ts fills and ProvincePass draws over the territory.

export type ModeId =
  | "political"
  | "terrain"
  | "provinces"
  | "diplomatic"
  | "population";

export const MODES: ModeId[] = [
  "political",
  "terrain",
  "provinces",
  "diplomatic",
  "population",
];

let current: ModeId = "political";
let version = 0;
const listeners = new Set<(m: ModeId) => void>();

export const mapMode = {
  get: (): ModeId => current,
  /** Bumps whenever the mode changes, so passes know to redraw. */
  version: (): number => version,
  set(m: ModeId): void {
    if (m === current) return;
    current = m;
    version++;
    for (const l of listeners) l(m);
  },
  subscribe(l: (m: ModeId) => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Provinces colour by a palette in these modes. */
export function paintsProvinces(): boolean {
  return (
    current === "provinces" ||
    current === "diplomatic" ||
    current === "population"
  );
}

/** Terrain mode shows the relief with no territory over it. */
export function hidesTerritory(): boolean {
  return current === "terrain";
}

// The palette: 65,536 RGBA entries, one per province id, laid out 256 wide.
export const PALETTE_WIDTH = 256;
export const palette = new Uint8Array(PALETTE_WIDTH * PALETTE_WIDTH * 4);
export const paletteState = { version: 0 };
