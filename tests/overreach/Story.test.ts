import { Executor } from "../../src/core/execution/ExecutionManager";
import {
  Game,
  GameMapSize,
  GameMapType,
  Player,
  PlayerInfo,
  PlayerType,
  Relation,
} from "../../src/core/game/Game";
import { GameImpl } from "../../src/core/game/GameImpl";
import { TICKS_PER_YEAR } from "../../src/core/overreach/Calendar";
import { Diplomacy } from "../../src/core/overreach/Diplomacy";
import {
  grow,
  PAY_EVERY,
  payProvinces,
  PEOPLE_PER_GOLD,
} from "../../src/core/overreach/Economy";
import { Events, HistoricalEvent } from "../../src/core/overreach/Events";
import { OverreachExecution } from "../../src/core/overreach/OverreachIntent";
import { ProvinceRecord, Provinces } from "../../src/core/overreach/Provinces";
import { encodeOwners, Scenario } from "../../src/core/overreach/Scenario";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { IntentSchema } from "../../src/core/Schemas";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

function add(game: Game, id: string, type = PlayerType.Nation): Player {
  return game.addPlayer(new PlayerInfo(id, type, null, id));
}

function cols(game: Game, p: Player, x0: number, x1: number) {
  for (let x = x0; x < x1; x++)
    for (let y = 0; y < 100; y++) p.conquer(game.ref(x, y));
}

// Plains in ten 10-column provinces; provinces 1-5 are in "DEU", 6-10 in
// "FRA". Town populations of 1,000,000 each.
const countries = [
  "DEU",
  "DEU",
  "DEU",
  "DEU",
  "DEU",
  "FRA",
  "FRA",
  "FRA",
  "FRA",
  "FRA",
];
const scenario: Scenario = {
  version: 1,
  map: GameMapType.World,
  mapSize: GameMapSize.Normal,
  nations: [],
  alliances: [],
  owners: encodeOwners(10_000, () => 0),
  provinces: {
    names: countries.map((_, i) => `P${i + 1}`),
    capitals: countries.map(() => null),
    countries,
    home: encodeOwners(10_000, (t) => 1 + Math.floor((t % 100) / 10)),
  },
};

async function world(fill: (g: Game) => void) {
  const game = await setup("plains", { scenario });
  fill(game);
  const home = new Uint16Array(10_000);
  for (let t = 0; t < home.length; t++)
    home[t] = 1 + Math.floor(game.x(t) / 10);
  const records: (ProvinceRecord | null)[] = [null];
  for (let k = 1; k <= 10; k++) {
    records.push({
      name: `P${k}`,
      owner: 0,
      capital: null,
      population: 1_000_000,
    });
  }
  const provinces = new Provinces(game, home, records);
  (game as GameImpl).provinces = provinces;
  const d = new Diplomacy(game, provinces, "g", new PseudoRandom(3));
  d.start();
  (game as GameImpl).diplomacy = d;
  return { game, provinces, d };
}

describe("Economy", () => {
  test("provinces pay their owner by their people, half before they're core", async () => {
    let a!: Player;
    const { game, d } = await world((g) => {
      a = add(g, "payer");
      cols(g, a, 0, 20); // provinces 1 and 2
    });
    const before = a.gold();
    payProvinces(game);
    const full = BigInt((2_000_000 * PAY_EVERY) / PEOPLE_PER_GOLD);
    expect(a.gold() - before).toBe(full);
    d.core.set(2, 999); // province 2 isn't a's core
    const mid = a.gold();
    payProvinces(game);
    expect(a.gold() - mid).toBe(
      BigInt((1_500_000 * PAY_EVERY) / PEOPLE_PER_GOLD),
    );
  });

  test("towns grow a percent a year", async () => {
    const { game, provinces } = await world(() => {});
    grow(game);
    expect(provinces.records[1]!.population).toBe(1_010_000);
  });
});

