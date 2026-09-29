import { z } from "zod";
import { NationExecution } from "../execution/NationExecution";
import { PlayerExecution } from "../execution/PlayerExecution";
import {
  Cell,
  Execution,
  Game,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
} from "../game/Game";
import type { GameID } from "../Schemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { placeCity } from "./Cities";
import { ProvinceExecution } from "./ProvinceExecution";
import { forEachOwnedTile } from "./Scenario";

// Places GameConfig.scenario on the first tick: its nations, their tiles
// (through conquer(), the ownership choke point) and alliances, then ends the
// spawn phase. Nations get the AI; the sandbox can take one over.
export class ScenarioExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(private gameID: GameID) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    this.active = false;
    const g = this.mg;
    const s = g.config().gameConfig().scenario;
    if (s === undefined) return;

    let covered = 0;
    for (let i = 1; i < s.owners.length; i += 2) covered += s.owners[i];
    if (covered !== g.width() * g.height()) {
      console.warn(
        `scenario covers ${covered} tiles, the map has more or less`,
      );
      return;
    }

    const human =
      s.player !== undefined && g.config().gameConfig().sandbox !== true
        ? g.allPlayers().find((p) => p.type() === PlayerType.Human)
        : undefined;
    const players: (Player | null)[] = s.nations.map((n, i) =>
      human !== undefined && i === s.player
        ? human
        : g.hasPlayer(n.id)
          ? null
          : g.addPlayer(
              new PlayerInfo(
                n.name,
                PlayerType.Nation,
                null,
                n.id,
                false,
                null,
                [],
                null,
                n.flag ?? null,
                n.color ?? null,
              ),
            ),
    );
    forEachOwnedTile(s.owners, (tile, owner) => {
      const p = players[owner - 1];
      if (p && g.isLand(tile) && !g.isImpassable(tile)) p.conquer(tile);
    });

    s.nations.forEach((n, i) => {
      const p = players[i];
      if (!p || p.numTilesOwned() === 0) return;
      const first = p.tiles().values().next().value!;
      p.setSpawnTile(first);
      p.setTroops(n.troops ?? Math.floor(g.config().maxTroops(p) / 2));
      if (n.gold !== undefined) {
        const diff = BigInt(n.gold) - p.gold();
        if (diff > 0n) p.addGold(diff);
        else if (diff < 0n) p.removeGold(-diff);
      }
      const c = n.capital;
      if (c !== undefined && g.isValidRef(c) && g.ownerID(c) === p.smallID()) {
        placeCity(g, p, c);
      }
      g.addExecution(new PlayerExecution(p));
      if (p === human) return;
      g.addExecution(
        new NationExecution(
          this.gameID,
          new Nation(new Cell(g.x(first), g.y(first)), p.info()),
        ),
      );
    });

    for (const [a, b] of s.alliances) {
      const x = players[a];
      const y = players[b];
      if (x && y && x !== y && !x.isAlliedWith(y)) {
        x.createAllianceRequest(y)?.accept();
      }
    }
    g.endSpawnPhase();
    if (g.config().gameConfig().provinces !== false) {
      g.addExecution(new ProvinceExecution(this.gameID));
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  snapshot(_w: SnapshotWriter): ExecRecord {
    return ScenarioExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      gameID: this.gameID,
    });
  }

  restoreSnapshot(s: ScenarioState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.gameID = s.gameID;
  }
}

const ScenarioStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  gameID: z.string(),
});
type ScenarioState = z.infer<typeof ScenarioStateSchema>;

export const ScenarioExecutionSnapshot = execSnapshotType({
  name: "OverreachScenario",
  version: 1,
  schema: ScenarioStateSchema,
  cls: () => ScenarioExecution,
});
