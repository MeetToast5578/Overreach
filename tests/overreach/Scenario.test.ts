import fs from "fs";
import path from "path";
import { NationExecution } from "../../src/core/execution/NationExecution";
import {
  Game,
  GameMapSize,
  GameMapType,
  PlayerInfo,
  PlayerType,
} from "../../src/core/game/Game";
import { GameImpl } from "../../src/core/game/GameImpl";
import {
  encodeOwners,
  forEachOwnedTile,
  Scenario,
  ScenarioSchema,
} from "../../src/core/overreach/Scenario";
import { ScenarioExecution } from "../../src/core/overreach/ScenarioExecution";
import { GameConfigSchema } from "../../src/core/Schemas";
import { createScriptedRunner, scriptedGameStart } from "../util/ScriptedGame";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

// Three nations in horizontal bands of a w×h map: y < h/3, y < 2h/3, the
// rest. The middle band's first quarter of columns is left unowned.
function bands(w: number, h: number): Scenario {
  return {
    version: 1,
    map: GameMapType.Earth,
    mapSize: GameMapSize.Normal,
    nations: [
      { id: "northland", name: "Northland", color: "#aa0000", flag: "fr" },
      { id: "midland1", name: "Midland", troops: 12_345, gold: 777 },
      { id: "southland", name: "Southland" },
    ],
    alliances: [[0, 2]],
    owners: encodeOwners(w * h, (t) => {
      const x = t % w;
      const y = Math.floor(t / w);
      if (y < h / 3) return 1;
      if (y < (2 * h) / 3) return x < w / 4 ? 0 : 2;
      return 3;
    }),
  };
}

function landIn(game: Game, band: (x: number, y: number) => boolean): number {
  let n = 0;
  for (let y = 0; y < game.height(); y++)
    for (let x = 0; x < game.width(); x++)
      if (band(x, y) && game.isLand(game.ref(x, y))) n++;
  return n;
}

async function scenarioGame(
  map: string,
  scenario: Scenario,
  humans: PlayerInfo[] = [],
  sandbox = false,
): Promise<Game> {
  const game = await setup(
    map,
    { scenario, nations: "disabled", bots: 0, sandbox },
    humans,
    undefined,
    undefined,
    false, // the scenario ends the spawn phase itself
  );
  game.addExecution(new ScenarioExecution("game_id"));
  return game;
}

