import { z } from "zod";
import { type Execution, type Game, PlayerType } from "../game/Game";
import type { GameImpl } from "../game/GameImpl";
import { PseudoRandom } from "../PseudoRandom";
import type { GameID } from "../Schemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zInt, zRandom } from "../snapshot/SnapshotType";
import { simpleHash } from "../Util";
import { Diplomacy } from "./Diplomacy";

// Runs Diplomacy.ts. Added right after ProvinceExecution, whose provinces it
// needs; a scenario's subjects are made on its first tick.
export class DiplomacyExecution implements Execution {
  private diplomacy: Diplomacy | null = null;
  private random: PseudoRandom;

  constructor(private gameID: GameID) {
    this.random = new PseudoRandom(simpleHash(gameID) + 1836);
  }

  init(mg: Game): void {
    const provinces = (mg as GameImpl).provinces;
    if (provinces === undefined) return;
    const d = new Diplomacy(mg, provinces, this.gameID, this.random);
    d.start();
    const s = mg.config().gameConfig().scenario;
    const human = mg.players().find((p) => p.type() === PlayerType.Human);
    const nation = (i: number) => {
      const n = s?.nations[i];
      if (n === undefined) return null;
      if (mg.hasPlayer(n.id)) return mg.player(n.id);
      return i === s?.player ? (human ?? null) : null;
    };
    for (const [o, v, kind] of s?.subjects ?? []) {
      const overlord = nation(o);
      const subject = nation(v);
      if (overlord && subject) d.setSubject(overlord, subject, kind);
    }
    this.attach(mg, d);
  }

  private attach(mg: Game, d: Diplomacy): void {
    this.diplomacy = d;
    (mg as GameImpl).diplomacy = d;
  }

  tick(ticks: number): void {
    this.diplomacy?.tick(ticks);
  }

  isActive(): boolean {
    return this.diplomacy !== null;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return DiplomacyExecutionSnapshot.write({
      gameID: this.gameID,
      random: w.random(this.random),
      state: this.diplomacy?.state() ?? null,
    });
  }

  restoreSnapshot(s: DiplomacySnapshotState, r: SnapshotReader): void {
    this.gameID = s.gameID;
    this.random = r.random(s.random);
    this.diplomacy = null;
    const provinces = (r.game as GameImpl).provinces;
    if (s.state === null || provinces === undefined) return;
    const d = new Diplomacy(r.game, provinces, this.gameID, this.random);
    d.restore(s.state);
    this.attach(r.game, d);
  }
}

const pairs = () => z.tuple([zInt(), zInt()]).array();
const DiplomacySnapshotSchema = z.object({
  gameID: z.string(),
  random: zRandom(),
  state: z
    .object({
      subjects: z
        .object({
          overlord: zInt(),
          subject: zInt(),
          kind: z.enum(["vassal", "puppet"]),
        })
        .array(),
      aggression: pairs(),
      coalitions: z.tuple([zInt(), zInt().array()]).array(),
      core: pairs(),
      since: pairs(),
      startTiles: pairs(),
      formed: z.string().array(),
      wars: z.tuple([z.string(), zInt()]).array(),
    })
    .nullable(),
});
type DiplomacySnapshotState = z.infer<typeof DiplomacySnapshotSchema>;

export const DiplomacyExecutionSnapshot = execSnapshotType({
  name: "OverreachDiplomacy",
  version: 1,
  schema: DiplomacySnapshotSchema,
  cls: () => DiplomacyExecution,
});
