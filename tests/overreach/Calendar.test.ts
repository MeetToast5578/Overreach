import {
  GameMapSize,
  GameMapType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import {
  dayOfYear,
  eraLocked,
  eraOf,
  lockEras,
  TICKS_PER_YEAR,
  yearAt,
} from "../../src/core/overreach/Calendar";
import { encodeOwners, Scenario } from "../../src/core/overreach/Scenario";
import { ScenarioExecution } from "../../src/core/overreach/ScenarioExecution";
import { GameConfig } from "../../src/core/Schemas";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";

const scenario: Scenario = {
  version: 1,
  map: GameMapType.Earth,
  mapSize: GameMapSize.Normal,
  nations: [{ id: "oldworld", name: "Old World" }],
  alliances: [],
  owners: encodeOwners(10_000, (t) => (t % 100 < 50 ? 1 : 0)),
  startYear: 1836,
};
const at = (year: number) => (year - 1836) * TICKS_PER_YEAR;

describe("Calendar", () => {
  test("dates and eras", () => {
    expect(yearAt(1836, 0)).toBe(1836);
    expect(yearAt(1836, TICKS_PER_YEAR * 14 - 1)).toBe(1849);
    expect(yearAt(1836, TICKS_PER_YEAR * 14)).toBe(1850);
    expect(dayOfYear(0)).toEqual({ month: 0, day: 1 });
    expect(dayOfYear(TICKS_PER_YEAR / 2)).toEqual({ month: 6, day: 2 }); // day 182
    expect(dayOfYear(TICKS_PER_YEAR - 1).month).toBe(11);
    expect(eraOf(1836)).toBe("industrial");
    expect(eraOf(1850)).toBe("railways");
    expect(eraOf(1944)).toBe("machine");
    expect(eraOf(2036)).toBe("atomic");
  });

  test("eras unlock units by year; a sandbox or a game without a calendar has them all", () => {
    const gc = { scenario } as GameConfig;
    expect(eraLocked(gc, 0, UnitType.AtomBomb)).toBe(true);
    expect(eraLocked(gc, at(1944), UnitType.MissileSilo)).toBe(true);
    expect(eraLocked(gc, at(1945), UnitType.MissileSilo)).toBe(false);
    expect(eraLocked(gc, at(1849), UnitType.Factory)).toBe(true);
    expect(eraLocked(gc, at(1850), UnitType.Factory)).toBe(false);
    expect(eraLocked(gc, 0, UnitType.City)).toBe(false);
    expect(eraLocked(gc, at(1969), UnitType.MIRV)).toBe(true);
    const sandbox = { scenario, sandbox: true } as GameConfig;
    expect(eraLocked(sandbox, 0, UnitType.AtomBomb)).toBe(false);
    expect(eraLocked({} as GameConfig, 0, UnitType.AtomBomb)).toBe(false);
  });

  test("a scenario game holds nukes back through its config, before and after a snapshot", async () => {
    const game = await setup(
      "plains",
      { scenario, nations: "disabled", bots: 0, instantBuild: true },
      [],
      undefined,
      undefined,
      false,
    );
    game.addExecution(new ScenarioExecution("game_id"));
    for (let i = 0; i < 3; i++) game.executeNextTick();
    expect(game.config().isUnitDisabled(UnitType.MissileSilo)).toBe(true);
    expect(game.config().isUnitDisabled(UnitType.City)).toBe(false);
    const p = game.player("oldworld");
    p.addGold(100_000_000n);
    expect(p.canBuild(UnitType.MissileSilo, game.ref(20, 20))).toBe(false);
    expect(p.canBuild(UnitType.City, game.ref(20, 20))).not.toBe(false);
    // The client's config gets the same lock from its own tick count.
    const later = game.config();
    lockEras(later, () => at(1950));
    expect(later.isUnitDisabled(UnitType.MissileSilo)).toBe(false);
    lockEras(later, () => game.ticks());

    const restored = await expectSnapshotRoundTrip(game, "plains", 5);
    expect(restored.config().isUnitDisabled(UnitType.MissileSilo)).toBe(true);
  });

  test("a game without a calendar locks nothing", async () => {
    const game = await setup("plains", {});
    game.addPlayer(new PlayerInfo("me", PlayerType.Human, null, "me"));
    expect(game.config().isUnitDisabled(UnitType.AtomBomb)).toBe(false);
  });
});
