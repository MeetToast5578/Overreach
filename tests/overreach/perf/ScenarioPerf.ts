/**
 * Speed of a scenario start (F2): N nations that own all the land from the
 * first tick, which OpenFront's usual small spawns never reach.
 *
 *   npx tsx tests/overreach/perf/ScenarioPerf.ts [--map world] [--nations 250] [--ticks 600]
 *                                                [--write out.scenario.json]
 *                                                [--scenario resources/scenarios/world-1836.json]
 *
 * --scenario plays a real scenario file (its own map, nations, provinces and calendar) instead of
 * the flood fill.
 *
 * --write saves the scenario for the sandbox's "Load scenario" and exits.
 *
 * Nations grow from N random land tiles over land (4-neighbour flood fill), so
 * they are contiguous like real countries. Islands without a seed stay unowned.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../../../src/core/configuration/Config";
import { Executor } from "../../../src/core/execution/ExecutionManager";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../../src/core/game/Game";
import { createGame } from "../../../src/core/game/GameImpl";
import { GameMap } from "../../../src/core/game/GameMap";
import { loadTerrainMap } from "../../../src/core/game/TerrainMapLoader";
import { GameRunner } from "../../../src/core/GameRunner";
import {
  encodeOwners,
  Scenario,
  ScenarioSchema,
} from "../../../src/core/overreach/Scenario";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { GameConfig } from "../../../src/core/Schemas";
import { NodeGameMapLoader } from "../../perf/fullgame/NodeGameMapLoader";
import { TickStats } from "../../perf/fullgame/Profiler";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

export function voronoiScenario(
  map: GameMap,
  mapType: GameMapType,
  nations: number,
  seed = 1,
): Scenario {
  const size = map.width() * map.height();
  const owner = new Uint16Array(size);
  const random = new PseudoRandom(seed);
  const queue: number[] = [];
  for (let n = 1; n <= nations; ) {
    const t = random.nextInt(0, size);
    if (!map.isLand(t) || map.isImpassable(t) || owner[t] !== 0) continue;
    owner[t] = n++;
    queue.push(t);
  }
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    for (const nb of map.neighbors(t)) {
      if (owner[nb] === 0 && map.isLand(nb) && !map.isImpassable(nb)) {
        owner[nb] = owner[t];
        queue.push(nb);
      }
    }
  }
  return {
    version: 1,
    map: mapType,
    mapSize: GameMapSize.Normal,
    nations: Array.from({ length: nations }, (_, i) => ({
      id: `nat${String(i).padStart(5, "0")}`,
      name: `Nation ${i}`,
    })),
    alliances: [],
    owners: encodeOwners(size, (t) => owner[t]),
  };
}

async function main() {
  console.debug = () => {};
  const file = arg("scenario", "");
  const fromFile =
    file === ""
      ? undefined
      : ScenarioSchema.parse(
          JSON.parse(fs.readFileSync(path.resolve(file), "utf8")),
        );
  const mapName = fromFile?.map ?? arg("map", "world");
  const nations = parseInt(arg("nations", "250"), 10);
  const ticks = parseInt(arg("ticks", "600"), 10);
  const mapType = Object.values(GameMapType).find(
    (m) => m.toLowerCase() === mapName.toLowerCase(),
  )!;

  const loader = new NodeGameMapLoader(path.join(ROOT, "resources/maps"));
  const terrain = await loadTerrainMap(mapType, GameMapSize.Normal, loader);
  let t0 = performance.now();
  const scenario =
    fromFile ?? voronoiScenario(terrain.gameMap, mapType, nations);
  const json = JSON.stringify(scenario);
  const out = arg("write", "");
  if (out !== "") {
    fs.writeFileSync(out, json);
    console.log(`Wrote ${out}`);
    return;
  }
  console.log(
    `Scenario: ${nations} nations on ${mapType}, ${scenario.owners.length / 2} runs, ` +
      `${(json.length / 1024).toFixed(0)} KB JSON (built in ${(performance.now() - t0).toFixed(0)} ms)`,
  );

  const gameConfig: GameConfig = {
    gameMap: mapType,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty: Difficulty.Medium,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    scenario,
  };
  const config = new Config(gameConfig, null, false);
  const game = createGame(
    [],
    [],
    terrain.gameMap,
    terrain.miniGameMap,
    config,
    terrain.teamGameSpawnAreas,
  );
  let error: string | undefined;
  const runner = new GameRunner(
    game,
    new Executor(game, "perf", undefined),
    (gu) => {
      if ("errMsg" in gu) error = gu.errMsg;
    },
  );
  runner.init();

  let turn = 0;
  const step = () => {
    runner.addTurn({ turnNumber: turn++, intents: [] });
    if (!runner.executeNextTick() || error) throw new Error(error);
  };
  t0 = performance.now();
  while (game.inSpawnPhase()) step();
  const alive = game.players().filter((p) => p.isAlive()).length;
  const owned = game.players().reduce((a, p) => a + p.numTilesOwned(), 0);
  console.log(
    `Placed in ${(performance.now() - t0).toFixed(0)} ms (${turn} ticks): ` +
      `${alive} nations alive, ${owned} tiles owned`,
  );

  const stats = new TickStats();
  for (let i = 0; i < ticks; i++) {
    const tick = game.ticks();
    const s = performance.now();
    step();
    stats.record(tick, performance.now() - s);
  }
  const sum = stats.summarize(config.msPerTick());
  const f = (n: number) => n.toFixed(1);
  console.log(
    `${sum.count} ticks: mean ${f(sum.meanMs)} ms | p50 ${f(sum.p50Ms)} | p95 ${f(sum.p95Ms)} | ` +
      `p99 ${f(sum.p99Ms)} | max ${f(sum.maxMs)} | over the ${config.msPerTick()} ms budget: ${sum.overBudget}`,
  );
  console.log(
    `After: ${game.players().filter((p) => p.isAlive()).length} nations alive, ` +
      `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)} MB heap`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
