import { z } from "zod";
import type { Execution, Game } from "../game/Game";
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
import { lockEras, startYear, TICKS_PER_YEAR } from "./Calendar";
import { grow, PAY_EVERY, payProvinces } from "./Economy";
import { Endings } from "./Endings";
import { Events } from "./Events";

// Runs a scenario's calendar (Calendar.ts): holds back units the eras
// haven't reached, runs the province economy (Economy.ts), and outside a
// sandbox fires historical events (Events.ts) and ends the game (Endings.ts).
// ScenarioExecution adds it when the scenario has a start year; GameRunner
// then leaves out OpenFront's own win check.
export class CalendarExecution implements Execution {
  private mg: Game | null = null;
  private endings: Endings | null = null;
  private events: Events | null = null;
  private random: PseudoRandom;

  constructor(private gameID: GameID) {
    this.random = new PseudoRandom(simpleHash(gameID) + 2036);
  }

  init(mg: Game): void {
    this.mg = mg;
    lockEras(mg.config(), () => mg.ticks());
    const gc = mg.config().gameConfig();
    const start = startYear(gc);
    const story = start !== null && gc.sandbox !== true;
    this.endings = story ? new Endings(mg, start) : null;
    this.events = story ? new Events(mg, start, this.random) : null;
    (mg as GameImpl).events = this.events ?? undefined;
  }

  tick(ticks: number): void {
    const g = this.mg as GameImpl;
    if (ticks % PAY_EVERY === 0) payProvinces(g);
    if (ticks > 0 && ticks % TICKS_PER_YEAR === 0) grow(g);
    if (!g.ending) this.events?.tick(ticks);
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

  snapshot(w: SnapshotWriter): ExecRecord {
    return CalendarExecutionSnapshot.write({
      gameID: this.gameID,
      random: w.random(this.random),
      fired: [...(this.events?.fired ?? [])],
      pending: (this.events?.pending ?? []).map((q) => ({ ...q })),
      initialized: this.mg !== null,
      lastWar: this.endings?.lastWar ?? 0,
      yearTrade: [...(this.endings?.yearTrade ?? [])],
      ending: (this.mg as GameImpl | null)?.ending ?? null,
    });
  }

  restoreSnapshot(s: CalendarState, r: SnapshotReader): void {
    this.mg = null;
    this.endings = null;
    this.events = null;
    this.gameID = s.gameID;
    this.random = r.random(s.random);
    if (!s.initialized) return;
    this.init(r.game);
    if (s.ending !== null) (r.game as GameImpl).ending = { ...s.ending };
    const events = this.events as Events | null; // set by init
    if (events !== null) {
      events.fired = new Set(s.fired);
      events.pending = s.pending.map((q) => ({ ...q }));
    }
    const endings = this.endings as Endings | null; // set by init
    if (endings === null) return;
    endings.lastWar = s.lastWar;
    endings.yearTrade = new Map(s.yearTrade);
  }
}

const CalendarStateSchema = z.object({
  gameID: z.string(),
  random: zRandom(),
  fired: z.string().array(),
  pending: z
    .object({ event: z.string(), player: zInt(), until: zInt() })
    .array(),
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
