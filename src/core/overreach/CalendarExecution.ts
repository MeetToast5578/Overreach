import { z } from "zod";
import type { Execution, Game } from "../game/Game";
import type { GameImpl } from "../game/GameImpl";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zInt } from "../snapshot/SnapshotType";
import { lockEras, startYear } from "./Calendar";
import { Endings } from "./Endings";

// Runs a scenario's calendar (Calendar.ts): holds back units the eras
// haven't reached, and ends the game (Endings.ts) outside a sandbox.
// ScenarioExecution adds it when the scenario has a start year; GameRunner
// then leaves out OpenFront's own win check.
export class CalendarExecution implements Execution {
  private mg: Game | null = null;
  private endings: Endings | null = null;

  init(mg: Game): void {
    this.mg = mg;
    lockEras(mg.config(), () => mg.ticks());
    const gc = mg.config().gameConfig();
    const start = startYear(gc);
    this.endings =
      start !== null && gc.sandbox !== true ? new Endings(mg, start) : null;
  }

  tick(ticks: number): void {
    const g = this.mg as GameImpl;
    if (this.endings === null || g.ending || ticks % 60 !== 0) return;
    const ending = this.endings.check(ticks);
    if (ending === null) return;
    g.ending = ending;
    const winner = g.playerBySmallID(ending.winner);
    g.setWinner(winner.isPlayer() ? winner : null, g.stats().stats());
  }

  isActive(): boolean {
    return true;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  snapshot(_w: SnapshotWriter): ExecRecord {
    return CalendarExecutionSnapshot.write({
      initialized: this.mg !== null,
      lastWar: this.endings?.lastWar ?? 0,
      yearTrade: [...(this.endings?.yearTrade ?? [])],
      ending: (this.mg as GameImpl | null)?.ending ?? null,
    });
  }

  restoreSnapshot(s: CalendarState, r: SnapshotReader): void {
    this.mg = null;
    this.endings = null;
    if (!s.initialized) return;
    this.init(r.game);
    if (s.ending !== null) (r.game as GameImpl).ending = { ...s.ending };
    const endings = this.endings as Endings | null; // set by init
    if (endings === null) return;
    endings.lastWar = s.lastWar;
    endings.yearTrade = new Map(s.yearTrade);
  }
}

const CalendarStateSchema = z.object({
  initialized: z.boolean(),
  lastWar: zInt(),
  yearTrade: z.tuple([zInt(), z.bigint()]).array(),
  ending: z
    .object({
      kind: z.enum(["domination", "monopoly", "peace", "winter", "survival"]),
      winner: zInt(),
    })
    .nullable(),
});
type CalendarState = z.infer<typeof CalendarStateSchema>;

export const CalendarExecutionSnapshot = execSnapshotType({
  name: "OverreachCalendar",
  version: 1,
  schema: CalendarStateSchema,
  cls: () => CalendarExecution,
});
