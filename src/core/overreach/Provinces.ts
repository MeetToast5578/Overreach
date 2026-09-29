import type { Game } from "../game/Game";
import type { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";

// Provinces (Overreach, SANDBOX.md F4). Every land tile has a home province
// (its geography, which only sandbox edits change) and a current province,
// the one it counts in:
// - an owned tile's current province always belongs to the tile's owner: its
//   home province if that is the owner's, else ("loose") the owner's
//   neighbouring province with the longest shared edge, or a new one (a
//   landing, say). An unowned tile sits in its home province;
// - a province flips whole to X when X takes its capital or holds more than
//   half its home tiles, and an abandoned one goes to whoever holds most of it.
//   Flipping conquers the old owner's tiles and brings X's loose tiles home.
// GameImpl reports every ownership change (onConquer, onRelinquish). Flips
// wait for ProvinceExecution's next tick, so no attack sees its tiles change
// in the middle of conquering.

export const MAX_PROVINCES = 65535;

export interface ProvinceRecord {
  name: string;
  owner: number; // small id, 0 for nobody
  capital: TileRef | null;
}

interface ProvinceIndex {
  // Home tiles of province p: tiles[start[p]] up to tiles[start[p + 1]].
  start: Int32Array;
  tiles: Int32Array;
  held: Map<number, number>[]; // province -> owner -> home tiles held
  loose: Map<number, Set<TileRef>>; // province -> tiles in it from elsewhere
}

export class Provinces {
  readonly prov: Uint16Array;
  // Derived from the layers and tile owners, and rebuilt when needed (after
  // a restore, or a sandbox edit of `home`): not saved.
  private provinceIndex: ProvinceIndex | null = null;
  private nbuf: TileRef[] = [0, 0, 0, 0];
  // Provinces to check for a flip on the next tick.
  readonly pending = new Set<number>();
  // Tiles whose current province changed, for the client (ProvinceView);
  // on overflow the client gets the whole layer instead. Not saved.
  clientChanges: TileRef[] = [];
  clientOverflow = false;

  /**
   * `records[0]` is unused, and so is any slot freed by a new province that
   * emptied. Without `prov` (a new game) owners and current provinces are
   * worked out from who owns the tiles now: each province goes to whoever
   * holds most of it.
   */
  constructor(
    private game: Game,
    readonly home: Uint16Array,
    readonly records: (ProvinceRecord | null)[],
    prov?: Uint16Array,
  ) {
    this.prov = prov ?? new Uint16Array(home.length);
    if (prov === undefined) this.assignAll();
  }

  onConquer(t: TileRef, owner: number, previous: number): void {
    const p = this.home[t];
    if (p !== 0) {
      if (this.indexBefore()) {
        this.count(p, previous, -1);
        this.count(p, owner, 1);
      }
      this.pending.add(p);
      const rec = this.records[p]!;
      if (rec.owner === 0) {
        this.claim(p, owner);
        return;
      }
      if (rec.owner === owner) {
        this.setProv(t, p);
        return;
      }
    }
    this.setProv(t, this.attach(t, owner));
  }

  onRelinquish(t: TileRef, previous: number): void {
    const p = this.home[t];
    if (p !== 0) {
      if (this.indexBefore()) this.count(p, previous, -1);
      this.pending.add(p);
    }
    this.setProv(t, p);
  }

  // Builds the index if needed. Built now, it already counts the change the
  // hooks are reporting (the tile's owner is set first), so false means
  // don't count it again.
  private indexBefore(): boolean {
    if (this.provinceIndex !== null) return true;
    this.ix();
    return false;
  }

  /** Flips the provinces whose ownership changed since the last call. */
  applyFlips(): void {
    const ids = [...this.pending];
    this.pending.clear();
    for (const p of ids) this.decide(p);
  }

  province(t: TileRef): number {
    return this.prov[t];
  }

  homeSize(p: number): number {
    return p + 1 < this.ix().start.length
      ? this.ix().start[p + 1] - this.ix().start[p]
      : 0;
  }

  /** How many of p's home tiles `owner` holds. */
  heldBy(p: number, owner: number): number {
    return this.ix().held[p]?.get(owner) ?? 0;
  }

  /** The first broken rule, or null. For tests. */
  violation(): string | null {
    const g = this.game;
    for (let t = 0; t < this.home.length; t++) {
      const o = g.ownerID(t);
      const q = this.prov[t];
      if (o === 0) {
        if (q !== this.home[t]) return `unowned tile ${t} is not at home`;
      } else if (q === 0 || this.records[q]?.owner !== o) {
        return `tile ${t} of ${o} is in province ${q} of ${this.records[q]?.owner}`;
      }
    }
    return null;
  }

  // ---- Sandbox edits (SandboxExecution). Unknown provinces are ignored.

  /** A new province of these tiles, owned by whoever holds most of them. */
  create(tiles: TileRef[], name: string): number {
    const p = this.newRecord({ name, owner: 0, capital: null });
    if (p === 0) return 0;
    this.setHome(tiles, p);
    if (this.homeSize(p) > 0) return p;
    this.records[p] = null;
    return 0;
  }

  assign(tiles: TileRef[], p: number): void {
    if (this.records[p]) this.setHome(tiles, p);
  }

  /** p's tiles left of the line from a to b become a new province. */
  split(p: number, a: TileRef, b: TileRef, name: string): number {
    const g = this.game;
    if (!this.records[p] || a >= this.home.length || b >= this.home.length) {
      return 0;
    }
    const [ax, ay, bx, by] = [g.x(a), g.y(a), g.x(b), g.y(b)];
    const left = [...this.tilesOf(p)].filter(
      (t) => (bx - ax) * (g.y(t) - ay) - (by - ay) * (g.x(t) - ax) < 0,
    );
    if (left.length === 0 || left.length === this.homeSize(p)) return 0;
    return this.create(left, name);
  }

  merge(into: number, from: number): void {
    const target = this.records[into];
    if (into === from || !target || !this.records[from]) return;
    this.setHome([...this.tilesOf(from)], into);
    for (const t of [...(this.ix().loose.get(from) ?? [])]) {
      if (this.game.ownerID(t) === target.owner) this.setProv(t, into);
    }
    this.dropIfEmpty(from);
  }

  rename(p: number, name: string): void {
    const rec = this.records[p];
    if (rec) rec.name = name;
  }

  /** Taking a province's capital flips it (decided on the next tick). */
  setCapital(p: number, tile: TileRef | null): void {
    const rec = this.records[p];
    if (!rec || (tile !== null && this.home[tile] !== p)) return;
    rec.capital = tile;
    this.pending.add(p);
  }

  // Moves tiles' home to p. The owner rule holds throughout: a moved tile
  // counts in p if it is p's owner's (or nobody's), else stays where it
  // counted if that is still its owner's, else is attached.
  private setHome(tiles: TileRef[], p: number): void {
    const g = this.game;
    const touched = new Set<number>();
    const moved: TileRef[] = [];
    for (const t of tiles) {
      if (t >= this.home.length || this.home[t] === p) continue;
      if (!g.isLand(t) || g.isImpassable(t)) continue;
      touched.add(this.home[t]);
      this.home[t] = p;
      moved.push(t);
    }
    if (moved.length === 0) return;
    this.reindex();
    const rec = this.records[p]!;
    if (rec.owner === 0) rec.owner = this.mostHeld(p)[0];
    // A capital that moved goes with its tile. (Before the tiles move over:
    // a province that empties then is gone.)
    for (const q of touched) {
      const old = this.records[q];
      if (old && old.capital !== null && this.home[old.capital] === p) {
        rec.capital ??= old.capital;
        old.capital = null;
      }
    }
    for (const t of moved) {
      const o = g.ownerID(t);
      const q = this.prov[t];
      if (o === 0 || o === rec.owner) this.setProv(t, p);
      else if (q === 0 || this.records[q]?.owner !== o) {
        this.setProv(t, this.attach(t, o));
      }
    }
    this.pending.add(p);
    for (const q of touched) {
      if (q === 0 || !this.records[q]) continue;
      this.pending.add(q);
      this.dropIfEmpty(q);
    }
  }

  private dropIfEmpty(q: number): void {
    if (this.homeSize(q) === 0 && !this.ix().loose.get(q)?.size) {
      this.records[q] = null;
    }
  }

  private mostHeld(p: number): [number, number] {
    let best = 0;
    let bestN = 0;
    for (const [x, n] of this.ix().held[p] ?? []) {
      if (n > bestN || (n === bestN && x < best)) [best, bestN] = [x, n];
    }
    return [best, bestN];
  }

  reindex(): void {
    this.provinceIndex = null;
  }

  private ix(): ProvinceIndex {
    if (this.provinceIndex !== null) return this.provinceIndex;
    const n = this.records.length;
    const start = new Int32Array(n + 1);
    for (let t = 0; t < this.home.length; t++) start[this.home[t] + 1]++;
    for (let p = 1; p <= n; p++) start[p] += start[p - 1];
    const next = start.slice(0, n);
    const tiles = new Int32Array(start[n]);
    for (let t = 0; t < this.home.length; t++) tiles[next[this.home[t]]++] = t;
    const ix: ProvinceIndex = {
      start,
      tiles,
      held: this.records.map(() => new Map<number, number>()),
      loose: new Map(),
    };
    this.provinceIndex = ix;
    for (let t = 0; t < this.home.length; t++) {
      // Unowned tiles are only away from home in the middle of setHome.
      if (this.prov[t] !== this.home[t] && this.prov[t] !== 0)
        this.addLoose(this.prov[t], t);
      const o = this.game.ownerID(t);
      if (o !== 0 && this.home[t] !== 0) this.count(this.home[t], o, 1);
    }
    return ix;
  }

  private *tilesOf(p: number): Generator<TileRef> {
    for (let i = this.ix().start[p]; i < this.ix().start[p + 1]; i++)
      yield this.ix().tiles[i];
  }

  private count(p: number, owner: number, d: number): void {
    if (owner === 0) return;
    const m = (this.ix().held[p] ??= new Map());
    const v = (m.get(owner) ?? 0) + d;
    if (v === 0) m.delete(owner);
    else m.set(owner, v);
  }

  private setProv(t: TileRef, q: number): void {
    const old = this.prov[t];
    if (old === q) return;
    if (old !== 0 && old !== this.home[t]) this.removeLoose(old, t);
    this.prov[t] = q;
    if (q !== 0 && q !== this.home[t]) this.addLoose(q, t);
    if (this.clientChanges.length >= this.home.length) {
      this.clientChanges = [];
      this.clientOverflow = true;
    }
    this.clientChanges.push(t);
  }

  private addLoose(q: number, t: TileRef): void {
    let s = this.ix().loose.get(q);
    if (s === undefined) this.ix().loose.set(q, (s = new Set()));
    s.add(t);
  }

  private removeLoose(q: number, t: TileRef): void {
    const s = this.ix().loose.get(q)!;
    s.delete(t);
    if (s.size > 0) return;
    this.ix().loose.delete(q);
    // A province made for loose tiles ends with its last tile.
    if (this.homeSize(q) === 0) this.records[q] = null;
  }

  // The owner's province with the longest edge along t, else a new one.
  private attach(t: TileRef, owner: number): number {
    const nb = this.nbuf;
    const n = this.game.neighbors4(t, nb);
    let best = 0;
    let bestN = 0;
    for (let i = 0; i < n; i++) {
      const q = this.prov[nb[i]];
      if (q === 0 || this.game.ownerID(nb[i]) !== owner) continue;
      if (this.records[q]?.owner !== owner) continue;
      let c = 0;
      for (let j = 0; j < n; j++) if (this.prov[nb[j]] === q) c++;
      if (c > bestN || (c === bestN && q < best)) [best, bestN] = [q, c];
    }
    return best !== 0 ? best : this.newProvince(t, owner);
  }

  private newProvince(t: TileRef, owner: number): number {
    const home = this.records[this.home[t]];
    const player = this.game.playerBySmallID(owner);
    const name = home?.name ?? (player.isPlayer() ? player.name() : "");
    // ponytail: 65,535 ids; past that a loose tile stays at home, breaking
    // the owner rule. Recycle harder if a game ever gets there.
    return this.newRecord({ name, owner, capital: null }) || this.home[t];
  }

  // A free id for rec, or 0 when all 65,535 are taken.
  private newRecord(rec: ProvinceRecord): number {
    let id = this.records.indexOf(null, 1);
    if (id === -1) {
      if (this.records.length > MAX_PROVINCES) return 0;
      id = this.records.push(rec) - 1;
      this.ix().held[id] = new Map();
    } else {
      this.records[id] = rec;
      this.ix().held[id] = new Map();
    }
    return id;
  }

  // An unowned province goes to `owner`, and its tiles they hold come home.
  private claim(p: number, owner: number): void {
    this.records[p]!.owner = owner;
    for (const t of this.tilesOf(p))
      if (this.game.ownerID(t) === owner) this.setProv(t, p);
  }

  private decide(p: number): void {
    const rec = this.records[p];
    if (!rec) return;
    const g = this.game;
    if (rec.capital !== null) {
      const x = g.ownerID(rec.capital);
      if (x !== 0 && x !== rec.owner) return this.flip(p, x);
    }
    const [best, bestN] = this.mostHeld(p);
    const abandoned =
      this.heldBy(p, rec.owner) === 0 && !this.ix().loose.get(p)?.size;
    if (abandoned && best === 0) rec.owner = 0;
    else if (abandoned && best !== rec.owner) this.flip(p, best);
    else if (best !== rec.owner && bestN * 2 > this.homeSize(p))
      this.flip(p, best);
  }

  private flip(p: number, owner: number): void {
    const g = this.game;
    const rec = this.records[p]!;
    const winner = g.playerBySmallID(owner);
    if (!winner.isPlayer() || !winner.isAlive()) return;
    const old = rec.owner;
    const loser = old === 0 ? null : g.playerBySmallID(old);
    if (loser?.isPlayer() && winner.isFriendly(loser)) return;
    rec.owner = owner;
    for (const t of this.tilesOf(p)) {
      const o = g.ownerID(t);
      if (o === old && old !== 0) winner.conquer(t);
      else if (o === owner) this.setProv(t, p);
    }
    // The old owner's loose tiles that counted in p find another province.
    // Sorted: a restored game rebuilds these sets in another order.
    const stray = [...(this.ix().loose.get(p) ?? [])]
      .filter((t) => g.ownerID(t) !== owner)
      .sort((x, y) => x - y);
    for (const t of stray) this.setProv(t, 0);
    for (const t of stray) this.setProv(t, this.attach(t, g.ownerID(t)));
  }

  // New game: owners by who holds most of each province, then every owned
  // tile outside its owner's provinces is attached, nearest first.
  private assignAll(): void {
    const g = this.game;
    for (let p = 1; p < this.records.length; p++) {
      const rec = this.records[p];
      if (rec) rec.owner = this.mostHeld(p)[0];
    }
    let rest: TileRef[] = [];
    for (let t = 0; t < this.home.length; t++) {
      const o = g.ownerID(t);
      const p = this.home[t];
      if (o === 0 || (p !== 0 && this.records[p]?.owner === o)) {
        this.prov[t] = p;
      } else {
        rest.push(t);
      }
    }
    while (rest.length > 0) {
      const left: TileRef[] = [];
      for (const t of rest) {
        const q = this.attachExisting(t, g.ownerID(t));
        if (q !== 0) this.setProv(t, q);
        else left.push(t);
      }
      if (left.length === rest.length) {
        const t = left.shift()!;
        this.setProv(t, this.newProvince(t, g.ownerID(t)));
      }
      rest = left;
    }
    this.clientChanges = [];
  }

  private attachExisting(t: TileRef, owner: number): number {
    const nb = this.nbuf;
    const n = this.game.neighbors4(t, nb);
    for (let i = 0; i < n; i++) {
      const q = this.prov[nb[i]];
      if (q !== 0 && this.records[q]?.owner === owner)
        return this.attach(t, owner);
    }
    return 0;
  }
}

/**
 * Provinces for a map without drawn ones: land grown outward from seeds
 * about `spacing` tiles apart, so ~spacing² tiles each. Islands too far from
 * any seed get their own. Names are made up from syllables.
 */
export function generateProvinces(
  game: Game,
  seed: number,
  spacing = 12,
): { home: Uint16Array; records: (ProvinceRecord | null)[] } {
  const w = game.width();
  const h = game.height();
  const home = new Uint16Array(w * h);
  const rand = new PseudoRandom(seed);
  const records: (ProvinceRecord | null)[] = [null];
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const open = (t: TileRef) => game.isLand(t) && !game.isImpassable(t);
  const add = (t: TileRef): boolean => {
    if (home[t] !== 0 || !open(t) || records.length > MAX_PROVINCES) {
      return false;
    }
    home[t] = records.length;
    records.push({ name: provinceName(rand), owner: 0, capital: null });
    queue[tail++] = t;
    return true;
  };
  for (let y0 = 0; y0 < h; y0 += spacing) {
    for (let x0 = 0; x0 < w; x0 += spacing) {
      const x = Math.min(w - 1, x0 + rand.nextInt(0, spacing));
      const y = Math.min(h - 1, y0 + rand.nextInt(0, spacing));
      add(game.ref(x, y));
    }
  }
  const nb: TileRef[] = [0, 0, 0, 0];
  const grow = () => {
    while (head < tail) {
      const t = queue[head++];
      const n = game.neighbors4(t, nb);
      for (let i = 0; i < n; i++) {
        const u = nb[i];
        if (home[u] === 0 && open(u)) {
          home[u] = home[t];
          queue[tail++] = u;
        }
      }
    }
  };
  grow();
  for (let t = 0; t < w * h; t++) {
    if (add(t)) grow();
  }
  return { home, records };
}

const ONSETS = [
  "b",
  "d",
  "k",
  "l",
  "m",
  "n",
  "r",
  "s",
  "t",
  "v",
  "z",
  "br",
  "dr",
  "gr",
  "st",
  "th",
];
const VOWELS = ["a", "e", "i", "o", "u", "a", "e", "ia", "ou"];
const CODAS = ["", "", "", "n", "r", "s", "l", "nd", "rk", "th"];

function provinceName(rand: PseudoRandom): string {
  const syllables = rand.nextInt(2, 4);
  let s = "";
  for (let i = 0; i < syllables; i++) {
    s += ONSETS[rand.nextInt(0, ONSETS.length)];
    s += VOWELS[rand.nextInt(0, VOWELS.length)];
  }
  s += CODAS[rand.nextInt(0, CODAS.length)];
  return s[0].toUpperCase() + s.slice(1);
}
