import {
  Game,
  GameMapSize,
  GameMapType,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../src/core/game/Game";
import { GameImpl } from "../../src/core/game/GameImpl";
import { TICKS_PER_YEAR } from "../../src/core/overreach/Calendar";
import { Diplomacy } from "../../src/core/overreach/Diplomacy";
import { Endings, PEACE_YEARS } from "../../src/core/overreach/Endings";
import {
  generateProvinces,
  Provinces,
} from "../../src/core/overreach/Provinces";
import { encodeOwners, Scenario } from "../../src/core/overreach/Scenario";
import { ScenarioExecution } from "../../src/core/overreach/ScenarioExecution";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

function add(game: Game, id: string, type = PlayerType.Nation): Player {
  return game.addPlayer(new PlayerInfo(id, type, null, id));
}

function cols(game: Game, p: Player, x0: number, x1: number) {
  for (let x = x0; x < x1; x++)
    for (let y = 0; y < 100; y++) p.conquer(game.ref(x, y));
}

async function plains() {
  const game = await setup("plains");
  return { game, endings: new Endings(game, 1836) };
}

describe("Endings", () => {
  test("domination: 80% of the land, counting subjects", async () => {
    const { game, endings } = await plains();
    const [a, b] = [add(game, "empire"), add(game, "vassal")];
    cols(game, a, 0, 65);
    cols(game, b, 65, 80);
    expect(endings.check(60)).toBeNull();
    const { home, records } = generateProvinces(game, 1);
    const provinces = new Provinces(game, home, records);
    const d = new Diplomacy(game, provinces, "g", new PseudoRandom(1));
    (game as GameImpl).diplomacy = d;
    d.setSubject(a, b, "vassal");
    expect(endings.check(120)).toEqual({
      kind: "domination",
      winner: a.smallID(),
    });
  });

  test("monopoly: three quarters of a year's trade gold", async () => {
    const { game, endings } = await plains();
    const [a, b] = [add(game, "trader"), add(game, "other")];
    cols(game, a, 0, 10);
    cols(game, b, 10, 20);
    expect(endings.check(0)).toBeNull(); // the year's count starts
    a.addTradeGold(70n);
    b.addTradeGold(30n);
    expect(endings.check(TICKS_PER_YEAR)).toBeNull();
    a.addTradeGold(80n);
    b.addTradeGold(20n);
    expect(endings.check(2 * TICKS_PER_YEAR)).toEqual({
      kind: "monopoly",
      winner: a.smallID(),
    });
  });

  test("world peace: one web of alliances and ten years without war", async () => {
    const { game, endings } = await plains();
    const [a, b, c] = ["west", "middle", "east"].map((id) => add(game, id));
    cols(game, a, 0, 10);
    cols(game, b, 10, 20);
    cols(game, c, 20, 30);
    const tenYears = PEACE_YEARS * TICKS_PER_YEAR + 60;
    a.createAllianceRequest(b)?.accept();
    expect(endings.check(tenYears)).toBeNull(); // c is outside the web
    b.createAllianceRequest(c)?.accept();
    expect(endings.check(tenYears)).toEqual({ kind: "peace", winner: 0 });
  });

  test("nuclear winter: fallout on a tenth of the land", async () => {
    const { game, endings } = await plains();
    cols(game, add(game, "someone"), 0, 50);
    for (let t = 0; t < 999; t++) game.map().setFallout(t, true);
    expect(endings.check(60)).toBeNull();
    game.map().setFallout(999, true);
    expect(endings.check(120)).toEqual({ kind: "winter", winner: 0 });
  });

  test("survival: 2036 arrives; the human, if alive, is named", async () => {
    const { game, endings } = await plains();
    const big = add(game, "bignation");
    const me = add(game, "me", PlayerType.Human);
    cols(game, big, 0, 50);
    cols(game, me, 50, 55);
    expect(endings.check((2035 - 1836) * TICKS_PER_YEAR + 60)).toBeNull();
    expect(endings.check((2036 - 1836) * TICKS_PER_YEAR + 60)).toEqual({
      kind: "survival",
      winner: me.smallID(),
    });
  });

  test("a calendar game ends through CalendarExecution, and a snapshot keeps it", async () => {
    const scenario: Scenario = {
      version: 1,
      map: GameMapType.Earth,
      mapSize: GameMapSize.Normal,
      nations: [{ id: "oldworld", name: "Old World" }],
      alliances: [],
      owners: encodeOwners(10_000, (t) => (t % 100 < 50 ? 1 : 0)),
      startYear: 1836,
    };
    const game = await setup(
      "plains",
      { scenario, nations: "disabled", bots: 0 },
      [],
      undefined,
      undefined,
      false,
    );
    game.addExecution(new ScenarioExecution("game_id"));
    // On the unowned half, with room to spare: conquering clears fallout.
    for (let y = 50; y < 80; y++)
      for (let x = 50; x < 100; x++)
        game.map().setFallout(game.ref(x, y), true);
    for (let i = 0; i < 65; i++) game.executeNextTick();
    expect((game as GameImpl).ending).toEqual({ kind: "winter", winner: 0 });
    const restored = await expectSnapshotRoundTrip(game, "plains", 70);
    expect((restored as GameImpl).ending).toEqual({
      kind: "winter",
      winner: 0,
    });
  });
});