describe("Scenario", () => {
  test("owner runs round-trip", () => {
    const owners = Array.from({ length: 500 }, (_, t) =>
      (t * 7) % 13 < 5 ? 0 : (t >> 6) + 1,
    );
    const runs = encodeOwners(owners.length, (t) => owners[t]);
    const back = new Array(owners.length).fill(0);
    expect(forEachOwnedTile(runs, (t, o) => (back[t] = o))).toBe(500);
    expect(back).toEqual(owners);
    expect(encodeOwners(6, (t) => (t < 3 ? 1 : t < 4 ? 0 : 2))).toEqual([
      1, 3, 0, 1, 2, 2,
    ]);
  });

  test("each nation gets exactly its land, and the spawn phase ends", async () => {
    // Half land (x < 8), half ocean: the ocean half of each band is skipped.
    const game = await scenarioGame("half_land_half_ocean", bands(16, 16));
    expect(game.inSpawnPhase()).toBe(true);
    game.executeNextTick();
    game.executeNextTick();
    expect(game.inSpawnPhase()).toBe(false);

    const [west, mid, east] = ["northland", "midland1", "southland"].map((id) =>
      game.player(id),
    );
    expect(west.numTilesOwned()).toBe(landIn(game, (x, y) => y < 16 / 3));
    expect(mid.numTilesOwned()).toBe(
      landIn(game, (x, y) => y >= 16 / 3 && y < 32 / 3 && x >= 4),
    );
    expect(east.numTilesOwned()).toBe(landIn(game, (x, y) => y >= 32 / 3));
    expect(mid.numTilesOwned()).toBeGreaterThan(0);
    expect(east.numTilesOwned()).toBeGreaterThan(0);

    expect(west.type()).toBe(PlayerType.Nation);
    expect(west.info().color).toBe("#aa0000");
    expect(west.info().nationFlag).toBe("fr");
    expect(mid.troops()).toBe(12_345);
    expect(mid.gold()).toBe(777n);
    expect(east.troops()).toBeGreaterThan(0);
    expect(west.isAlliedWith(east)).toBe(true);
    expect(west.isAlliedWith(mid)).toBe(false);
    // Each nation has its AI.
    const ai = (game as GameImpl)
      .executions()
      .filter((e) => e instanceof NationExecution);
    expect(ai).toHaveLength(3);
  });

  test("the human plays the picked nation, except in a sandbox", async () => {
    const me = () => new PlayerInfo("me", PlayerType.Human, "CLIENT01", "me");
    const nationAIs = (g: Game) =>
      (g as GameImpl).executions().filter((e) => e instanceof NationExecution);
    const scenario = { ...bands(16, 16), player: 1 };

    const game = await scenarioGame("half_land_half_ocean", scenario, [me()]);
    game.executeNextTick();
    game.executeNextTick();
    const human = game.player("me");
    expect(human.numTilesOwned()).toBe(
      landIn(game, (x, y) => y >= 16 / 3 && y < 32 / 3 && x >= 4),
    );
    expect(human.troops()).toBe(12_345);
    expect(human.gold()).toBe(777n);
    expect(game.hasPlayer("midland1")).toBe(false);
    expect(nationAIs(game)).toHaveLength(2);

    const sandbox = await scenarioGame(
      "half_land_half_ocean",
      scenario,
      [me()],
      true,
    );
    sandbox.executeNextTick();
    sandbox.executeNextTick();
    expect(sandbox.player("me").numTilesOwned()).toBe(0);
    expect(sandbox.player("midland1").numTilesOwned()).toBeGreaterThan(0);
    expect(nationAIs(sandbox)).toHaveLength(3);
  });

  test("a scenario for another map size places nothing", async () => {
    const game = await scenarioGame("plains", bands(16, 16));
    game.executeNextTick();
    game.executeNextTick();
    expect(game.players()).toHaveLength(0);
  });

  test("GameRunner starts a scenario game from its config", async () => {
    const runner = await createScriptedRunner(
      "plains",
      scriptedGameStart({
        scenario: bands(100, 100),
        gameMapSize: GameMapSize.Normal,
        nations: "disabled",
        bots: 0,
      }),
    );
    for (let turn = 0; turn < 3; turn++) {
      runner.addTurn({ turnNumber: turn, intents: [] });
      runner.executeNextTick();
    }
    expect(runner.game.inSpawnPhase()).toBe(false);
    expect(runner.game.player("northland").numTilesOwned()).toBe(
      landIn(runner.game, (x, y) => y < 100 / 3),
    );
  });

  test("snapshots taken before the first tick restore the scenario", async () => {
    const game = await scenarioGame("plains", bands(100, 100));
    await expectSnapshotRoundTrip(game, "plains", 5);
  });

  test("World 1836 is a valid scenario for the Earth map", () => {
    const res = path.join(__dirname, "../../resources");
    const read = (f: string) =>
      JSON.parse(fs.readFileSync(path.join(res, f), "utf8"));
    const s = ScenarioSchema.parse(read("scenarios/world-1836.json"));
    const { width, height } = read("maps/earth/manifest.json").map;
    expect(s.map).toBe(GameMapType.Earth);
    expect(forEachOwnedTile(s.owners, () => {})).toBe(width * height);
    expect(s.nations.length).toBeGreaterThan(150);
    for (const n of s.nations) {
      if (n.flag)
        expect(fs.existsSync(path.join(res, `flags/${n.flag}.svg`))).toBe(true);
    }
  });

  test("the config accepts a scenario and rejects bad ones", () => {
    const base = scriptedGameStart().config;
    const ok = GameConfigSchema.safeParse({ ...base, scenario: bands(4, 4) });
    expect(ok.success).toBe(true);
    const bad = [
      { ...bands(4, 4), owners: [1, -2] },
      { ...bands(4, 4), nations: [{ id: "x", name: "Short id" }] },
      { ...bands(4, 4), version: 2 },
    ];
    for (const scenario of bad) {
      expect(ScenarioSchema.safeParse(scenario).success).toBe(false);
    }
  });
});
