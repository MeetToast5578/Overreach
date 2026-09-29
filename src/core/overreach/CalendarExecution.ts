import { z } from "zod";
import type { Execution, Game } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { lockEras } from "./Calendar";

// Runs a scenario's calendar (Calendar.ts): holds back units the eras
// haven't reached. ScenarioExecution adds it when the scenario has a start
// year.
export class CalendarExecution implements Execution {
  private mg: Game | null = null;

  init(mg: Game): void {
    this.mg = mg;
    lockEras(mg.config(), () => mg.ticks());
  }

  tick(): void {}

  isActive(): boolean {
    return true;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  snapshot(_w: SnapshotWriter): ExecRecord {
    return CalendarExecutionSnapshot.write({ initialized: this.mg !== null });
  }

  restoreSnapshot(s: CalendarState, r: SnapshotReader): void {
    this.mg = null;
    if (s.initialized) this.init(r.game);
  }
}

const CalendarStateSchema = z.object({ initialized: z.boolean() });
type CalendarState = z.infer<typeof CalendarStateSchema>;

export const CalendarExecutionSnapshot = execSnapshotType({
  name: "OverreachCalendar",
  version: 1,
  schema: CalendarStateSchema,
  cls: () => CalendarExecution,
});
