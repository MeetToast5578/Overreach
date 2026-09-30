import { GameMapSize, GameMapType } from "../../src/core/game/Game";
import { encodeOwners } from "../../src/core/overreach/Scenario";
import { createScriptedRunner, scriptedGameStart } from "../util/ScriptedGame";

// SANDBOX.md F6 (legacy/HANDOFF.md §2): "an alliance of nations must be able to
// beat a great power". A great power holding 55% of the land (more than both
// others together, 2.4× each) against two AI nations that split the rest,
// fought out by OpenFront's nation AI with provinces and diplomacy on.

const SEEDS = ["SEEDAAA1", "SEEDBBB2", "SEEDCCC3", "SEEDDDD4", "SEEDEEE5"];

// Whether the pair destroyed the great power within 3,000 ticks.
async function pairWins(seed: string, allied: boolean): Promise<boolean> {
  const start = scriptedGameStart({
    gameMapSize: GameMapSize.Normal,
    nations: "disabled",
    bots: 0,
    scenario: {
      version: 1,
      map: GameMapType.Earth,
      mapSize: GameMapSize.Normal,
      nations: [
        { id: "greatpow", name: "Great Power" },
        { id: "northally", name: "North" },
        { id: "southally", name: "South" },
      ],
      alliances: allied ? [[1, 2]] : [],
      owners: encodeOwners(10_000, (t) =>
        t % 100 < 55 ? 1 : t < 5_000 ? 2 : 3,
      ),
    },
  });
  start.gameID = seed;
  start.players = [];
  const runner = await createScriptedRunner("plains", start);
  const g = runner.game;
  for (let turn = 0; turn < 3000; turn++) {
    runner.addTurn({ turnNumber: turn, intents: [] });
    runner.executeNextTick();
    if (turn < 5) continue;
    const great = g.player("greatpow").numTilesOwned();
    const pair =
      g.player("northally").numTilesOwned() +
      g.player("southally").numTilesOwned();
    // Stop before one side owns the whole map (upstream name placement
    // can't handle a player with no border).
    if (great === 0 || pair === 0) return great === 0;
  }
  return false;
}

describe("Balance", () => {
  test("an allied pair beats a stronger nation in most seeds; unallied, it doesn't", async () => {
    const allied = await Promise.all(SEEDS.map((s) => pairWins(s, true)));
    const alone = await Promise.all(SEEDS.map((s) => pairWins(s, false)));
    expect(allied.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(alone.filter(Boolean).length).toBeLessThan(3);
  }, 300_000);
});
