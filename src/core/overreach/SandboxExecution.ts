import { z } from "zod";
import { AttackExecution } from "../execution/AttackExecution";
import { NationExecution } from "../execution/NationExecution";
import { PlayerExecution } from "../execution/PlayerExecution";
import { RetreatExecution } from "../execution/RetreatExecution";
import { SpawnExecution } from "../execution/SpawnExecution";
import {
  Execution,
  Game,
  Nation,
  Player,
  PlayerID,
  PlayerInfo,
  PlayerType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import type { GameID } from "../Schemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zPlayerRef } from "../snapshot/SnapshotType";
import { assertNever, simpleHash } from "../Util";
import { SandboxAction, SandboxActionSchema } from "./Sandbox";

// Applies one sandbox action. Work happens in tick(), not init(): executions
// added from init() are dropped by GameImpl.executeNextTick, and create_nation,
// war and peace add executions.
export class SandboxExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private gameID: GameID,
    private sender: Player,
    private action: SandboxAction,
  ) {}

  init(mg: Game): void {
    this.mg = mg;
    if (mg.config().gameConfig().sandbox !== true) {
      console.warn("SandboxExecution: sandbox intent outside a sandbox game");
      this.active = false;
    }
  }

  tick(): void {
    this.active = false;
    const a = this.action;
    switch (a.kind) {
      case "paint":
        return this.paint(a.tiles, a.owner);
      case "create_nation":
        return this.createNation(a.tile, a.name);
      case "delete_nation":
        return this.withPlayer(a.player, (p) => this.deleteNation(p));
      case "set_troops":
        return this.withPlayer(a.player, (p) => p.setTroops(a.troops));
      case "set_gold":
        return this.withPlayer(a.player, (p) => this.setGold(p, a.gold));
      case "war":
        return this.war(a.attacker, a.target, a.ratio);
      case "peace":
        return this.withPair(a.a, a.b, (x, y) => this.peace(x, y));
      case "ally":
        return this.withPair(a.a, a.b, (x, y) => this.ally(x, y));
      default:
        assertNever(a);
    }
  }

  private player(id: PlayerID): Player | null {
    return this.mg.hasPlayer(id) ? this.mg.player(id) : null;
  }

  private withPlayer(id: PlayerID, fn: (p: Player) => void): void {
    const p = this.player(id);
    if (p !== null) fn(p);
  }

  private withPair(
    a: PlayerID,
    b: PlayerID,
    fn: (x: Player, y: Player) => void,
  ): void {
    const x = this.player(a);
    const y = this.player(b);
    if (x !== null && y !== null && x !== y) fn(x, y);
  }

  private paint(tiles: TileRef[], ownerID: PlayerID | null): void {
    const owner = ownerID === null ? null : this.player(ownerID);
    if (ownerID !== null && owner === null) return;
    for (const t of tiles) {
      if (!this.mg.isValidRef(t) || !this.mg.isLand(t)) continue;
      if (this.mg.isImpassable(t)) continue;
      const current = this.mg.owner(t);
      if (owner === null) {
        if (current.isPlayer()) current.relinquish(t);
      } else if (current !== owner) {
        owner.conquer(t);
        // A player painted onto the map without spawning needs the per-player
        // execution (troop growth, death) that SpawnExecution would add.
        if (!owner.hasSpawned()) {
          owner.setSpawnTile(t);
          this.mg.addExecution(new PlayerExecution(owner));
        }
      }
    }
  }

  private createNation(tile: TileRef, name: string): void {
    if (!this.mg.isValidRef(tile) || !this.mg.isLand(tile)) return;
    if (this.mg.isImpassable(tile)) return;
    // Seeded from game, tick and tile so every client mints the same id,
    // in the same format as the map's nations (NationCreation).
    const random = new PseudoRandom(
      simpleHash(this.gameID) + this.mg.ticks() + tile,
    );
    let id = random.nextID();
    while (this.mg.hasPlayer(id)) id = random.nextID();
    const info = new PlayerInfo(name, PlayerType.Nation, null, id);
    this.mg.addExecution(
      new SpawnExecution(this.gameID, info, tile),
      new NationExecution(this.gameID, new Nation(undefined, info)),
    );
  }

  private deleteNation(p: Player): void {
    for (const u of p.units()) u.delete(false);
    for (const t of Array.from(p.tiles())) p.relinquish(t);
  }

  private setGold(p: Player, gold: number): void {
    const diff = BigInt(gold) - p.gold();
    if (diff > 0n) p.addGold(diff);
    else if (diff < 0n) p.removeGold(-diff);
  }

  private war(
    attackerID: PlayerID,
    targetID: PlayerID | null,
    ratio: number,
  ): void {
    const attacker = this.player(attackerID);
    if (attacker === null) return;
    // AttackExecution reads a null target as unclaimed land.
    let target: PlayerID | null = null;
    if (targetID !== null) {
      const defender = this.player(targetID);
      if (defender === null || defender === attacker) return;
      const alliance = attacker.allianceWith(defender);
      if (alliance !== null) attacker.breakAlliance(alliance);
      target = defender.id();
    }
    this.mg.addExecution(
      new AttackExecution(attacker.troops() * ratio, attacker, target),
    );
  }

  private peace(x: Player, y: Player): void {
    for (const [from, to] of [
      [x, y],
      [y, x],
    ]) {
      for (const atk of from.outgoingAttacks()) {
        if (atk.target() === to) {
          this.mg.addExecution(new RetreatExecution(from, atk.id()));
        }
      }
    }
  }

  private ally(x: Player, y: Player): void {
    if (x.isAlliedWith(y)) return;
    // Requests made here skip the intent-side cooldowns; accept at once.
    const pending = y
      .incomingAllianceRequests()
      .find((r) => r.requestor() === x);
    (pending ?? x.createAllianceRequest(y))?.accept();
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return SandboxExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      gameID: this.gameID,
      sender: w.player(this.sender),
      action: this.action,
    });
  }

  restoreSnapshot(s: SandboxState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.gameID = s.gameID;
    this.sender = r.player(s.sender);
    this.action = s.action;
  }
}

const SandboxStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  gameID: z.string(),
  sender: zPlayerRef(),
  action: SandboxActionSchema,
});
type SandboxState = z.infer<typeof SandboxStateSchema>;

export const SandboxExecutionSnapshot = execSnapshotType({
  name: "OverreachSandbox",
  version: 1,
  schema: SandboxStateSchema,
  cls: () => SandboxExecution,
});
