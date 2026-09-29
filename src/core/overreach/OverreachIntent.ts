import { z } from "zod";
import { zb } from "../../../zbin";
import type { Execution, Game, Player } from "../game/Game";
import type { GameImpl } from "../game/GameImpl";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zPlayerRef } from "../snapshot/SnapshotType";

// A player's own Overreach decisions in any game (sandbox or not), sent as one
// "overreach" intent and checked here, for the sender only: forming a nation
// (Formables.ts), answering an event (Events.ts).

export const OverreachActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("form"), id: z.string().max(20) }),
  z.object({
    kind: z.literal("event"),
    event: z.string().max(40),
    option: z.number().int().min(0).max(5),
  }),
]);
export type OverreachAction = z.infer<typeof OverreachActionSchema>;

export const OverreachIntentSchema = z.object({
  type: z.literal("overreach"),
  // zb.json: rare and varied, not worth a binary layout.
  action: zb.json(OverreachActionSchema),
});
export type OverreachIntent = z.infer<typeof OverreachIntentSchema>;

export class OverreachExecution implements Execution {
  private active = true;
  private mg: Game | undefined;

  constructor(
    private sender: Player,
    private action: OverreachAction,
  ) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    this.active = false;
    const g = this.mg as GameImpl;
    const a = this.action;
    switch (a.kind) {
      case "form":
        g.diplomacy?.form(this.sender, a.id);
        return;
      case "event":
        g.events?.answer(this.sender, a.event, a.option);
        return;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return OverreachExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      sender: w.player(this.sender),
      action: this.action,
    });
  }

  restoreSnapshot(s: OverreachState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.sender = r.player(s.sender);
    this.action = s.action;
  }
}

const OverreachStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  sender: zPlayerRef(),
  action: OverreachActionSchema,
});
type OverreachState = z.infer<typeof OverreachStateSchema>;

export const OverreachExecutionSnapshot = execSnapshotType({
  name: "OverreachAction",
  version: 1,
  schema: OverreachStateSchema,
  cls: () => OverreachExecution,
});
