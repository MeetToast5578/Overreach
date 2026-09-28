import { Game, GameType, PlayerType, UnitType } from "../../src/core/game/Game";
import { GameRunner } from "../../src/core/GameRunner";
import { SandboxAction } from "../../src/core/overreach/Sandbox";
import { StampedIntent, Turn } from "../../src/core/Schemas";
import { snapshotGame } from "../../src/core/snapshot/GameSnapshot";
import {
  createScriptedRunner,
  SCRIPTED_HUMANS,
  scriptedGameStart,
} from "../util/ScriptedGame";
import { diffSnapshots } from "../util/Snapshot";

const START = scriptedGameStart({
  sandbox: true,
  gameType: GameType.Singleplayer, // 100-turn spawn phase
  nations: 8,
  bots: 10,
});
const HOST = SCRIPTED_HUMANS[0];
const NEW_ID = "replay01";
const END_TICK = 200;

function landNear(g: Game, x: number, y: number): number {
  for (let r = 0; r < 100; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (const dy of [-r, r]) {
        if (!g.isValidCoord(x + dx, y + dy)) continue;
        const t = g.ref(x + dx, y + dy);
        if (g.isLand(t) && !g.hasOwner(t) && !g.isImpassable(t)) return t;
      }
    }
  }
  throw new Error("no free land");
}

// The host's sandbox session: edits during the spawn phase, then orders sent
// as another nation, diplomacy and a free build once the game runs. Each step
// is a pure function of the game state, like a player reacting to the screen.
function sessionTurn(g: Game): Turn {
  const tick = g.ticks();
  const nations = g
    .players()
    .filter((p) => p.type() === PlayerType.Nation && p.id() !== NEW_ID)
    .sort((a, b) => a.id().localeCompare(b.id()));
  const [a, b] = nations;
  const actions: SandboxAction[] = [];
  const mine = g.hasPlayer(NEW_ID) ? g.player(NEW_ID) : null;
  switch (tick) {
    case 5:
      actions.push({
        kind: "create_nation",
        id: NEW_ID,
        tile: landNear(g, 520, 170),
        name: "Replayland",
        color: "#123456",
        flag: "fr",
      });
      break;
    case 20: {
      const s = mine!.spawnTile()!;
      const tiles: number[] = [];
      for (let dy = -6; dy <= 6; dy++)
        for (let dx = -6; dx <= 6; dx++)
          if (g.isValidCoord(g.x(s) + dx, g.y(s) + dy))
            tiles.push(g.ref(g.x(s) + dx, g.y(s) + dy));
      actions.push({ kind: "paint", tiles, owner: NEW_ID });
      break;
    }
    case 30:
      actions.push({ kind: "set_troops", player: NEW_ID, troops: 80_000 });
      break;
    case 110:
      actions.push({ kind: "set_ai", player: NEW_ID, on: false });
      actions.push({
        kind: "as",
        player: NEW_ID,
        intent: { type: "attack", targetID: null, troops: 20_000 },
      });
      break;
    case 120:
      actions.push({
        kind: "build",
        unit: UnitType.City,
        tile: mine!.spawnTile()!,
      });
      break;
    case 130:
      actions.push({
        kind: "war",
        attacker: a.id(),
        target: b.id(),
        ratio: 0.5,
      });
      break;
    case 150:
      actions.push({ kind: "peace", a: a.id(), b: b.id() });
      break;
    case 160:
      actions.push({ kind: "ally", a: a.id(), b: b.id() });
      break;
    case 170:
      actions.push({ kind: "set_gold", player: NEW_ID, gold: 1_000_000 });
      break;
  }
  const intents: StampedIntent[] = actions.map((action) => ({
    type: "sandbox",
    action,
    clientID: HOST,
  }));
  return { turnNumber: tick, intents };
}

function step(runner: GameRunner, turn: Turn) {
  runner.addTurn(turn);
  if (!runner.executeNextTick()) throw new Error(`tick ${turn.turnNumber}`);
}

describe("Sandbox replay", { timeout: 120_000 }, () => {
  test("a recorded sandbox session replays to the same state", async () => {
    const recorded: Turn[] = [];
    const live = await createScriptedRunner("world", START);
    while (live.game.ticks() < END_TICK) {
      const turn = sessionTurn(live.game);
      recorded.push(turn);
      step(live, turn);
    }

    // The session did what it says.
    const g = live.game;
    const mine = g.player(NEW_ID);
    expect(mine.info().color).toBe("#123456");
    expect(mine.units(UnitType.City)).toHaveLength(1);
    expect(mine.gold()).toBeGreaterThanOrEqual(1_000_000n);
    const [a, b] = g
      .players()
      .filter((p) => p.type() === PlayerType.Nation && p.id() !== NEW_ID)
      .sort((x, y) => x.id().localeCompare(y.id()));
    expect(a.isAlliedWith(b)).toBe(true);

    const replay = await createScriptedRunner("world", START);
    for (const turn of recorded) step(replay, turn);
    expect(diffSnapshots(snapshotGame(g), snapshotGame(replay.game))).toEqual(
      [],
    );
  });
});