describe("Formable nations", () => {
  test("holding 70% of the homeland lets a nation form it, once", async () => {
    let [a, b] = [] as Player[];
    const { game, d } = await world((g) => {
      a = add(g, "prussia1", PlayerType.Human);
      b = add(g, "saxony01");
      cols(g, a, 0, 30); // 3 of Germany's 5 provinces: 60%
      cols(g, b, 30, 40);
    });
    expect(d.formables(a)).toEqual([]);
    cols(game, a, 30, 35); // province 4 is a's too once most is held
    d.core.set(4, b.smallID());
    for (const p of [4]) (game as GameImpl).provinces!.transfer(p, a.smallID());
    expect(d.formables(a).map((f) => f.id)).toEqual(["germany"]);

    // As a human's intent, through the real executor.
    game.addPlayer(new PlayerInfo("me", PlayerType.Human, "CLIENT01", "me"));
    const intent = IntentSchema.parse({
      type: "overreach",
      action: { kind: "form", id: "germany" },
    });
    expect(
      new Executor(game, "g", "CLIENT01").createExec({
        ...intent,
        clientID: "CLIENT01",
      }),
    ).toBeInstanceOf(OverreachExecution);
    game.addExecution(
      new OverreachExecution(a, { kind: "form", id: "germany" }),
    );
    game.executeNextTick();
    // Saved and restored while it waits for its tick.
    const waiting = await roundTrip(game, "plains");
    expect(
      (waiting.restored as GameImpl)
        .executions()
        .some((e) => e instanceof OverreachExecution),
    ).toBe(true);
    game.executeNextTick();
    expect(a.name()).toBe("Germany");
    expect(a.info().nationFlag).toBe("German Empire");
    expect(d.formed.has("germany")).toBe(true);
    expect(d.core.get(4)).toBe(a.smallID());
    expect(d.formables(a)).toEqual([]);

    // The new name is in the PlayerInfo that snapshots store.
    const { restored } = await roundTrip(game, "plains");
    expect(restored.player("prussia1").name()).toBe("Germany");
  });

  test("the AI forms as soon as it can", async () => {
    let a!: Player;
    const { d } = await world((g) => {
      a = add(g, "piedmont");
      cols(g, a, 0, 40);
    });
    d.tick(600);
    expect(a.name()).toBe("Germany");
  });
});

describe("Events", () => {
  const events = (log: string[]): HistoricalEvent[] => [
    {
      id: "test_crisis",
      from: 1840,
      to: 1845,
      who: "crisis01",
      options: [
        { weight: 1, effect: (g, p) => log.push(`war:${p.id()}`) },
        { weight: 0, effect: (g, p) => log.push(`peace:${p.id()}`) },
      ],
    },
  ];
  const at = (year: number) => (year - 1836) * TICKS_PER_YEAR;

  test("the AI picks by weight, once, in its years", async () => {
    const game = await setup("plains");
    cols(game, add(game, "crisis01"), 0, 10);
    const log: string[] = [];
    const e = new Events(game, 1836, new PseudoRandom(1), events(log));
    e.tick(at(1839));
    expect(log).toEqual([]);
    e.tick(at(1840));
    e.tick(at(1841));
    expect(log).toEqual(["war:crisis01"]);
  });

  test("a human answers, or gets the first option after a minute", async () => {
    const game = await setup("plains");
    const me = add(game, "crisis01", PlayerType.Human);
    cols(game, me, 0, 10);
    const log: string[] = [];
    const e = new Events(game, 1836, new PseudoRandom(1), events(log));
    e.tick(at(1840));
    expect(e.pending.map((q) => q.event)).toEqual(["test_crisis"]);
    e.answer(me, "test_crisis", 1);
    expect(log).toEqual(["peace:crisis01"]);

    e.fired.clear();
    e.tick(at(1841));
    e.tick(at(1841) + 599);
    expect(log).toHaveLength(1);
    e.tick(at(1841) + 600);
    expect(log).toEqual(["peace:crisis01", "war:crisis01"]);
  });

  test("a human playing a scenario nation gets its events", async () => {
    const game = await setup("plains", {
      scenario: {
        ...scenario,
        nations: [{ id: "crisis01", name: "Crisis" }],
        player: 0,
      },
    });
    const me = add(game, "me", PlayerType.Human);
    cols(game, me, 0, 10);
    const e = new Events(game, 1836, new PseudoRandom(1), events([]));
    e.tick(at(1840));
    expect(e.pending).toEqual([
      { event: "test_crisis", player: me.smallID(), until: at(1840) + 600 },
    ]);
  });

  test("the Opium War: Qing bans the trade and Britain turns on it", async () => {
    const game = await setup("plains");
    const [qing, britain] = [add(game, "o1836QNG"), add(game, "o1836GBR")];
    cols(game, qing, 0, 20);
    cols(game, britain, 50, 60);
    const e = new Events(game, 1836, new PseudoRandom(2));
    // Fire it until the AI picks the ban (weight 3 of 4).
    for (let year = 1839; year <= 1842 && !e.fired.has("opium_war"); year++) {
      e.tick(at(year));
    }
    expect(e.fired.has("opium_war")).toBe(true);
    const war = britain.relation(qing) === Relation.Hostile;
    const paid = britain.gold() > qing.gold();
    expect(war || paid).toBe(true);
  });
});
