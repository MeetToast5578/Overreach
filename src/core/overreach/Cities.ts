import { type Game, type Player, UnitType } from "../game/Game";
import type { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { madeUpName, type Provinces } from "./Provinces";

// Named cities (Overreach, SANDBOX.md F5): OpenFront's City buildings with a
// name, population and founding tick. ProvinceExecution names each new City
// on its next tick:
// - on its province's capital, it takes the province's town name and people;
// - in its owner's province that has no capital, it becomes the capital;
// - anywhere else, it gets a made-up name.
// Taking a province's capital, and so its city, takes the province
// (Provinces' capital rule). A new city is founded with the usual build
// (gold in a normal game, free in the sandbox's Build tool).

export interface CityRecord {
  name: string;
  tile: TileRef;
  population: number;
  founded: number; // tick
}

export const FOUNDED_POPULATION = 5_000;

export class Cities {
  // By unit id.
  readonly records = new Map<number, CityRecord>();
  // Ids whose record is new or gone, for the client (ProvinceView). Not saved.
  clientChanges = new Set<number>();

  constructor(
    private game: Game,
    private provinces: Provinces,
  ) {}

  /** Names new cities and forgets destroyed ones. */
  sync(): void {
    const seen = new Set<number>();
    for (const u of this.game.units(UnitType.City)) {
      seen.add(u.id());
      if (this.records.has(u.id())) continue;
      this.records.set(u.id(), this.found(u.id(), u.tile()));
      this.clientChanges.add(u.id());
    }
    for (const id of [...this.records.keys()]) {
      if (seen.has(id)) continue;
      this.records.delete(id);
      this.clientChanges.add(id);
    }
  }

  private found(id: number, t: TileRef): CityRecord {
    const pv = this.provinces;
    const p = pv.home[t];
    const rec = pv.records[p];
    const founded = this.game.ticks();
    if (rec && rec.capital === null && rec.owner === this.game.ownerID(t)) {
      pv.setCapital(p, t);
    }
    if (rec && rec.capital === t) {
      const population = rec.population || FOUNDED_POPULATION;
      return { name: rec.name, tile: t, population, founded };
    }
    const name = madeUpName(new PseudoRandom(id * 7919 + t));
    return { name, tile: t, population: FOUNDED_POPULATION, founded };
  }
}

/** A finished City, free (a scenario nation's capital). */
export function placeCity(game: Game, owner: Player, tile: TileRef): void {
  owner.addGold(game.unitInfo(UnitType.City).cost(game, owner));
  owner.buildUnit(UnitType.City, tile, {});
}
