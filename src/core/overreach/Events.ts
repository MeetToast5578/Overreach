import { type Game, type Player, PlayerType } from "../game/Game";
import type { GameImpl } from "../game/GameImpl";
import type { PseudoRandom } from "../PseudoRandom";
import { TICKS_PER_YEAR, yearAt } from "./Calendar";

// Historical events (Overreach, SANDBOX.md F7; ROADMAP.md M13): pressure,
// not a script. Each fires once, at a year's turn inside its years, only if
// the world still fits it (its nations alive, and its own test). The AI picks
// an option by weight; a human answers (the "event" action) within
// ANSWER_TICKS, or gets the first option. Texts are en.json's event.<id>.*.

export interface EventOption {
  weight: number; // how often the AI picks it
  effect: (game: Game, p: Player) => void;
}

export interface HistoricalEvent {
  id: string;
  from: number; // years
  to: number;
  who: string; // the nation it happens to (scenario id)
  also?: string[]; // nations that must be alive too
  test?: (game: Game, p: Player) => boolean;
  options: EventOption[];
}

export const ANSWER_TICKS = 600; // a minute

// A scenario nation, alive: the human's own player if they picked it.
function player(g: Game, id: string): Player | null {
  const s = g.config().gameConfig().scenario;
  const picked = s?.player !== undefined && s.nations[s.player]?.id === id;
  const p = g.hasPlayer(id)
    ? g.player(id)
    : picked
      ? (g.players().find((x) => x.type() === PlayerType.Human) ?? null)
      : null;
  return p?.isAlive() ? p : null;
}

// ---- Effects

function war(a: Player, b: Player | null, g: Game): void {
  if (b === null || a === b) return;
  const alliance = a.allianceWith(b);
  if (alliance !== null) alliance.expire();
  a.updateRelation(b, -100);
  b.updateRelation(a, -100);
  if (a.canTarget(b)) a.target(b);
  (g as GameImpl).diplomacy?.declareWar(a, b);
}

function pay(from: Player, to: Player | null, percent: number): void {
  if (to === null) return;
  const gold = (from.gold() * BigInt(percent)) / 100n;
  if (gold > 0n) to.addGold(from.removeGold(gold));
}

function spend(p: Player, percent: number): void {
  p.removeGold((p.gold() * BigInt(percent)) / 100n);
}

function troops(p: Player, percent: number): void {
  const n = Math.floor((p.troops() * Math.abs(percent)) / 100);
  if (percent < 0) p.removeTroops(n);
  else p.addTroops(n);
}

function ally(a: Player | null, b: Player | null): void {
  if (a && b && a !== b && !a.isAlliedWith(b)) {
    a.createAllianceRequest(b)?.accept();
  }
}

function annex(g: Game, a: Player, b: Player | null): void {
  if (b !== null) (g as GameImpl).diplomacy?.annex(a, b);
}

function growTowns(g: Game, p: Player, percent: number): void {
  for (const rec of (g as GameImpl).provinces?.records ?? []) {
    if (rec?.owner === p.smallID()) {
      rec.population += Math.floor((rec.population * percent) / 100);
    }
  }
}

// ---- The events of World 1836

const GBR = "o1836GBR";
const QNG = "o1836QNG";
const USA = "o1836USA";
const TEX = "o1836TEX";
const MEX = "o1836MEX";
const RUS = "o1836RUS";
const OTT = "o1836OTT";
const FRA = "o1836FRA";
const JAP = "o1836JAP";

