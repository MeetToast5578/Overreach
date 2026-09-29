import { AttackExecution } from "../../src/core/execution/AttackExecution";
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
import {
  COALITION_TILES,
  Diplomacy,
  PEACE_TICKS,
  TRIBUTE,
} from "../../src/core/overreach/Diplomacy";
import { ProvinceRecord, Provinces } from "../../src/core/overreach/Provinces";
import { encodeOwners, Scenario } from "../../src/core/overreach/Scenario";
import { ScenarioExecution } from "../../src/core/overreach/ScenarioExecution";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

function nation(game: Game, id: string): Player {
  return game.addPlayer(new PlayerInfo(id, PlayerType.Nation, null, id));
}

function rect(game: Game, p: Player, x0: number, x1: number, y0 = 0, y1 = 100) {
  for (let x = x0; x < x1; x++)
    for (let y = y0; y < y1; y++) p.conquer(game.ref(x, y));
}

// Plains in 100 provinces of 10×10 tiles: province 1 + (x/10) + 10*(y/10).
// `calendar` gives the game a start year, which turns wars on.
async function world(owners: (game: Game) => void, calendar = false) {
  const game = await setup("plains", {
    instantBuild: true,
    ...(calendar ? { scenario: { startYear: 1836 } as Scenario } : {}),
  });
  owners(game);
  const home = new Uint16Array(10_000);
  for (let t = 0; t < home.length; t++) {
    home[t] = 1 + Math.floor(game.x(t) / 10) + 10 * Math.floor(game.y(t) / 10);
  }
  const records: (ProvinceRecord | null)[] = [null];
  for (let k = 1; k <= 100; k++) {
    records.push({ name: `P${k}`, owner: 0, capital: null, population: 0 });
  }
  const provinces = new Provinces(game, home, records);
  (game as GameImpl).provinces = provinces;
  const d = new Diplomacy(game, provinces, "dipgame", new PseudoRandom(5));
  d.start();
  (game as GameImpl).diplomacy = d;
  return { game, provinces, d };
}

