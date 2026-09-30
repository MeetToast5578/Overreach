import fs from "fs";
import path from "path";
import { PlayerExecution } from "../../src/core/execution/PlayerExecution";
import {
  Game,
  GameMapSize,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { GameImpl } from "../../src/core/game/GameImpl";
import {
  Cities,
  FOUNDED_POPULATION,
  placeCity,
} from "../../src/core/overreach/Cities";
import { ProvinceExecution } from "../../src/core/overreach/ProvinceExecution";
import { ProvinceRecord, Provinces } from "../../src/core/overreach/Provinces";
import { ScenarioSchema } from "../../src/core/overreach/Scenario";
import { createScriptedRunner, scriptedGameStart } from "../util/ScriptedGame";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

function addPlayer(game: Game, id: string): Player {
  return game.addPlayer(new PlayerInfo(id, PlayerType.Human, null, id));
}

function fill(game: Game, p: Player, x0: number, x1: number): void {
  for (let x = x0; x < x1; x++)
    for (let y = 0; y < game.height(); y++) p.conquer(game.ref(x, y));
}

// Plains in ten 10-column provinces (as in Provinces.test.ts). A holds x
// 0-29, B x 30-59. Province 2 has the town "Townsby" at (15, 50).
async function towns() {
  const game = await setup("plains", { instantBuild: true });
  const a = addPlayer(game, "a");
  const b = addPlayer(game, "b");
  fill(game, a, 0, 30);
  fill(game, b, 30, 60);
  const home = new Uint16Array(game.width() * game.height());
  for (let t = 0; t < home.length; t++)
    home[t] = Math.floor(game.x(t) / 10) + 1;
  const records: (ProvinceRecord | null)[] = [null];
  for (let k = 1; k <= 10; k++) {
    records.push({
      name: `P${k}`,
      owner: 0,
      capital: null,
      population: 0,
      growth: 1000,
    });
  }
  records[2] = {
    name: "Townsby",
    owner: 0,
    capital: game.ref(15, 50),
    population: 80_000,
    growth: 1000,
  };
  const provinces = new Provinces(game, home, records);
  const cities = new Cities(game, provinces);
  provinces.cities = cities;
  (game as GameImpl).provinces = provinces;
  const cityAt = (x: number, y: number) =>
    [...cities.records.values()].find((c) => c.tile === game.ref(x, y));
  return { game, a, b, provinces, cities, cityAt };
}

describe("Named cities", () => {
  test("a city on its province's capital takes the town's name and people", async () => {
    const { game, a, cities, cityAt } = await towns();
    placeCity(game, a, game.ref(15, 50));
    cities.sync();
    expect(cityAt(15, 50)).toEqual({
      name: "Townsby",
      tile: game.ref(15, 50),
      population: 80_000,
      founded: game.ticks(),
    });
  });

  test("a city in a province without a capital becomes it; another gets a made-up name", async () => {
    const { game, a, provinces, cities, cityAt } = await towns();
    placeCity(game, a, game.ref(5, 20));
    placeCity(game, a, game.ref(5, 60));
    cities.sync();
    expect(provinces.records[1]!.capital).toBe(game.ref(5, 20));
    expect(cityAt(5, 20)!.name).toBe("P1");
    const other = cityAt(5, 60)!;
    expect(other.name).toMatch(/^[A-Z][a-z]+$/);
    expect(other.name).not.toBe("P1");
    expect(other.population).toBe(FOUNDED_POPULATION);
  });

  test("a city on another nation's province doesn't become its capital", async () => {
    const { game, a, provinces, cities } = await towns();
    a.conquer(game.ref(35, 50)); // province 4 is B's
    placeCity(game, a, game.ref(35, 50));
    cities.sync();
    expect(provinces.records[4]!.capital).toBeNull();
  });

  test("destroyed cities are forgotten", async () => {
    const { game, a, cities } = await towns();
    placeCity(game, a, game.ref(15, 50));
    cities.sync();
    a.units(UnitType.City)[0].delete();
    cities.sync();
    expect(cities.records.size).toBe(0);
  });

  test("founding respects spacing", async () => {
    const { game, a } = await towns();
    placeCity(game, a, game.ref(15, 50));
    a.addGold(10_000_000n); // a second city costs more than the start
    const near = a.canBuild(UnitType.City, game.ref(18, 52));
    const d2 = (t: number) => game.euclideanDistSquared(t, game.ref(15, 50));
    expect(near === false || d2(near) >= 15 ** 2).toBe(true);
    const far = a.canBuild(UnitType.City, game.ref(5, 5));
    expect(far).not.toBe(false);
  });

  test("taking a province's capital city takes the province and the city", async () => {
    const { game, a, b, provinces, cities } = await towns();
    placeCity(game, b, game.ref(45, 50)); // province 5 (x 40-49) is B's
    cities.sync();
    expect(provinces.records[5]!.capital).toBe(game.ref(45, 50));
    game.addExecution(new PlayerExecution(a), new PlayerExecution(b));
    game.executeNextTick();
    a.conquer(game.ref(45, 50));
    game.executeNextTick(); // B's PlayerExecution hands the city over
    provinces.applyFlips();
    expect(provinces.records[5]!.owner).toBe(a.smallID());
    for (let y = 0; y < 100; y++) {
      expect(game.ownerID(game.ref(42, y))).toBe(a.smallID());
    }
    expect(a.units(UnitType.City)).toHaveLength(1);
    expect(provinces.violation()).toBeNull();
  });

  test("World 1836 starts with capital cities: Paris for France, St Petersburg for Russia", async () => {
    const file = path.join(
      __dirname,
      "../../resources/scenarios/world-1836.json",
    );
    const scenario = ScenarioSchema.parse(
      JSON.parse(fs.readFileSync(file, "utf8")),
    );
    const runner = await createScriptedRunner(
      "earth",
      scriptedGameStart({
        gameMapSize: GameMapSize.Normal,
        nations: "disabled",
        bots: 0,
        scenario,
      }),
    );
    for (let turn = 0; turn < 3; turn++) {
      runner.addTurn({ turnNumber: turn, intents: [] });
      runner.executeNextTick();
    }
    const game = runner.game;
    const cities = (game as GameImpl).provinces!.cities!;
    const cityOf = (id: string) => {
      const [u] = game.player(id).units(UnitType.City);
      return cities.records.get(u.id())!.name;
    };
    expect(cityOf("o1836FRA")).toBe("Paris");
    expect(cityOf("o1836RUS")).toBe("Saint Petersburg");
    expect(cityOf("o1836GBR")).toBe("London");
    expect(cities.records.size).toBeGreaterThan(150);
  }, 60_000);

  test("snapshots keep the cities", async () => {
    const game = await setup("plains", { instantBuild: true });
    game.addExecution(new ProvinceExecution("citygame"));
    game.executeNextTick();
    const a = addPlayer(game, "a");
    fill(game, a, 0, 50);
    placeCity(game, a, game.ref(20, 20));
    placeCity(game, a, game.ref(20, 60));
    game.executeNextTick();
    expect((game as GameImpl).provinces!.cities!.records.size).toBe(2);
    await expectSnapshotRoundTrip(game, "plains", 10);
  });
});
