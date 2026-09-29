import { z } from "zod";
import type { Execution, Game } from "../game/Game";
import type { GameImpl } from "../game/GameImpl";
import type { GameID } from "../Schemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zInt, zU16Array } from "../snapshot/SnapshotType";
import { simpleHash } from "../Util";
import { Cities } from "./Cities";
import { generateProvinces, ProvinceRecord, Provinces } from "./Provinces";
import { forEachOwnedTile, type ScenarioProvinces } from "./Scenario";

// Owns the game's provinces (Provinces.ts): builds them on its first tick,
// from the current tile owners, and every tick after names new cities
// (Cities.ts) and flips provinces.
// GameRunner adds it to a new game; ScenarioExecution adds it once its
// nations are placed, so a scenario's borders decide who owns what.
export class ProvinceExecution implements Execution {
  private provinces: Provinces | null = null;

  constructor(private gameID: GameID) {}

  init(mg: Game): void {
    const drawn = mg.config().gameConfig().scenario?.provinces;
    const { home, records } =
      (drawn && drawnProvinces(mg, drawn)) ??
      generateProvinces(mg, simpleHash(this.gameID));
    this.attach(mg, new Provinces(mg, home, records));
  }

  private attach(mg: Game, provinces: Provinces): void {
    this.provinces = provinces;
    provinces.cities = new Cities(mg, provinces);
    (mg as GameImpl).provinces = provinces;
  }

  tick(): void {
    this.provinces!.cities!.sync();
    this.provinces!.applyFlips();
  }

  isActive(): boolean {
    return true;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  snapshot(_w: SnapshotWriter): ExecRecord {
    const p = this.provinces;
    return ProvinceExecutionSnapshot.write({
      gameID: this.gameID,
      layers:
        p === null
          ? null
          : {
              home: p.home,
              prov: p.prov,
              records: p.records.map((r) => (r === null ? null : { ...r })),
              pending: [...p.pending],
              cities: [...p.cities!.records].map(([id, c]) => ({ id, ...c })),
            },
    });
  }

  restoreSnapshot(s: ProvinceState, r: SnapshotReader): void {
    this.gameID = s.gameID;
    this.provinces = null;
    if (s.layers === null) return;
    const p = new Provinces(
      r.game,
      s.layers.home,
      s.layers.records.map((rec) => (rec === null ? null : { ...rec })),
      s.layers.prov,
    );
    s.layers.pending.forEach((id) => p.pending.add(id));
    this.attach(r.game, p);
    for (const { id, ...city } of s.layers.cities) {
      p.cities!.records.set(id, city);
    }
  }
}

// A scenario's provinces, or null if they don't fit this map. Water and
// impassable tiles get none; a capital outside its province is dropped.
function drawnProvinces(
  mg: Game,
  s: ScenarioProvinces,
): { home: Uint16Array; records: (ProvinceRecord | null)[] } | null {
  const home = new Uint16Array(mg.width() * mg.height());
  let bad = false;
  const covered = forEachOwnedTile(s.home, (t, p) => {
    if (p > s.names.length) bad = true;
    else if (mg.isLand(t) && !mg.isImpassable(t)) home[t] = p;
  });
  if (bad || covered !== home.length) return null;
  const records: (ProvinceRecord | null)[] = [null];
  s.names.forEach((name, i) => {
    const c = s.capitals[i] ?? null;
    records.push({
      name,
      owner: 0,
      capital: c !== null && home[c] === i + 1 ? c : null,
      population: s.populations?.[i] ?? 0,
    });
  });
  return { home, records };
}

const ProvinceStateSchema = z.object({
  gameID: z.string(),
  layers: z
    .object({
      home: zU16Array(),
      prov: zU16Array(),
      records: z
        .object({
          name: z.string(),
          owner: zInt(),
          capital: zInt().nullable(),
          population: zInt(),
        })
        .nullable()
        .array(),
      pending: zInt().array(),
      cities: z
        .object({
          id: zInt(),
          name: z.string(),
          tile: zInt(),
          population: zInt(),
          founded: zInt(),
        })
        .array(),
    })
    .nullable(),
});
type ProvinceState = z.infer<typeof ProvinceStateSchema>;

export const ProvinceExecutionSnapshot = execSnapshotType({
  name: "OverreachProvinces",
  version: 1,
  schema: ProvinceStateSchema,
  cls: () => ProvinceExecution,
});