describe("Diplomacy", () => {
  test("a vassal pays tribute and keeps a standing alliance; broken, the bond ends", async () => {
    let a!: Player;
    let b!: Player;
    const { d } = await world((g) => {
      a = nation(g, "overlord");
      b = nation(g, "vassal");
      rect(g, a, 0, 50);
      rect(g, b, 50, 60);
    });
    d.setSubject(a, b, "vassal");
    expect(a.isAlliedWith(b)).toBe(true);
    b.setTroops(0);
    const gold = a.gold();
    b.addGold(1_000_000n - b.gold());
    d.tick(100);
    expect(a.gold() - gold).toBe((1_000_000n * BigInt(TRIBUTE.vassal)) / 100n);
    expect(b.gold()).toBe(1_000_000n - (a.gold() - gold));

    b.breakAlliance(b.allianceWith(a)!);
    d.tick(10);
    expect(d.subjects).toEqual([]);
  });

  test("a strong vassal breaks free; a puppet never does", async () => {
    let [a, b, c] = [] as Player[];
    const { d } = await world((g) => {
      [a, b, c] = ["big", "vassal", "puppet"].map((id) => nation(g, id));
      rect(g, a, 0, 40);
      rect(g, b, 40, 60);
      rect(g, c, 60, 80);
    });
    // Both have half the overlord's land.
    d.setSubject(a, b, "vassal");
    d.setSubject(a, c, "puppet");
    d.tick(10);
    expect(d.subjects.map((s) => s.kind)).toEqual(["puppet"]);
    expect(a.isAlliedWith(b)).toBe(false);
    expect(b.relation(a)).toBe(Relation.Hostile);
    expect(a.isAlliedWith(c)).toBe(true);
  });

  test("taking many provinces turns the smaller neighbours into a coalition", async () => {
    let [x, b, c] = [] as Player[];
    const { provinces, d } = await world((g) => {
      [x, b, c] = ["aggressor", "north", "south"].map((id) => nation(g, id));
      rect(g, x, 0, 50);
      rect(g, b, 50, 100, 0, 50);
      rect(g, c, 50, 100, 50, 100);
    });
    // x takes 20 of b's 25 provinces and 11 of c's: 3,100 tiles.
    const taken = [6, 16, 26, 36].flatMap((r) => [
      r,
      r + 1,
      r + 2,
      r + 3,
      r + 4,
    ]);
    taken.push(56, 57, 58, 59, 60, 66, 67, 68, 69, 70, 76);
    for (const p of taken) provinces.transfer(p, x.smallID());
    expect(d.aggression.get(x.smallID())).toBeGreaterThanOrEqual(
      COALITION_TILES,
    );
    d.tick(300);
    expect(d.coalitions.get(x.smallID())?.sort()).toEqual(
      [b.smallID(), c.smallID()].sort(),
    );
    expect(b.isAlliedWith(c)).toBe(true);
    expect(b.relation(x)).toBe(Relation.Hostile);
    expect(b.targets()).toContain(x);
    expect(c.targets()).toContain(x);
  });

  test("a civil war splits off whole provinces", async () => {
    let x!: Player;
    const { game, provinces, d } = await world((g) => {
      x = nation(g, "empire");
      rect(g, x, 0, 10);
    });
    x.setSpawnTile(game.ref(5, 5));
    rect(game, x, 10, 60); // grew from 1,000 to 6,000 tiles
    const before = x.numTilesOwned();
    let rebel: Player | undefined;
    for (let k = 1; k <= 40 && !rebel; k++) {
      d.tick(600 * k);
      rebel = game.players().find((p) => p !== x);
    }
    expect(rebel).toBeDefined();
    expect(rebel!.name()).toMatch(/^Free P\d+$/);
    expect(x.numTilesOwned() + rebel!.numTilesOwned()).toBe(before);
    // Whole provinces: every tile of each of the rebel's provinces is its.
    const theirs = provinces.records.flatMap((r, p) =>
      r?.owner === rebel!.smallID() ? [p] : [],
    );
    expect(theirs.length).toBeGreaterThan(0);
    for (const p of theirs) {
      for (const t of provinces.tilesOf(p)) {
        expect(game.ownerID(t)).toBe(rebel!.smallID());
      }
    }
    expect(rebel!.numTilesOwned()).toBe(theirs.length * 100);
    expect(provinces.violation()).toBeNull();
  });

  test("conquered provinces revolt; a destroyed nation comes back", async () => {
    let [x, y] = [] as Player[];
    const { game, provinces, d } = await world((g) => {
      x = nation(g, "conqueror");
      y = nation(g, "victim");
      rect(g, x, 0, 30);
      rect(g, y, 30, 50);
    });
    for (let p = 1; p <= 100; p++) {
      if (provinces.records[p]!.owner === y.smallID()) {
        provinces.transfer(p, x.smallID());
      }
    }
    expect(y.isAlive()).toBe(false);
    let back: Player | undefined;
    for (let k = 1; k <= 40 && !back; k++) {
      d.tick(600 * k);
      back = game.players().find((p) => p.name() === "victim");
    }
    expect(back).toBeDefined();
    expect(back!.numTilesOwned()).toBe(2000);
    expect(provinces.violation()).toBeNull();
  });

  test("a scenario's subjects, kept through snapshots", async () => {
    const scenario: Scenario = {
      version: 1,
      map: GameMapType.World,
      mapSize: GameMapSize.Normal,
      nations: [
        { id: "overlord", name: "Overlord" },
        { id: "junior01", name: "Junior" },
      ],
      alliances: [],
      owners: encodeOwners(10_000, (t) => (t % 100 < 70 ? 1 : 2)),
      subjects: [[0, 1, "puppet"]],
    };
    const game = await setup(
      "plains",
      { scenario, nations: "disabled", bots: 0 },
      [],
      undefined,
      undefined,
      false, // the scenario ends the spawn phase itself
    );
    game.addExecution(new ScenarioExecution("game_id"));
    for (let i = 0; i < 4; i++) game.executeNextTick();
    const d = (game as GameImpl).diplomacy!;
    const [o, j] = ["overlord", "junior01"].map((id) => game.player(id));
    expect(d.subjects).toEqual([
      { overlord: o.smallID(), subject: j.smallID(), kind: "puppet" },
    ]);
    expect(o.isAlliedWith(j)).toBe(true);
    await expectSnapshotRoundTrip(game, "plains", 20);
  });

  test("with a calendar, the AI fights only its wars; an attack starts one and subjects join", async () => {
    let [a, b, c, v] = [] as Player[];
    const { game, d } = await world((g) => {
      [a, b, c, v] = ["attacker", "victim01", "bystand1", "subject1"].map(
        (id) => nation(g, id),
      );
      rect(g, a, 0, 30);
      rect(g, b, 30, 60);
      rect(g, c, 60, 90);
      rect(g, v, 90, 100);
    }, true);
    d.setSubject(a, v, "puppet");
    expect(d.mayAttack(a, b)).toBe(false);
    expect(d.mayAttack(a, game.terraNullius())).toBe(true);
    a.setTroops(100_000);
    game.addExecution(new AttackExecution(10_000, a, b.id()));
    game.executeNextTick();
    game.executeNextTick();
    d.tick(10);
    expect(d.atWar(a, b)).toBe(true);
    expect(d.atWar(v, b)).toBe(true); // the subject joined
    expect(d.mayAttack(b, a)).toBe(true);
    expect(d.mayAttack(c, b)).toBe(false);
    // An ally may join its ally's war.
    c.createAllianceRequest(a)?.accept();
    expect(d.mayAttack(c, b)).toBe(true);
    // Three quiet years end it.
    for (const at of a.outgoingAttacks()) at.delete();
    d.tick(10 + PEACE_TICKS);
    expect(d.atWar(a, b)).toBe(false);
  });

  test("with a calendar, each year an AI nation may declare war on its weakest neighbour", async () => {
    let [a, b, c] = [] as Player[];
    const { d } = await world((g) => {
      [a, b, c] = ["strongly", "weakling", "middling"].map((id) =>
        nation(g, id),
      );
      rect(g, a, 0, 40);
      rect(g, b, 40, 50, 0, 50);
      rect(g, c, 40, 50, 50, 100);
    }, true);
    a.setTroops(100_000);
    b.setTroops(10_000);
    c.setTroops(50_000);
    for (let year = 1; year <= 20 && !d.atWar(a, b); year++) {
      d.tick(year * TICKS_PER_YEAR);
    }
    expect(d.atWar(a, b)).toBe(true);
    expect(d.atWar(a, c)).toBe(false);
  });

  test("without a calendar there are no wars to keep", async () => {
    let [a, b] = [] as Player[];
    const { d } = await world((g) => {
      [a, b] = ["attacker", "victim01"].map((id) => nation(g, id));
      rect(g, a, 0, 50);
      rect(g, b, 50, 100);
    });
    expect(d.mayAttack(a, b)).toBe(true);
  });
});
