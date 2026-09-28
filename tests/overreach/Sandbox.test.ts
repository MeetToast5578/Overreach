import { Executor } from "../../src/core/execution/ExecutionManager";
import { Game, Player, PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { GameRunner } from "../../src/core/GameRunner";
import { SandboxAction } from "../../src/core/overreach/Sandbox";
import { SandboxExecution } from "../../src/core/overreach/SandboxExecution";
import { IntentSchema } from "../../src/core/Schemas";
import { authorizeIntent } from "../../src/server/IntentAuthorization";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

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
    run({ kind: "create_nation", tile, name: "Prussia" }, 3);
    const nation = game.players().find((p) => p.name() === "Prussia");
    expect(nation).toBeDefined();
    expect(nation!.type()).toBe(PlayerType.Nation);
    expect(nation!.numTilesOwned()).toBeGreaterThan(0);
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

  test("the intent schema rejects oversize or malformed actions", () => {
    const bad = [
      { kind: "paint", tiles: new Array(20_001).fill(0), owner: null },
      { kind: "create_nation", tile: 1, name: "<script>" },
      { kind: "war", attacker: "a", target: "b", ratio: 2 },
      { kind: "teleport" },
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