export const EVENTS: HistoricalEvent[] = [
  {
    id: "opium_war",
    from: 1839,
    to: 1842,
    who: QNG,
    also: [GBR],
    options: [
      // Ban the opium trade: Britain goes to war.
      { weight: 3, effect: (g, p) => war(player(g, GBR)!, p, g) },
      // Let the trade go on: silver drains to Britain.
      { weight: 1, effect: (g, p) => pay(p, player(g, GBR), 25) },
    ],
  },
  {
    id: "texas_annexation",
    from: 1845,
    to: 1848,
    who: USA,
    also: [TEX],
    options: [
      { weight: 3, effect: (g, p) => annex(g, p, player(g, TEX)) },
      { weight: 1, effect: () => {} },
    ],
  },
  {
    id: "mexican_war",
    from: 1846,
    to: 1850,
    who: USA,
    also: [MEX],
    options: [
      { weight: 2, effect: (g, p) => war(p, player(g, MEX), g) },
      // Offer to buy the land instead.
      { weight: 1, effect: (g, p) => pay(p, player(g, MEX), 20) },
    ],
  },
  {
    id: "revolutions_1848",
    from: 1848,
    to: 1849,
    who: FRA,
    options: [
      // Crush the revolt.
      { weight: 1, effect: (g, p) => troops(p, -30) },
      // Grant a republic and a constitution.
      { weight: 1, effect: (g, p) => spend(p, 20) },
    ],
  },
  {
    id: "crimean_war",
    from: 1853,
    to: 1856,
    who: RUS,
    also: [OTT],
    options: [
      // Press the Ottomans: Britain and France stand by them.
      {
        weight: 2,
        effect: (g, p) => {
          const ott = player(g, OTT);
          war(p, ott, g);
          ally(ott, player(g, GBR));
          ally(ott, player(g, FRA));
        },
      },
      { weight: 1, effect: (g, p) => troops(p, -10) },
    ],
  },
  {
    id: "serf_emancipation",
    from: 1861,
    to: 1865,
    who: RUS,
    options: [
      // Free the serfs: the towns grow.
      { weight: 3, effect: (g, p) => growTowns(g, p, 10) },
      { weight: 1, effect: (g, p) => troops(p, -15) },
    ],
  },
  {
    id: "meiji_restoration",
    from: 1868,
    to: 1872,
    who: JAP,
    options: [
      // Restore the emperor and modernise.
      {
        weight: 3,
        effect: (g, p) => {
          troops(p, 50);
          growTowns(g, p, 20);
        },
      },
      { weight: 1, effect: () => {} },
    ],
  },
  {
    id: "great_game",
    from: 1878,
    to: 1885,
    who: GBR,
    also: [RUS],
    test: (g) => player(g, "o1836AFG") !== null,
    options: [
      // Take Afghanistan before Russia does.
      { weight: 2, effect: (g, p) => war(p, player(g, "o1836AFG"), g) },
      { weight: 1, effect: () => {} },
    ],
  },
];

// ---- The engine

export interface Pending {
  event: string;
  player: number; // small id
  until: number; // tick
}

export class Events {
  fired = new Set<string>();
  pending: Pending[] = [];

  constructor(
    private game: Game,
    private start: number,
    private random: PseudoRandom,
    private events: HistoricalEvent[] = EVENTS,
  ) {}

  tick(ticks: number): void {
    for (const q of [...this.pending]) {
      if (ticks >= q.until) this.answer(null, q.event, 0, q.player);
    }
    if (ticks % TICKS_PER_YEAR !== 0) return;
    const year = yearAt(this.start, ticks);
    for (const e of this.events) {
      if (this.fired.has(e.id) || year < e.from || year > e.to) continue;
      const p = player(this.game, e.who);
      if (p === null || (e.also ?? []).some((id) => !player(this.game, id))) {
        continue;
      }
      if (e.test && !e.test(this.game, p)) continue;
      this.fired.add(e.id);
      if (p.type() === PlayerType.Human) {
        this.pending.push({
          event: e.id,
          player: p.smallID(),
          until: ticks + ANSWER_TICKS,
        });
      } else {
        this.apply(e, p, this.pick(e));
      }
    }
  }

  /** A human's answer (or, with `who`, the default when time runs out). */
  answer(p: Player | null, event: string, option: number, who?: number): void {
    const id = p?.smallID() ?? who;
    const q = this.pending.find((x) => x.event === event && x.player === id);
    const e = this.events.find((x) => x.id === event);
    if (q === undefined || e === undefined) return;
    this.pending = this.pending.filter((x) => x !== q);
    const target = this.game.playerBySmallID(q.player);
    if (target.isPlayer() && target.isAlive()) {
      this.apply(e, target, Math.min(option, e.options.length - 1));
    }
  }

  private pick(e: HistoricalEvent): number {
    const total = e.options.reduce((s, o) => s + o.weight, 0);
    let roll = this.random.nextInt(0, total);
    for (let i = 0; i < e.options.length; i++) {
      roll -= e.options[i].weight;
      if (roll < 0) return i;
    }
    return 0;
  }

  private apply(e: HistoricalEvent, p: Player, option: number): void {
    e.options[option].effect(this.game, p);
  }
}
