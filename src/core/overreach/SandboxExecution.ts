import { z } from "zod";
import { AttackExecution } from "../execution/AttackExecution";
import { ConstructionExecution } from "../execution/ConstructionExecution";
import type { Executor } from "../execution/ExecutionManager";
import { NationExecution } from "../execution/NationExecution";
import { NoOpExecution } from "../execution/NoOpExecution";
import { PlayerExecution } from "../execution/PlayerExecution";
import { RetreatExecution } from "../execution/RetreatExecution";
import { SpawnExecution } from "../execution/SpawnExecution";
import { TribeExecution } from "../execution/TribeExecution";
import {
  Cell,
  Execution,
  Game,
  Nation,
  Player,
  PlayerID,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../game/Game";
import type { GameImpl } from "../game/GameImpl";
import { TileRef } from "../game/GameMap";
import { GameID, IntentSchema, StampedIntent } from "../Schemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zPlayerRef } from "../snapshot/SnapshotType";
import { assertNever } from "../Util";
import {
  SANDBOX_AS_TYPES,
  SandboxAction,
  SandboxActionSchema,
  SandboxIntent,
} from "./Sandbox";

// The Executor's "sandbox" case. An `as` action becomes its intent's
// execution for the named player, built now at intake; any other action
// becomes a SandboxExecution.
export function sandboxExec(
  executor: Executor,
  mg: Game,
  gameID: GameID,
  sender: Player,
  intent: SandboxIntent & StampedIntent,
): Execution {
  const a = intent.action;
  if (a.kind !== "as") return new SandboxExecution(gameID, sender, a);
  if (mg.config().gameConfig().sandbox !== true || !mg.hasPlayer(a.player)) {
    return new NoOpExecution();
  }
  const inner = IntentSchema.safeParse(a.intent);
  if (
    !inner.success ||
    !(SANDBOX_AS_TYPES as readonly string[]).includes(inner.data.type)
  ) {
    return new NoOpExecution();
  }
  return executor.createExec(
    { ...inner.data, clientID: intent.clientID },
    mg.player(a.player),
  );
}

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
        return this.createNation(a.id, a.tile, a.name, a.color, a.flag);
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
      case "build":
        return this.build(a.unit, a.tile);
      case "set_ai":
        return this.withPlayer(a.player, (p) => this.setAi(p, a.on));
      case "province_create":
        return void this.provinces()?.create(a.tiles, a.name);
      case "province_assign":
        return this.provinces()?.assign(a.tiles, a.province);
      case "province_split":
        return void this.provinces()?.split(a.province, a.a, a.b, a.name);
      case "province_merge":
        return this.provinces()?.merge(a.into, a.from);
      case "province_rename":
        return this.provinces()?.rename(a.province, a.name);
      case "province_capital":
        return this.provinces()?.setCapital(a.province, a.tile);
      case "subject":
        return this.withPair(a.overlord, a.subject, (x, y) =>
          (this.mg as GameImpl).diplomacy?.setSubject(x, y, a.type),
        );
      case "secede":
        return this.secede(a.province);
      case "as": // resolved at intake by sandboxExec
        return;
      default:
        assertNever(a);
    }
  }

  private provinces() {
    return (this.mg as GameImpl).provinces;
  }

  private secede(province: number): void {
    const owner = this.provinces()?.records[province]?.owner ?? 0;
    const from = this.mg.playerBySmallID(owner);
    if (from.isPlayer()) {
      (this.mg as GameImpl).diplomacy?.secede(from, [province], null);
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

  private createNation(
    id: PlayerID,
    tile: TileRef,
    name: string,
    color?: string,
    flag?: string,
  ): void {
    if (!this.mg.isValidRef(tile) || !this.mg.isLand(tile)) return;
    if (this.mg.isImpassable(tile) || this.mg.hasPlayer(id)) return;
    const info = new PlayerInfo(
      name,
      PlayerType.Nation,
      null,
      id,
      false,
      null,
      [],
      null,
      flag ?? null,
      color ?? null,
    );
    // The spawn cell keeps the nation near the click if this runs during the
    // spawn phase, when NationExecution re-places nations.
    const cell = new Cell(this.mg.x(tile), this.mg.y(tile));
    this.mg.addExecution(
      new SpawnExecution(this.gameID, info, tile),
      new NationExecution(this.gameID, new Nation(cell, info)),
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

  // Pays the cost for the owner, then runs the ordinary construction to
  // completion now, so the structure is free and instant but placed by the
  // usual rules. Refunds when it can't go there.
  private build(type: UnitType, tile: TileRef): void {
    if (!this.mg.isValidRef(tile)) return;
    const owner = this.mg.owner(tile);
    if (!owner.isPlayer()) return;
    const gold = owner.gold();
    owner.addGold(this.mg.unitInfo(type).cost(this.mg, owner));
    const construction = new ConstructionExecution(owner, type, tile);
    construction.init(this.mg, this.mg.ticks());
    while (construction.isActive()) construction.tick(this.mg.ticks());
    if (owner.gold() > gold) owner.removeGold(owner.gold() - gold);
  }

  // Off removes the player's AI execution; on adds a fresh one. Humans have none.
  private setAi(p: Player, on: boolean): void {
    // executions() and removeExecution() are on GameImpl, not the Game interface.
    const g = this.mg as GameImpl;
    const ai = g
      .executions()
      .filter(
        (e) =>
          (e instanceof NationExecution &&
            e["nation"].playerInfo.id === p.id()) ||
          (e instanceof TribeExecution && e["tribe"] === p),
      );
    if (!on) {
      ai.forEach((e) => g.removeExecution(e));
      return;
    }
    if (ai.length > 0) return;
    if (p.type() === PlayerType.Nation) {
      const t = p.spawnTile();
      const cell =
        t === undefined ? undefined : new Cell(this.mg.x(t), this.mg.y(t));
      this.mg.addExecution(
        new NationExecution(this.gameID, new Nation(cell, p.info())),
      );
    } else if (p.type() === PlayerType.Bot) {
      this.mg.addExecution(new TribeExecution(p));
    }
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
