import { AttackExecution } from "../../src/core/execution/AttackExecution";
import { Executor } from "../../src/core/execution/ExecutionManager";
import { NationExecution } from "../../src/core/execution/NationExecution";
import { NoOpExecution } from "../../src/core/execution/NoOpExecution";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import { TribeExecution } from "../../src/core/execution/TribeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { GameImpl } from "../../src/core/game/GameImpl";
import { PlayerImpl } from "../../src/core/game/PlayerImpl";
import { GameRunner } from "../../src/core/GameRunner";
import { DiplomacyExecution } from "../../src/core/overreach/DiplomacyExecution";
import { ProvinceExecution } from "../../src/core/overreach/ProvinceExecution";
import { SandboxAction } from "../../src/core/overreach/Sandbox";
import { SandboxExecution } from "../../src/core/overreach/SandboxExecution";
import { IntentSchema } from "../../src/core/Schemas";
import { authorizeIntent } from "../../src/server/IntentAuthorization";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip, roundTrip } from "../util/Snapshot";

const gameID = "game_id";
let game: Game;
let host: Player;

function playerOf(name: string): Player {
  game.addPlayer(new PlayerInfo(name, PlayerType.Human, null, name));
  return game.player(name);
}

// Queue an action and run the two ticks it takes to apply (init, then tick),
// plus `after` more for anything it starts (spawns, attacks, retreats).
function run(action: SandboxAction, after = 0) {
  game.addExecution(new SandboxExecution(gameID, host, action));
  for (let i = 0; i < 2 + after; i++) game.executeNextTick();
}

function block(x0: number, y0: number, size: number): number[] {
  const tiles: number[] = [];
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) tiles.push(game.ref(x, y));
  return tiles;
}

