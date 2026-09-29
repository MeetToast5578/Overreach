import fs from "fs";
import path from "path";
import { AttackExecution } from "../../src/core/execution/AttackExecution";
import {
  Game,
  GameMapSize,
  GameMapType,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../src/core/game/Game";
import { GameImpl } from "../../src/core/game/GameImpl";
import { ProvinceExecution } from "../../src/core/overreach/ProvinceExecution";
import {
  generateProvinces,
  ProvinceRecord,
  Provinces,
} from "../../src/core/overreach/Provinces";
import {
  encodeOwners,
  Scenario,
  ScenarioSchema,
} from "../../src/core/overreach/Scenario";
import { PseudoRandom } from "../../src/core/PseudoRandom";
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

// Plains (100×100, all land) in ten provinces of ten columns each: province
// k+1 is x in [10k, 10k+10). A owns province 1, B province 2.
async function stripes() {
  const game = await setup("plains");
  const a = addPlayer(game, "a");
  const b = addPlayer(game, "b");
  fill(game, a, 0, 10);
  fill(game, b, 10, 20);
  const home = new Uint16Array(game.width() * game.height());
  for (let t = 0; t < home.length; t++)
    home[t] = Math.floor(game.x(t) / 10) + 1;
  const records: (ProvinceRecord | null)[] = [null];
  for (let k = 1; k <= 10; k++) {
    records.push({ name: `P${k}`, owner: 0, capital: null });
  }
  const provinces = new Provinces(game, home, records);
  (game as GameImpl).provinces = provinces;
  return { game, a, b, provinces };
}

async function startScenario(map: string, scenario: Scenario): Promise<Game> {
  const runner = await createScriptedRunner(
    map,
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
  return runner.game;
}

describe("Provinces", () => {
  test("owners are whoever holds each province; the rest are unowned", async () => {
    const { a, b, provinces } = await stripes();
    expect(provinces.records[1]!.owner).toBe(a.smallID());
    expect(provinces.records[2]!.owner).toBe(b.smallID());
    expect(provinces.records[3]!.owner).toBe(0);
    expect(provinces.violation()).toBeNull();
  });

  test("a conquered tile joins the conqueror's neighbouring province, a landing starts one", async () => {
    const { game, a, b, provinces } = await stripes();
    a.conquer(game.ref(10, 50));
    expect(provinces.province(game.ref(10, 50))).toBe(1);
    expect(provinces.heldBy(2, a.smallID())).toBe(1);

    a.conquer(game.ref(15, 5)); // surrounded by b
    const landing = provinces.province(game.ref(15, 5));
    expect(landing).toBeGreaterThan(10);
    expect(provinces.records[landing]).toEqual({
      name: "P2",
      owner: a.smallID(),
      capital: null,
    });
    // Its neighbour joins it; losing both ends the new province.
    a.conquer(game.ref(16, 5));
    expect(provinces.province(game.ref(16, 5))).toBe(landing);
    b.conquer(game.ref(15, 5));
    b.conquer(game.ref(16, 5));
    expect(provinces.records[landing]).toBeNull();
    expect(provinces.province(game.ref(15, 5))).toBe(2);
    expect(provinces.violation()).toBeNull();
  });

  test("a province flips whole when more than half is held", async () => {
    const { game, a, b, provinces } = await stripes();
    fill(game, a, 10, 15); // exactly half: no flip
    provinces.applyFlips();
    expect(provinces.records[2]!.owner).toBe(b.smallID());
    a.conquer(game.ref(15, 0));
    provinces.applyFlips();
    expect(provinces.records[2]!.owner).toBe(a.smallID());
    expect(b.numTilesOwned()).toBe(0);
    // The tiles a took first came home to province 2.
    expect(provinces.province(game.ref(10, 50))).toBe(2);
    expect(provinces.violation()).toBeNull();
  });

  test("a province flips whole when its capital falls", async () => {
    const { game, a, b, provinces } = await stripes();
    provinces.records[2]!.capital = game.ref(15, 50);
    a.conquer(game.ref(15, 50));
    expect(b.numTilesOwned()).toBe(999);
    provinces.applyFlips();
    expect(b.numTilesOwned()).toBe(0);
    expect(a.numTilesOwned()).toBe(2000);
    expect(provinces.violation()).toBeNull();
  });

  test("allies don't take each other's provinces", async () => {
    const { game, a, b, provinces } = await stripes();
    fill(game, a, 10, 16);
    a.createAllianceRequest(b)?.accept();
    provinces.applyFlips();
    expect(provinces.records[2]!.owner).toBe(b.smallID());
    expect(provinces.violation()).toBeNull();
  });

  test("an unowned province goes to the first to take a tile; abandoned, it goes to the holder", async () => {
    const { game, a, b, provinces } = await stripes();
    b.conquer(game.ref(35, 0));
    expect(provinces.records[4]!.owner).toBe(b.smallID());
    a.conquer(game.ref(36, 0));
    b.relinquish(game.ref(35, 0));
    provinces.applyFlips();
    expect(provinces.records[4]!.owner).toBe(a.smallID());
    expect(provinces.province(game.ref(36, 0))).toBe(4);
    a.relinquish(game.ref(36, 0));
    provinces.applyFlips();
    expect(provinces.records[4]!.owner).toBe(0);
    expect(provinces.violation()).toBeNull();
  });

  test("generated provinces cover the land and nothing else", async () => {
    const game = await setup("half_land_half_ocean");
    const { home, records } = generateProvinces(game, 42, 4);
    let land = 0;
    for (let t = 0; t < home.length; t++) {
      expect(home[t] !== 0).toBe(game.isLand(t));
      if (game.isLand(t)) land++;
    }
    const sizes = new Map<number, number>();
    for (const p of home) if (p) sizes.set(p, (sizes.get(p) ?? 0) + 1);
    expect(sizes.size).toBe(records.length - 1);
    expect(land / sizes.size).toBeGreaterThan(4);
    expect(records.every((r, i) => (i === 0) === (r === null))).toBe(true);
    expect(records[1]!.name).toMatch(/^[A-Z][a-z]+$/);
  });

  test("the owner rule holds through 10,000 turns of random fighting and painting", async () => {
    const game = await setup("plains");
    game.addExecution(new ProvinceExecution("fuzzgame"));
    game.executeNextTick();
    const players = ["a", "b", "c", "d"].map((id) => addPlayer(game, id));
    const rand = new PseudoRandom(7);
    const tile = () => game.ref(rand.nextInt(0, 100), rand.nextInt(0, 100));
    players.forEach((p, i) => fill(game, p, i * 25, i * 25 + 5));
    for (let turn = 0; turn < 10_000; turn++) {
      const p = players[rand.nextInt(0, 4)];
      const roll = rand.nextInt(0, 10);
      if (roll < 5) {
        // A paint stroke.
        const t0 = tile();
        for (let i = 0; i < 20; i++) {
          const t = t0 + i;
          if (t < 10_000 && game.ownerID(t) !== p.smallID()) p.conquer(t);
        }
      } else if (roll < 7) {
        for (const t of [...p.tiles()].slice(0, 10)) p.relinquish(t);
      } else {
        const q = players[rand.nextInt(0, 4)];
        p.setTroops(50_000);
        game.addExecution(
          new AttackExecution(20_000, p, q === p ? null : q.id()),
        );
      }
      game.executeNextTick();
      const broken = (game as GameImpl).provinces!.violation();
      if (broken !== null) throw new Error(`turn ${turn}: ${broken}`);
    }
  }, 120_000);

  test("a scenario's drawn provinces: names, capitals, owners", async () => {
    const game = await startScenario("plains", {
      version: 1,
      map: GameMapType.World,
      mapSize: GameMapSize.Normal,
      nations: [
        { id: "westland", name: "Westland" },
        { id: "eastland", name: "Eastland" },
      ],
      alliances: [],
      owners: encodeOwners(10_000, (t) => (t % 100 < 37 ? 1 : 2)),
      provinces: {
        names: ["West", "East"],
        // East's capital lies in West, so it is dropped.
        capitals: [10 * 100 + 10, 20 * 100 + 10],
        home: encodeOwners(10_000, (t) => (t % 100 < 50 ? 1 : 2)),
      },
    });
    const provinces = (game as GameImpl).provinces!;
    const west = game.player("westland").smallID();
    const east = game.player("eastland").smallID();
    expect(provinces.records.slice(1)).toEqual([
      { name: "West", owner: west, capital: 1010 },
      { name: "East", owner: east, capital: null },
    ]);
    // Eastland's strip of West counts in East.
    expect(provinces.province(game.ref(40, 5))).toBe(2);
    expect(provinces.violation()).toBeNull();
    expect(game.player("westland").numTilesOwned()).toBe(3700);
  });

  test("World 1836 starts with its provinces", async () => {
    const file = path.join(
      __dirname,
      "../../resources/scenarios/world-1836.json",
    );
    const scenario = ScenarioSchema.parse(
      JSON.parse(fs.readFileSync(file, "utf8")),
    );
    const game = await startScenario("world", scenario);
    const provinces = (game as GameImpl).provinces!;
    expect(provinces.violation()).toBeNull();
    expect(provinces.records.length).toBeGreaterThan(5000);
    const paris = provinces.records.find((r) => r?.name === "Paris")!;
    expect(paris.owner).toBe(game.player("o1836FRA").smallID());
    expect(game.ownerID(paris.capital!)).toBe(paris.owner);
  }, 60_000);

  test("snapshots keep the provinces", async () => {
    const game = await setup("plains");
    game.addExecution(new ProvinceExecution("snapgame"));
    game.executeNextTick();
    const [a, b] = ["a", "b"].map((id) => addPlayer(game, id));
    fill(game, a, 0, 30);
    fill(game, b, 30, 60);
    a.setTroops(100_000);
    game.addExecution(new AttackExecution(80_000, a, b.id()));
    for (let i = 0; i < 20; i++) game.executeNextTick();
    await expectSnapshotRoundTrip(game, "plains", 30);
  });

  test("games get provinces: generated, or drawn over a scenario's nations", async () => {
    const plain = await createScriptedRunner(
      "plains",
      scriptedGameStart({
        gameMapSize: GameMapSize.Normal,
        nations: "disabled",
        bots: 0,
      }),
    );
    plain.addTurn({ turnNumber: 0, intents: [] });
    plain.executeNextTick();
    expect((plain.game as GameImpl).provinces).toBeDefined();

    const runner = await createScriptedRunner(
      "plains",
      scriptedGameStart({
        gameMapSize: GameMapSize.Normal,
        nations: "disabled",
        bots: 0,
        scenario: {
          version: 1,
          map: GameMapType.World,
          mapSize: GameMapSize.Normal,
          nations: [
            { id: "westland", name: "Westland" },
            { id: "eastland", name: "Eastland" },
          ],
          alliances: [],
          owners: encodeOwners(10_000, (t) => (t % 100 < 37 ? 1 : 2)),
        },
      }),
    );
    for (let turn = 0; turn < 3; turn++) {
      runner.addTurn({ turnNumber: turn, intents: [] });
      runner.executeNextTick();
    }
    const provinces = (runner.game as GameImpl).provinces!;
    expect(provinces).toBeDefined();
    expect(provinces.violation()).toBeNull();
    // Placement is untouched: no province flipped at the start.
    expect(runner.game.player("westland").numTilesOwned()).toBe(3700);
  });
});
