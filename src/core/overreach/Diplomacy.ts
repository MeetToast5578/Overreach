import { NationExecution } from "../execution/NationExecution";
import { PlayerExecution } from "../execution/PlayerExecution";
import {
  Cell,
  type Game,
  Nation,
  type Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import type { GameID } from "../Schemas";
import { startYear, TICKS_PER_YEAR } from "./Calendar";
import { formableBy, homelands, renamePlayer } from "./Formables";
import type { Provinces } from "./Provinces";

// Diplomacy additions (Overreach, SANDBOX.md F6), on top of OpenFront's
// alliances, targets and relations, which its nation AI already acts on:
// - Subjects: a vassal or puppet keeps a standing alliance with its overlord
//   (so neither attacks the other, and the AI's "assist" joins the other's
//   wars) and pays tribute. A vassal breaks free once its land reaches
//   LIBERTY of its overlord's (land, not troops, which swing with every
//   attack); a puppet never does. Breaking the alliance ends the bond.
// - Coalitions: taking other nations' provinces builds aggression, their
//   tiles, which fades. Past COALITION_TILES, the aggressor's smaller AI
//   neighbours ally with each other, turn hostile and target it until it
//   calms down. (On World 1836's small provinces, one point per province made
//   every border war a coalition.)
// - Cores, revolts and civil wars: a province becomes its owner's core after
//   CORE_TICKS. An AI nation whose non-core provinces pass REVOLT_SHARE may
//   see a group of them, taken from one nation, revolt back to it (or, if it
//   is gone, to a revived one). An AI nation grown past twice its start and
//   CIVIL_WAR_SHARE of the land may split: its provinces farthest from its
//   capital secede as a new nation.
// - Wars, in a game with a calendar (Calendar.ts): the nation AI attacks
//   only nations it, or an ally, is at war with (plus unclaimed land and
//   tribes; one hook in AiAttackBehavior.shouldAttack). Any attack starts or
//   feeds a war, and the attacker's subjects join it; coalitions and events
//   declare wars; each year an AI nation may, with a WAR_CHANCE, declare war
//   on its weakest non-friendly neighbour with fewer troops. A war with no
//   fighting for PEACE_TICKS ends. Humans may attack anyone, which is a war.
// Everything runs on DiplomacyExecution's tick, deterministically.

export type SubjectKind = "vassal" | "puppet";

export interface Subject {
  overlord: number; // small ids
  subject: number;
  kind: SubjectKind;
}

export const TRIBUTE = { vassal: 10, puppet: 25 }; // % of gold, per payment
export const LIBERTY = 0.5;
export const COALITION_TILES = 3000; // tiles taken, fading
export const CORE_TICKS = 6000; // ten minutes
export const REVOLT_SHARE = 0.3;
export const CIVIL_WAR_SHARE = 0.15;
export const WAR_CHANCE = 4; // one in four, a year
export const PEACE_TICKS = 3 * TICKS_PER_YEAR;

const UPKEEP_EVERY = 10;
const TRIBUTE_EVERY = 100;
const COALITION_EVERY = 300;
const UNREST_EVERY = 600;

export interface DiplomacyState {
  subjects: Subject[];
  aggression: [number, number][];
  coalitions: [number, number[]][];
  core: [number, number][];
  since: [number, number][];
  startTiles: [number, number][];
  formed: string[];
  wars: [string, number][];
}

export class Diplomacy {
  subjects: Subject[] = [];
  // Small id -> tiles of provinces taken from other nations, fading.
  aggression = new Map<number, number>();
  // Target small id -> member small ids.
  coalitions = new Map<number, number[]>();
  // Per province: the owner it counts as home for (none yet: its owner),
  // and the tick its owner last changed.
  core = new Map<number, number>();
  since = new Map<number, number>();
  startTiles = new Map<number, number>();
  // Formable nations already formed (Formables.ts).
  formed = new Set<string>();
  // "a:b" (small ids, a < b) -> the tick they last fought. Calendar games.
  wars = new Map<string, number>();
  // Set while secession moves provinces, so it doesn't count as aggression.
  private seceding = false;

  constructor(
    private game: Game,
    private provinces: Provinces,
    private gameID: GameID,
    private random: PseudoRandom,
  ) {
    provinces.onOwnerChange = (p, from, to) => this.ownerChanged(p, from, to);
  }

  /** A new game: cores are today's owners; sizes are the start. */
  start(): void {
    this.provinces.records.forEach((rec, p) => {
      if (rec?.owner) this.core.set(p, rec.owner);
    });
    for (const p of this.game.players()) {
      this.startTiles.set(p.smallID(), p.numTilesOwned());
    }
  }

  tick(ticks: number): void {
    if (ticks % UPKEEP_EVERY === 0) this.keepSubjects();
    if (ticks % TRIBUTE_EVERY === 0) this.payTribute();
    if (ticks % COALITION_EVERY === 0) this.updateCoalitions();
    if (ticks % UNREST_EVERY === 0) {
      this.unrest(ticks);
      this.formNations();
    }
    if (this.calendar() && ticks % UPKEEP_EVERY === 0) this.fight(ticks);
    if (this.calendar() && ticks > 0 && ticks % TICKS_PER_YEAR === 0) {
      this.declareWars();
    }
  }

  // ---- Wars (calendar games)

  private calendar(): boolean {
    return startYear(this.game.config().gameConfig()) !== null;
  }

  private static key(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  atWar(a: Player, b: Player): boolean {
    return this.wars.has(Diplomacy.key(a.smallID(), b.smallID()));
  }

  /** Whether the nation AI may attack `target` (AiAttackBehavior). */
  mayAttack(attacker: Player, target: Player | { isPlayer(): false }): boolean {
    if (!this.calendar() || !target.isPlayer()) return true;
    if (attacker.type() !== PlayerType.Nation) return true;
    if (target.type() === PlayerType.Bot) return true;
    return (
      this.atWar(attacker, target) ||
      attacker.allies().some((a) => this.atWar(a, target))
    );
  }

  /** a and b are at war (again); a's subjects join. */
  declareWar(a: Player, b: Player): void {
    if (a === b) return;
    this.wars.set(Diplomacy.key(a.smallID(), b.smallID()), this.game.ticks());
    for (const s of this.subjects) {
      if (s.overlord !== a.smallID() || s.subject === b.smallID()) continue;
      this.wars.set(Diplomacy.key(s.subject, b.smallID()), this.game.ticks());
    }
  }

  // Attacks start or feed wars; quiet wars end.
  private fight(ticks: number): void {
    for (const p of this.game.players()) {
      for (const a of p.outgoingAttacks()) {
        const t = a.target();
        if (!t.isPlayer()) continue;
        const k = Diplomacy.key(p.smallID(), t.smallID());
        if (this.wars.has(k)) this.wars.set(k, ticks);
        else this.declareWar(p, t);
      }
    }
    for (const [k, last] of [...this.wars]) {
      const [a, b] = k.split(":").map(Number);
      const alive = [a, b].every((id) => {
        const p = this.game.playerBySmallID(id);
        return p.isPlayer() && p.isAlive();
      });
      if (!alive || ticks - last >= PEACE_TICKS) this.wars.delete(k);
    }
  }

  // Each AI nation may go to war with its weakest neighbour.
  private declareWars(): void {
    for (const p of this.game.players()) {
      if (p.type() !== PlayerType.Nation || this.subjectOf(p.smallID())) {
        continue;
      }
      if (!this.random.chance(WAR_CHANCE)) continue;
      const prey = p
        .nearby()
        .filter(
          (n): n is Player =>
            n.isPlayer() &&
            n.type() !== PlayerType.Bot &&
            !p.isFriendly(n) &&
            !this.atWar(p, n) &&
            n.troops() < p.troops() * 0.8,
        )
        .sort((a, b) => a.troops() - b.troops() || a.smallID() - b.smallID());
      if (prey.length > 0) {
        this.declareWar(p, prey[0]);
        p.updateRelation(prey[0], -100);
      }
    }
  }

  // ---- Subjects

  subjectOf(p: number): Subject | undefined {
    return this.subjects.find((s) => s.subject === p);
  }

  /** Makes `subject` overlord's vassal or puppet (null frees it). */
  setSubject(overlord: Player, subject: Player, kind: SubjectKind | null) {
    this.subjects = this.subjects.filter(
      (s) => s.subject !== subject.smallID(),
    );
    if (kind === null || overlord === subject) return;
    // No subject of a subject's own subject, so no loops.
    if (this.subjectOf(overlord.smallID())?.overlord === subject.smallID()) {
      return;
    }
    this.subjects.push({
      overlord: overlord.smallID(),
      subject: subject.smallID(),
      kind,
    });
    if (!overlord.isAlliedWith(subject)) {
      overlord.createAllianceRequest(subject)?.accept();
    }
  }

  private keepSubjects(): void {
    const g = this.game;
    this.subjects = this.subjects.filter((s) => {
      const o = g.playerBySmallID(s.overlord);
      const v = g.playerBySmallID(s.subject);
      if (!o.isPlayer() || !v.isPlayer() || !o.isAlive() || !v.isAlive()) {
        return false;
      }
      const alliance = o.allianceWith(v);
      if (alliance === null) return false; // broken: independence
      if (alliance.expiresAt() - g.ticks() < 10 * UPKEEP_EVERY) {
        alliance.extend();
      }
      o.updateRelation(v, 5);
      v.updateRelation(o, 5);
      const strong = v.numTilesOwned() >= o.numTilesOwned() * LIBERTY;
      if (s.kind === "vassal" && strong) {
        alliance.expire();
        v.updateRelation(o, -100);
        return false;
      }
      return true;
    });
  }

  private payTribute(): void {
    for (const s of this.subjects) {
      const o = this.game.playerBySmallID(s.overlord);
      const v = this.game.playerBySmallID(s.subject);
      if (!o.isPlayer() || !v.isPlayer()) continue;
      const due = (v.gold() * BigInt(TRIBUTE[s.kind])) / 100n;
      if (due > 0n) o.addGold(v.removeGold(due));
    }
  }

  // ---- Aggression and coalitions

  private ownerChanged(p: number, from: number, to: number): void {
    this.since.set(p, this.game.ticks());
    if (!this.core.has(p) && to !== 0) this.core.set(p, to);
    // Taking back your own core isn't aggression.
    if (from === 0 || to === 0 || this.seceding || this.core.get(p) === to) {
      return;
    }
    const subject = this.subjectOf(from);
    if (subject?.overlord === to || this.subjectOf(to)?.overlord === from) {
      return;
    }
    const tiles = this.provinces.homeSize(p);
    this.aggression.set(to, (this.aggression.get(to) ?? 0) + tiles);
  }

  private updateCoalitions(): void {
    const g = this.game;
    for (const [x, members] of [...this.coalitions]) {
      const target = g.playerBySmallID(x);
      if (
        !target.isPlayer() ||
        !target.isAlive() ||
        (this.aggression.get(x) ?? 0) < COALITION_TILES / 2
      ) {
        this.coalitions.delete(x);
        continue;
      }
      this.coalitions.set(x, this.rally(target, members));
    }
    for (const [x, ae] of this.aggression) {
      if (ae < COALITION_TILES || this.coalitions.has(x)) continue;
      const target = g.playerBySmallID(x);
      if (!target.isPlayer()) continue;
      const members = this.rally(target, []);
      if (members.length >= 2) this.coalitions.set(x, members);
    }
    // Aggression fades by a tenth each time.
    for (const [x, ae] of [...this.aggression]) {
      const left = ae - Math.ceil(ae / 10);
      if (left <= 0) this.aggression.delete(x);
      else this.aggression.set(x, left);
    }
  }

  // The coalition against `target`: its members and any new smaller AI
  // neighbours, allied with each other, hostile to and targeting it.
  private rally(target: Player, members: number[]): number[] {
    const g = this.game;
    const ids = new Set(members);
    for (const n of target.nearby()) {
      if (!n.isPlayer() || n.type() !== PlayerType.Nation) continue;
      if (n.isFriendly(target) || n.numTilesOwned() >= target.numTilesOwned())
        continue;
      ids.add(n.smallID());
    }
    const all = [...ids]
      .map((id) => g.playerBySmallID(id))
      .filter((p): p is Player => p.isPlayer() && p.isAlive());
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (!all[i].isAlliedWith(all[j])) {
          all[i].createAllianceRequest(all[j])?.accept();
        }
      }
    }
    for (const m of all) {
      m.updateRelation(target, -100);
      if (m.canTarget(target)) m.target(target);
      if (this.calendar()) this.declareWar(m, target);
    }
    return all.map((p) => p.smallID());
  }

  // ---- Cores, revolts and civil wars

  private unrest(ticks: number): void {
    const pv = this.provinces;
    const owned = new Map<number, number[]>();
    pv.records.forEach((rec, p) => {
      if (!rec || rec.owner === 0) return;
      const core = this.core.get(p) ?? rec.owner;
      if (
        rec.owner !== core &&
        ticks - (this.since.get(p) ?? 0) >= CORE_TICKS
      ) {
        this.core.set(p, rec.owner);
      }
      const list = owned.get(rec.owner) ?? [];
      list.push(p);
      owned.set(rec.owner, list);
    });
    const land = this.game.numLandTiles();
    for (const [id, provinces] of owned) {
      const x = this.game.playerBySmallID(id);
      if (!x.isPlayer() || x.type() !== PlayerType.Nation || !x.isAlive()) {
        continue;
      }
      if (this.subjectOf(id)?.kind === "puppet") continue;
      const foreign = provinces.filter((p) => (this.core.get(p) ?? id) !== id);
      if (
        foreign.length >= 3 &&
        foreign.length >= provinces.length * REVOLT_SHARE &&
        this.random.chance(4)
      ) {
        this.revolt(x, foreign);
        continue;
      }
      const start = this.startTiles.get(id) ?? 0;
      if (
        x.numTilesOwned() > Math.max(land * CIVIL_WAR_SHARE, 2 * start) &&
        provinces.length >= 4 &&
        this.random.chance(4)
      ) {
        this.civilWar(x, provinces);
      }
    }
  }

  // The biggest group taken from one nation goes back to it, or to a new
  // nation in its name if it's gone.
  private revolt(x: Player, foreign: number[]): void {
    const byCore = new Map<number, number[]>();
    for (const p of foreign) {
      const core = this.core.get(p)!;
      byCore.set(core, [...(byCore.get(core) ?? []), p]);
    }
    const [core, group] = [...byCore].sort(
      (a, b) => b[1].length - a[1].length || a[0] - b[0],
    )[0];
    if (group.length < 3) return;
    const old = this.game.playerBySmallID(core);
    if (old.isPlayer() && old.isAlive() && !old.isFriendly(x)) {
      this.move(group, old, x);
      return;
    }
    this.secede(x, group, old.isPlayer() ? old : null);
  }

  // Its provinces farthest from its capital (the ~40% furthest) secede.
  private civilWar(x: Player, provinces: number[]): void {
    const g = this.game;
    const capital = x.units(UnitType.City)[0]?.tile() ?? x.spawnTile() ?? null;
    if (capital === null) return;
    const far = (p: number) => {
      const c =
        this.provinces.records[p]!.capital ??
        this.provinces.tilesOf(p).next().value;
      return c === undefined ? 0 : g.manhattanDist(c, capital);
    };
    const sorted = [...provinces].sort((a, b) => far(b) - far(a) || a - b);
    this.secede(x, sorted.slice(0, Math.floor(sorted.length * 0.4)), null);
  }

  /**
   * Provinces of `from` break away as a new nation, hostile to it: named
   * after `revive` if given (a nation that was destroyed), else after the
   * biggest province. It takes a matching share of `from`'s troops.
   */
  secede(from: Player, ids: number[], revive: Player | null): Player | null {
    const g = this.game;
    const pv = this.provinces;
    if (ids.length === 0) return null;
    const biggest = [...ids].sort(
      (a, b) => pv.homeSize(b) - pv.homeSize(a) || a - b,
    )[0];
    const name = revive?.name() ?? `Free ${pv.records[biggest]!.name}`;
    const info = new PlayerInfo(
      name.slice(0, 40),
      PlayerType.Nation,
      null,
      this.random.nextID(),
      false,
      null,
      [],
      null,
      revive?.info().nationFlag ?? null,
      revive?.info().color ?? null,
    );
    const rebel = g.addPlayer(info);
    const before = from.numTilesOwned();
    this.move(ids, rebel, from);
    const tiles = rebel.numTilesOwned();
    if (tiles === 0) return rebel;
    const troops = Math.floor((from.troops() * tiles) / Math.max(1, before));
    rebel.setTroops(from.removeTroops(troops));
    const first = rebel.tiles().values().next().value!;
    rebel.setSpawnTile(first);
    g.addExecution(
      new PlayerExecution(rebel),
      new NationExecution(
        this.gameID,
        new Nation(new Cell(g.x(first), g.y(first)), rebel.info()),
      ),
    );
    rebel.updateRelation(from, -100);
    from.updateRelation(rebel, -100);
    rebel.target(from);
    return rebel;
  }

  /** Every province of `from` becomes `to`'s core, peacefully. */
  annex(to: Player, from: Player): void {
    const ids = this.provinces.records.flatMap((r, p) =>
      r?.owner === from.smallID() ? [p] : [],
    );
    this.move(ids, to, from);
    for (const p of ids) this.core.set(p, to.smallID());
  }

  private move(ids: number[], to: Player, from: Player): void {
    this.seceding = true;
    for (const p of ids) {
      if (this.provinces.records[p]?.owner === from.smallID()) {
        this.provinces.transfer(p, to.smallID());
      }
    }
    this.seceding = false;
  }

  // ---- Formable nations

  /** The formables `p` may form now. */
  formables(p: Player) {
    const pv = this.provinces;
    return formableBy(
      this.game.config().gameConfig(),
      this.formed,
      p.smallID(),
      (q) => pv.records[q]?.owner ?? 0,
      (q) => pv.homeSize(q),
      p.numTilesOwned(),
    );
  }

  /** Forms formable `id` as `p` if it may; the homeland it holds is core. */
  form(p: Player, id: string): boolean {
    const f = this.formables(p).find((x) => x.id === id);
    if (f === undefined) return false;
    renamePlayer(p, f.name, f.flag, f.color);
    this.formed.add(id);
    const lands = homelands(this.game.config().gameConfig()).get(id) ?? [];
    for (const q of lands) {
      if (this.provinces.records[q]?.owner === p.smallID()) {
        this.core.set(q, p.smallID());
      }
    }
    return true;
  }

  // The AI forms what it can.
  private formNations(): void {
    for (const p of this.game.players()) {
      if (p.type() !== PlayerType.Nation) continue;
      const f = this.formables(p)[0];
      if (f !== undefined) this.form(p, f.id);
    }
  }

  // ---- Snapshots

  state(): DiplomacyState {
    return {
      subjects: this.subjects.map((s) => ({ ...s })),
      aggression: [...this.aggression],
      coalitions: [...this.coalitions].map(([x, m]) => [x, [...m]]),
      core: [...this.core],
      since: [...this.since],
      startTiles: [...this.startTiles],
      formed: [...this.formed],
      wars: [...this.wars],
    };
  }

  restore(s: DiplomacyState): void {
    this.subjects = s.subjects.map((x) => ({ ...x }));
    this.aggression = new Map(s.aggression);
    this.coalitions = new Map(s.coalitions.map(([x, m]) => [x, [...m]]));
    this.core = new Map(s.core);
    this.since = new Map(s.since);
    this.startTiles = new Map(s.startTiles);
    this.formed = new Set(s.formed);
    this.wars = new Map(s.wars);
  }
}