describe("Sandbox", () => {
  beforeEach(async () => {
    game = await setup("plains", { sandbox: true, instantBuild: true });
    host = playerOf("host");
  });

  test("does nothing outside a sandbox game", async () => {
    game = await setup("plains", {});
    host = playerOf("host");
    run({ kind: "paint", tiles: block(0, 0, 5), owner: "host" });
    expect(host.numTilesOwned()).toBe(0);
  });

  test("paint gives tiles to a player and makes an unspawned one alive", () => {
    run({ kind: "paint", tiles: block(10, 10, 5), owner: "host" });
    expect(host.numTilesOwned()).toBe(25);
    expect(host.hasSpawned()).toBe(true);
    expect(game.owner(game.ref(12, 12))).toBe(host);
  });

  test("paint with no owner clears tiles, and repaints take them over", () => {
    const red = playerOf("red");
    run({ kind: "paint", tiles: block(0, 0, 4), owner: "host" });
    run({ kind: "paint", tiles: block(2, 0, 2), owner: "red" });
    expect(host.numTilesOwned()).toBe(12);
    expect(red.numTilesOwned()).toBe(4);
    run({ kind: "paint", tiles: block(0, 0, 4), owner: null });
    expect(host.numTilesOwned()).toBe(0);
    expect(red.numTilesOwned()).toBe(0);
  });

  test("paint skips water and invalid refs", async () => {
    game = await setup("half_land_half_ocean", { sandbox: true });
    host = playerOf("host");
    // x=0-7 is land, x=8-15 ocean.
    run({
      kind: "paint",
      tiles: [...block(6, 0, 4), 999_999],
      owner: "host",
    });
    expect(host.numTilesOwned()).toBe(8);
  });

  test("create_nation spawns an AI nation at the tile", () => {
    const tile = game.ref(50, 50);
    run({ kind: "create_nation", id: "prussia1", tile, name: "Prussia" }, 3);
    const nation = game.players().find((p) => p.name() === "Prussia");
    expect(nation).toBeDefined();
    expect(nation!.type()).toBe(PlayerType.Nation);
    expect(nation!.numTilesOwned()).toBeGreaterThan(0);
    expect(nation!.id()).toBe("prussia1");

    // An id in use is ignored.
    run({ kind: "create_nation", id: "prussia1", tile, name: "Again" }, 3);
    expect(game.players().some((p) => p.name() === "Again")).toBe(false);
  });

  test("create_nation's colour and flag reach updates and snapshots", async () => {
    run(
      {
        kind: "create_nation",
        id: "lorraine",
        tile: game.ref(50, 50),
        name: "Lorraine",
        color: "#3366cc",
        flag: "fr",
      },
      3,
    );
    const nation = game.players().find((p) => p.name() === "Lorraine")!;
    expect(nation.info().color).toBe("#3366cc");
    expect(nation.info().nationFlag).toBe("fr");
    const update = (nation as PlayerImpl)["toFullUpdate"]();
    expect(update).toMatchObject({ color: "#3366cc", nationFlag: "fr" });
    const { restored } = await roundTrip(game, "plains");
    expect(restored.player(nation.id()).info().color).toBe("#3366cc");
  });

  test("delete_nation removes all its land", () => {
    run({ kind: "paint", tiles: block(0, 0, 6), owner: "host" });
    run({ kind: "delete_nation", player: "host" });
    expect(host.numTilesOwned()).toBe(0);
  });

  test("set_troops and set_gold set exact values", () => {
    run({ kind: "paint", tiles: block(0, 0, 3), owner: "host" });
    run({ kind: "set_troops", player: "host", troops: 12345 });
    expect(host.troops()).toBe(12345);
    run({ kind: "set_gold", player: "host", gold: 777 });
    expect(host.gold()).toBe(777n);
    run({ kind: "set_gold", player: "host", gold: 5 });
    expect(host.gold()).toBe(5n);
  });

  test("ally, then war breaks the alliance and attacks, then peace retreats", () => {
    const red = playerOf("red");
    run({ kind: "paint", tiles: block(0, 0, 10), owner: "host" });
    run({ kind: "paint", tiles: block(10, 0, 10), owner: "red" });
    run({ kind: "set_troops", player: "host", troops: 100_000 });

    run({ kind: "ally", a: "host", b: "red" });
    expect(host.isAlliedWith(red)).toBe(true);

    run({ kind: "war", attacker: "host", target: "red", ratio: 0.5 }, 1);
    expect(host.isAlliedWith(red)).toBe(false);
    expect(host.outgoingAttacks().some((a) => a.target() === red)).toBe(true);

    run({ kind: "peace", a: "red", b: "host" }, 60);
    expect(host.outgoingAttacks().some((a) => a.target() === red)).toBe(false);
  });

  test("war with no target expands into unclaimed land", () => {
    run({ kind: "paint", tiles: block(40, 40, 3), owner: "host" });
    run({ kind: "set_troops", player: "host", troops: 50_000 });
    run({ kind: "war", attacker: "host", target: null, ratio: 1 }, 30);
    expect(host.numTilesOwned()).toBeGreaterThan(9);
  });

  test("snapshots restore pending and in-flight sandbox actions", async () => {
    run({ kind: "paint", tiles: block(0, 0, 6), owner: "host" });
    const action: SandboxAction = {
      kind: "create_nation",
      id: "saxony01",
      tile: game.ref(60, 60),
      name: "Saxony",
    };
    game.addExecution(new SandboxExecution(gameID, host, action));
    await expectSnapshotRoundTrip(game, "plains", 0); // not yet initialized
    game.executeNextTick();
    await expectSnapshotRoundTrip(game, "plains", 10); // applies after restore
    expect(game.players().some((p) => p.name() === "Saxony")).toBe(true);
  });

  test("the sandbox intent parses and becomes a SandboxExecution", () => {
    const intent = IntentSchema.parse({
      type: "sandbox",
      action: { kind: "set_gold", player: "host", gold: 10 },
    });
    game.addPlayer(new PlayerInfo("me", PlayerType.Human, "CLIENT01", "me"));
    const exec = new Executor(game, gameID, "CLIENT01").createExec({
      ...intent,
      clientID: "CLIENT01",
    });
    expect(exec).toBeInstanceOf(SandboxExecution);
  });

  test("as runs a player's order for another player", () => {
    // Intents carry real player ids (8-10 letters and digits).
    const red = playerOf("redNation");
    run({ kind: "paint", tiles: block(0, 0, 10), owner: "host" });
    run({ kind: "paint", tiles: block(10, 0, 10), owner: red.id() });
    run({ kind: "set_troops", player: "host", troops: 50_000 });
    game.addPlayer(new PlayerInfo("me", PlayerType.Human, "CLIENT01", "me"));
    const exec = new Executor(game, gameID, "CLIENT01").createExec({
      type: "sandbox",
      action: {
        kind: "as",
        player: "host",
        intent: { type: "attack", targetID: red.id(), troops: 10_000 },
      },
      clientID: "CLIENT01",
    });
    expect(exec).toBeInstanceOf(AttackExecution);
    game.addExecution(exec);
    game.executeNextTick();
    game.executeNextTick();
    expect(host.outgoingAttacks().some((a) => a.target() === red)).toBe(true);
  });

  test("as refuses non-order intents, unknown players and non-sandbox games", async () => {
    game.addPlayer(new PlayerInfo("me", PlayerType.Human, "CLIENT01", "me"));
    const as = (player: string, intent: object) =>
      new Executor(game, gameID, "CLIENT01").createExec({
        type: "sandbox",
        action: { kind: "as", player, intent },
        clientID: "CLIENT01",
      } as never);
    const attack = { type: "attack", targetID: null, troops: 1 };
    expect(as("host", { type: "toggle_pause", paused: true })).toBeInstanceOf(
      NoOpExecution,
    );
    expect(as("host", { type: "attack", troops: "lots" })).toBeInstanceOf(
      NoOpExecution,
    );
    expect(as("nobody", attack)).toBeInstanceOf(NoOpExecution);
    expect(as("host", attack)).toBeInstanceOf(AttackExecution);

    game = await setup("plains", {});
    host = playerOf("host");
    game.addPlayer(new PlayerInfo("me", PlayerType.Human, "CLIENT01", "me"));
    expect(as("host", attack)).toBeInstanceOf(NoOpExecution);
  });

  test("build places a finished structure for free, by the usual rules", () => {
    run({ kind: "paint", tiles: block(20, 20, 20), owner: "host" });
    const cost = (u: UnitType) => game.unitInfo(u).cost(game, host);
    expect(host.gold()).toBeLessThan(cost(UnitType.City)); // can't afford one
    run({ kind: "build", unit: UnitType.City, tile: game.ref(30, 30) });
    const cities = host.units(UnitType.City);
    expect(cities).toHaveLength(1);
    expect(cities[0].isUnderConstruction()).toBe(false);

    // An inland port isn't built, and its cost isn't left behind.
    run({ kind: "build", unit: UnitType.Port, tile: game.ref(25, 25) });
    expect(host.units(UnitType.Port)).toHaveLength(0);
    expect(host.gold()).toBeLessThan(cost(UnitType.Port));
    // Nor is anything built on unclaimed land.
    run({ kind: "build", unit: UnitType.City, tile: game.ref(80, 80) });
    expect(game.units(UnitType.City)).toHaveLength(1);
  });

  test("set_ai turns a nation's and a tribe's AI off and on", () => {
    run(
      {
        kind: "create_nation",
        id: "bavaria1",
        tile: game.ref(50, 50),
        name: "Bavaria",
      },
      3,
    );
    const nation = game.players().find((p) => p.name() === "Bavaria")!;
    const tribeInfo = new PlayerInfo("Tribe", PlayerType.Bot, null, "tribe1");
    game.addExecution(new SpawnExecution(gameID, tribeInfo, game.ref(20, 80)));
    game.executeNextTick();
    game.executeNextTick();
    const tribe = game.player("tribe1");

    const aiOf = (p: Player) =>
      (game as GameImpl)
        .executions()
        .filter(
          (e) =>
            (e instanceof NationExecution &&
              e["nation"].playerInfo.id === p.id()) ||
            (e instanceof TribeExecution && e["tribe"] === p),
        ).length;
    expect(aiOf(nation)).toBe(1);
    expect(aiOf(tribe)).toBe(1);

    for (const p of [nation, tribe]) {
      run({ kind: "set_ai", player: p.id(), on: false });
      expect(aiOf(p)).toBe(0);
      run({ kind: "set_ai", player: p.id(), on: true });
      run({ kind: "set_ai", player: p.id(), on: true });
      expect(aiOf(p)).toBe(1);
    }
    run({ kind: "set_ai", player: "host", on: true });
    expect(aiOf(host)).toBe(0);
  });

  test("the intent schema rejects oversize or malformed actions", () => {
    const bad = [
      { kind: "paint", tiles: new Array(20_001).fill(0), owner: null },
      { kind: "create_nation", id: "abcd1234", tile: 1, name: "<script>" },
      { kind: "create_nation", id: "abc", tile: 1, name: "A" },
      {
        kind: "create_nation",
        id: "abcd1234",
        tile: 1,
        name: "A",
        flag: "../../x",
      },
      {
        kind: "create_nation",
        id: "abcd1234",
        tile: 1,
        name: "A",
        color: "red",
      },
      { kind: "war", attacker: "a", target: "b", ratio: 2 },
      { kind: "teleport" },
      { kind: "as", player: "a", intent: { type: "kick_player" } },
    ];
    for (const action of bad) {
      expect(IntentSchema.safeParse({ type: "sandbox", action }).success).toBe(
        false,
      );
    }
  });

  test("only the host of a private game may send sandbox intents", () => {
    const intent = {
      type: "sandbox" as const,
      action: { kind: "peace" as const, a: "x", b: "y" },
    };
    const lobby = {
      isPublic: false,
      isListed: false,
      isQueued: false,
      hasStarted: true,
    };
    const hostActor = {
      clientID: "HOST0001",
      isLobbyCreator: true,
      isAdmin: false,
      isAdminBot: false,
    };
    expect(authorizeIntent(intent, hostActor, lobby)).toBeNull();
    expect(
      authorizeIntent(intent, { ...hostActor, isLobbyCreator: false }, lobby),
    ).toMatchObject({ status: 403 });
    expect(
      authorizeIntent(intent, hostActor, { ...lobby, isPublic: true }),
    ).toMatchObject({ status: 403 });
  });

  test("province edits: create, split, rename, merge, capital", () => {
    game.addExecution(new ProvinceExecution(gameID));
    game.executeNextTick();
    run({ kind: "paint", tiles: block(0, 0, 20), owner: "host" });
    const provinces = (game as GameImpl).provinces!;
    run({ kind: "province_create", tiles: block(0, 0, 20), name: "Hostland" });
    const p = provinces.province(game.ref(5, 5));
    expect(provinces.records[p]).toEqual({
      name: "Hostland",
      owner: host.smallID(),
      capital: null,
      population: 0,
      growth: 1000,
    });
    run({
      kind: "province_split",
      province: p,
      a: game.ref(10, 0),
      b: game.ref(10, 19),
      name: "Easthold",
    });
    const east = provinces.province(game.ref(15, 5));
    expect(east).not.toBe(p);
    expect(provinces.homeSize(p) + provinces.homeSize(east)).toBe(400);
    run({ kind: "province_rename", province: east, name: "Eastmarch" });
    expect(provinces.records[east]!.name).toBe("Eastmarch");
    run({ kind: "province_capital", province: east, tile: game.ref(15, 5) });
    expect(provinces.records[east]!.capital).toBe(game.ref(15, 5));
    run({ kind: "province_merge", into: p, from: east });
    expect(provinces.homeSize(p)).toBe(400);
    expect(provinces.records[p]!.capital).toBe(game.ref(15, 5));
    expect(provinces.violation()).toBeNull();
  });

  test("diplomacy: a vassal and freeing it; a province seceding", () => {
    game.addExecution(
      new ProvinceExecution(gameID),
      new DiplomacyExecution(gameID),
    );
    game.executeNextTick();
    const other = playerOf("other");
    run({ kind: "paint", tiles: block(0, 0, 30), owner: "host" });
    run({ kind: "paint", tiles: block(50, 50, 30), owner: "other" });
    host.setTroops(1_000_000);
    other.setTroops(0);
    const d = (game as GameImpl).diplomacy!;
    run({
      kind: "subject",
      overlord: "host",
      subject: "other",
      type: "vassal",
    });
    expect(d.subjects).toEqual([
      { overlord: host.smallID(), subject: other.smallID(), kind: "vassal" },
    ]);
    expect(host.isAlliedWith(other)).toBe(true);
    run({ kind: "subject", overlord: "host", subject: "other", type: null });
    expect(d.subjects).toEqual([]);

    const provinces = (game as GameImpl).provinces!;
    const p = provinces.province(game.ref(5, 5));
    run({ kind: "secede", province: p });
    const rebel = game.players().find((x) => x.name().startsWith("Free "));
    expect(rebel).toBeDefined();
    expect(provinces.records[p]!.owner).toBe(rebel!.smallID());
    expect(provinces.violation()).toBeNull();
  });
});

describe("Sandbox spawn phase", () => {
  // Single-player normally waits in the spawn phase until the human spawns;
  // a sandbox ends it on the usual timer so the world runs without them.
  async function spawnPhaseAfterTimer(sandbox: boolean): Promise<boolean> {
    const g = await setup(
      "plains",
      { sandbox },
      [],
      undefined,
      undefined,
      false,
    );
    const runner = new GameRunner(
      g,
      new Executor(g, gameID, "CLIENT01"),
      () => {},
    );
    runner.init();
    for (let turn = 0; turn <= g.config().numSpawnPhaseTurns() + 1; turn++) {
      runner.addTurn({ turnNumber: turn, intents: [] });
      runner.executeNextTick();
    }
    return g.inSpawnPhase();
  }

  test("ends without the player spawning in a sandbox only", async () => {
    expect(await spawnPhaseAfterTimer(false)).toBe(true);
    expect(await spawnPhaseAfterTimer(true)).toBe(false);
  });
});
