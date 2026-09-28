/* Overreach — grand strategy engine.
 *
 * Runs on a daily calendar over the province map built by world.js. Covers the
 * economy, armies, battles, sieges, wars, peace deals and diplomacy. No DOM:
 * the page and the headless harness both load this file.
 *
 * Ownership and control are separate. An occupied province still belongs to its
 * owner until a peace treaty moves it, which is what war score is measured on.
 */
(function (global) {
  'use strict';

  const W = global.World;

  const CFG = {
    START_YEAR: 1836,
    DAYS_PER_MONTH: 30,           // a flat 360-day year keeps date maths honest

    // ---- economy -------------------------------------------------------
    TAX_PER_DEV: 0.026,           // ducats per month per point of tax development
    PROD_PER_DEV: 0.017,
    MANPOWER_PER_DEV: 260,        // men of reserve per point of manpower development
    MANPOWER_REGEN: 0.012,        // share of the pool restored monthly
    POP_GROWTH: 0.0016,           // monthly, toward the province ceiling
    DEV_COST: 22,                 // base cost of one development point
    DEV_COST_SCALE: 1.9,          // ...times this per point already there
    AUTONOMY_DRAG: 0.6,           // how much unrest suppresses income
    LOAN_SIZE: 100,
    LOAN_INTEREST: 0.035,         // monthly on the outstanding total
    BANKRUPT_YEARS: 5,

    // ---- buildings -----------------------------------------------------
    BUILD_SLOTS: 4,

    // ---- army ----------------------------------------------------------
    MEN_PER_REGIMENT: 1000,
    COST_INF: 10, COST_CAV: 25, COST_ART: 30,
    UPKEEP_INF: 0.09, UPKEEP_CAV: 0.16, UPKEEP_ART: 0.19,
    FORCE_LIMIT_PER_DEV: 0.055,
    OVER_LIMIT_PENALTY: 3,        // upkeep multiplier above the force limit
    BASE_MORALE: 3.0,
    MORALE_REGEN: 0.09,           // per day in friendly supplied territory
    MOVE_BASE: 2.4,               // days to cross a province, before size and terrain
    MOVE_PER_KM: 0.022,           // ...plus this per km of its width (sqrt of area)
    SEA_MOVE_DAYS: 12,            // crossing a sea link
    STRAIT_DAYS: 2,               // crossing a strait (Bosphorus, Messina, Kerch...)

    // ---- battles -------------------------------------------------------
    COMBAT_WIDTH: 20,
    PHASE_DAYS: 3,
    DICE_MAX: 5,
    ATTACKER_PENALTY: 0.92,       // attacking into a province is slightly worse
    CASUALTY_SCALE: 10,           // men lost per point of applied damage
    MORALE_DAMAGE: 0.018,         // an even battle runs about a week rather than two days
    ROUT_LOSS: 0.14,              // share of the army lost breaking off
    PURSUIT_CAV: 0.5,             // cavalry share added to pursuit losses

    // ---- sieges --------------------------------------------------------
    SIEGE_BASE: 0.9,              // progress per day at fort level 1
    SIEGE_PER_ART: 0.22,
    SIEGE_TARGET: 100,
    FORT_SCALE: 0.55,             // each fort level divides progress by 1 + this

    // ---- attrition and supply -------------------------------------------
    SUPPLY_PER_DEV: 0.9,
    SUPPLY_BASE: 10,
    SUPPLY_FRIENDLY: 3.0,         // your own land feeds an army far better
    ATTRITION: 0.018,             // monthly share lost per point over supply
    HOSTILE_ATTRITION: 0.012,

    // ---- war -----------------------------------------------------------
    WARSCORE_BATTLE: 0.00022,     // per man of enemy losses
    WARSCORE_OCC_CAP: 65,         // most of the score occupation alone can give
    WARSCORE_GOAL: 25,            // holding the province you went to war for
    WARSCORE_CAPITAL: 12,         // holding the enemy capital
    WAR_EXHAUSTION: 0.09,         // per month at war; ~1 point a year
    TRUCE_YEARS: 5,
    CORE_YEARS: 15,               // hold a province this long in calm and it becomes yours
    AE_PER_DEV: 1.5,              // aggressive expansion per development annexed
    AE_DECAY: 0.4,                // per year
    COALITION_AE: 40,

    // ---- diplomacy -----------------------------------------------------
    OPINION_MAX: 200,
    OPINION_DECAY: 1.5,           // per year toward zero
    ALLY_MAX: 4,
    CLAIM_COST: 35, CLAIM_DAYS: 180,
  };

  const BUILDINGS = [
    { key: 'marketplace', name: 'Marketplace', cost: 120, tax: 0.35 },
    { key: 'workshop', name: 'Workshop', cost: 140, prod: 0.35 },
    { key: 'barracks', name: 'Barracks', cost: 130, man: 0.4 },
    { key: 'fort', name: 'Fort', cost: 180, fort: 1, upkeep: 0.11 },
    { key: 'harbour', name: 'Harbour', cost: 150, trade: 0.3, coastal: true },
    { key: 'roads', name: 'Road hub', cost: 110, move: 0.25 },
    { key: 'university', name: 'University', cost: 200, devgrow: 1, unrest: -0.3 },
  ];

  const TERRAIN = [
    { key: 'plains', name: 'Plains', move: 1.0, def: 1.0, supply: 1.0, attrition: 0 },
    { key: 'river', name: 'River valley', move: 1.15, def: 1.25, supply: 1.1, attrition: 0 },
    { key: 'coast', name: 'Coastal', move: 1.0, def: 1.05, supply: 1.15, attrition: 0 },
    { key: 'arctic', name: 'Arctic', move: 1.7, def: 1.15, supply: 0.4, attrition: 0.02 },
    { key: 'desert', name: 'Desert', move: 1.45, def: 1.1, supply: 0.45, attrition: 0.018 },
    { key: 'mountains', name: 'Mountains', move: 1.8, def: 1.45, supply: 0.5, attrition: 0.012 },
    { key: 'hills', name: 'Hills', move: 1.35, def: 1.25, supply: 0.8, attrition: 0 },
    { key: 'marsh', name: 'Marsh', move: 1.6, def: 1.2, supply: 0.6, attrition: 0.01 },
  ];

  const CB = {
    conquest: { name: 'Conquest', needsClaim: true, ae: 1.0, allows: ['province', 'gold'] },
    reconquest: { name: 'Reconquest', needsCore: true, ae: 0.35, allows: ['province'] },
    imperial: { name: 'Imperial ambition', minRatio: 2.2, ae: 1.2, allows: ['province', 'gold'] },
    humiliate: { name: 'Humiliate', needsInsult: true, ae: 0.5, allows: ['gold', 'humiliate'] },
    liberation: { name: 'Liberation', needsOccupiedCore: true, ae: 0.2, allows: ['liberate'] },
    vassalise: { name: 'Vassalisation', minRatio: 3, ae: 1.1, allows: ['vassalise'] },
    none: { name: 'No casus belli', ae: 2.2, prestige: -20, allows: ['province', 'gold', 'vassalise'] },
  };

  // ------------------------------------------------------------------ rng
  function rand(s) {
    let t = (s.rng = (s.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const hashSeed = (seed) => {
    let h = 2166136261 >>> 0;
    for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    return h;
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dice = (s) => Math.floor(rand(s) * (CFG.DICE_MAX + 1));

  // --------------------------------------------------------------- statics
  let PCOUNT = 0, TERRAIN_OF = null, RIVER = null, COASTAL = null, MOVE_DAYS = null;
  let SEA_LINKS = null;      // province -> [province] reachable by sea

  /** Per-province statics from the map table: terrain, coast, rivers, travel time, sea links.
   *  Nothing here reads pixels, so the simulation is the same at 8k and 4k. */
  function prepare() {
    PCOUNT = W.count();
    TERRAIN_OF = new Uint8Array(PCOUNT + 1);
    RIVER = new Float32Array(PCOUNT + 1);
    COASTAL = new Uint8Array(PCOUNT + 1);
    MOVE_DAYS = new Float32Array(PCOUNT + 1);
    SEA_LINKS = [];
    for (let i = 1; i <= PCOUNT; i++) {
      const t = W.terrainClass(i);
      TERRAIN_OF[i] = t;
      RIVER[i] = W.riverShare(i);
      COASTAL[i] = W.coastal(i) ? 1 : 0;
      // Crossing time grows with the province's width (sqrt of its area), then terrain.
      MOVE_DAYS[i] = (CFG.MOVE_BASE + Math.sqrt(W.areaKm(i)) * CFG.MOVE_PER_KM) * TERRAIN[t].move;
      SEA_LINKS[i] = W.seaLinks(i);
    }
  }

  // ------------------------------------------------------------- new game
  function newGame(opts) {
    const o = Object.assign({ seed: 1, player: 0, difficulty: 'normal' }, opts);
    if (!PCOUNT) prepare();
    const s = {
      seed: String(o.seed), rng: hashSeed(o.seed), day: 0, player: o.player || 0,
      difficulty: o.difficulty, over: null, log: [],
      // provinces
      owner: new Uint8Array(PCOUNT + 1),
      control: new Uint8Array(PCOUNT + 1),
      coreOwner: new Uint8Array(PCOUNT + 1),
      pop: new Float64Array(PCOUNT + 1),
      devTax: new Uint8Array(PCOUNT + 1),
      devProd: new Uint8Array(PCOUNT + 1),
      devMan: new Uint8Array(PCOUNT + 1),
      build: new Uint8Array(PCOUNT + 1),      // bitmask over BUILDINGS
      unrest: new Float32Array(PCOUNT + 1),
      fort: new Uint8Array(PCOUNT + 1),
      siege: new Float32Array(PCOUNT + 1),
      siegeBy: new Uint8Array(PCOUNT + 1),
      heldSince: new Int32Array(PCOUNT + 1),   // when the current owner took it
      // nations
      alive: new Uint8Array(256),
      treasury: new Float64Array(256),
      loans: new Int16Array(256),
      manpower: new Float64Array(256),
      prestige: new Float64Array(256),
      stability: new Float64Array(256),
      exhaustion: new Float64Array(256),
      ae: new Float64Array(256),
      bankruptUntil: new Int32Array(256),
      capital: new Uint16Array(256),
      overlord: new Uint8Array(256),
      opinion: new Int16Array(256 * 256),
      truce: new Int32Array(256 * 256),
      claims: [],                              // nation -> Set(province)
      allies: [],                              // nation -> Set(nation)
      guarantees: [],
      armies: [],
      nextArmy: 1,
      wars: [],
      nextWar: 1,
      insulted: new Uint8Array(256 * 256),
      natProv: [],                             // nation -> Set of provinces it owns
      dirty: new Set(),                        // provinces whose paint is stale
      stats: { battles: 0, sieges: 0, wars: 0, peaces: 0, annexed: 0 },
    };
    for (const id of W.nations()) {
      s.alive[id] = 1;
      s.natProv[id] = new Set();
      s.claims[id] = new Set();
      s.allies[id] = new Set();
      s.guarantees[id] = new Set();
      s.capital[id] = W.capital(id);
      s.stability[id] = 1;
      s.prestige[id] = 0;
    }
    for (let i = 1; i <= PCOUNT; i++) {
      const nat = W.nationOf(i);
      s.owner[i] = nat; s.control[i] = nat; s.coreOwner[i] = nat;
      s.natProv[nat].add(i);
      const pop = Math.max(500, W.popOf(i));
      s.pop[i] = pop;
      const base = clamp(Math.round(1 + Math.log10(1 + pop) * 1.9), 1, 20);
      s.devTax[i] = base;
      s.devProd[i] = clamp(base + (rand(s) < 0.3 ? 1 : 0) - 1, 1, 20);
      s.devMan[i] = clamp(base - 2, 1, 18);
      // Fortresses are a great power's luxury: a one-province state has none.
      const size = W.provincesOf(nat).length;
      if (W.capital(nat) === i) s.fort[i] = size >= 8 ? 2 : size >= 3 ? 1 : 0;
      else if (base >= 12 && size >= 6) s.fort[i] = 1;
    }
    refreshEconomy(s);
    for (const id of W.nations()) {
      const e = economy(s, id);
      s.treasury[id] = Math.round(e.income * 12);
      s.manpower[id] = e.maxManpower * 0.8;
      // A starting army sized to the country — but only one it can pay for.
      let reg = Math.max(1, Math.round(e.forceLimit * 0.4));
      const perReg = 0.7 * CFG.UPKEEP_INF + 0.2 * CFG.UPKEEP_CAV + 0.1 * CFG.UPKEEP_ART;
      const affordable = Math.floor((e.income - e.forts) * 0.6 / perReg);
      reg = Math.min(reg, Math.max(0, affordable));
      if (reg > 0) {
        createArmy(s, id, s.capital[id], {
          inf: Math.max(1, Math.round(reg * 0.7)),
          cav: Math.round(reg * 0.2),
          art: Math.round(reg * 0.1),
        });
      }
    }
    refreshEconomy(s);
    note(s, `The world in ${CFG.START_YEAR}.`);
    return s;
  }

  // ----------------------------------------------------------------- dates
  const year = (s) => CFG.START_YEAR + Math.floor(s.day / 360);
  const month = (s) => Math.floor((s.day % 360) / 30) + 1;
  const dayOfMonth = (s) => (s.day % 30) + 1;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const dateString = (s) => `${dayOfMonth(s)} ${MONTHS[month(s) - 1]} ${year(s)}`;

  function note(s, text, kind, who) {
    s.log.push({ day: s.day, date: dateString(s), text, kind: kind || 'info', who: who || 0 });
    if (s.log.length > 500) s.log.splice(0, s.log.length - 500);
  }

  const op = (s, a, b) => s.opinion[a * 256 + b];
  const addOp = (s, a, b, v) => {
    const k = a * 256 + b;
    s.opinion[k] = clamp(s.opinion[k] + v, -CFG.OPINION_MAX, CFG.OPINION_MAX);
  };
  const truceLeft = (s, a, b) => Math.max(0, s.truce[a * 256 + b] - s.day);
  const setTruce = (s, a, b, days) => {
    s.truce[a * 256 + b] = s.day + days;
    s.truce[b * 256 + a] = s.day + days;
  };

  // --------------------------------------------------------------- economy
  function hasBuilding(s, i, idx) { return (s.build[i] >> idx) & 1; }

  function provinceIncome(s, i) {
    const autonomy = 1 - clamp(s.unrest[i], 0, 1) * CFG.AUTONOMY_DRAG;
    const foreign = s.coreOwner[i] !== s.owner[i] ? 0.75 : 1;
    let tax = s.devTax[i] * CFG.TAX_PER_DEV;
    let prod = s.devProd[i] * CFG.PROD_PER_DEV;
    if (hasBuilding(s, i, 0)) tax *= 1 + BUILDINGS[0].tax;
    if (hasBuilding(s, i, 1)) prod *= 1 + BUILDINGS[1].prod;
    if (hasBuilding(s, i, 4)) prod *= 1 + BUILDINGS[4].trade;
    const scale = 0.55 + 0.45 * Math.min(1, s.pop[i] / 400000);
    return (tax + prod) * autonomy * foreign * scale;
  }

  /** One sweep of the map fills every nation's ledger. Per-nation sweeps would
   *  be 241x this work, which the AI would then repeat many times a month. */
  function refreshEconomy(s) {
    const income = new Float64Array(256), maxMan = new Float64Array(256);
    const flimit = new Float64Array(256), provs = new Int32Array(256);
    const dev = new Float64Array(256), forts = new Float64Array(256);
    for (let i = 1; i <= PCOUNT; i++) {
      const o = s.owner[i];
      if (!o) continue;
      provs[o]++;
      const d = s.devTax[i] + s.devProd[i] + s.devMan[i];
      dev[o] += d;
      flimit[o] += d * CFG.FORCE_LIMIT_PER_DEV;
      if (s.fort[i]) forts[o] += s.fort[i] * BUILDINGS[3].upkeep;
      const holder = s.control[i];
      if (holder !== o) continue;          // an occupied province pays its occupier nothing yet
      income[o] += provinceIncome(s, i);
      let man = s.devMan[i] * CFG.MANPOWER_PER_DEV;
      if (hasBuilding(s, i, 2)) man *= 1 + BUILDINGS[2].man;
      maxMan[o] += man;
    }
    const upkeep = new Float64Array(256), regs = new Float64Array(256);
    for (const a of s.armies) {
      if (a.dead) continue;
      upkeep[a.owner] += a.inf * CFG.UPKEEP_INF + a.cav * CFG.UPKEEP_CAV + a.art * CFG.UPKEEP_ART;
      regs[a.owner] += a.inf + a.cav + a.art;
    }
    const eco = [];
    for (const id of W.nations()) {
      let up = upkeep[id];
      if (regs[id] > flimit[id]) up *= 1 + (regs[id] / Math.max(1, flimit[id]) - 1) * CFG.OVER_LIMIT_PENALTY;
      const interest = s.loans[id] * CFG.LOAN_SIZE * CFG.LOAN_INTEREST;
      const tribute = s.overlord[id] ? income[id] * 0.25 : 0;
      eco[id] = {
        gross: income[id], income: income[id] - tribute, upkeep: up, forts: forts[id], interest,
        net: 0, maxManpower: maxMan[id], forceLimit: flimit[id], regiments: regs[id],
        provinces: provs[id], dev: dev[id], tribute,
      };
    }
    // Overlords collect a quarter of what each vassal makes.
    for (const id of W.nations()) {
      const ov = s.overlord[id];
      if (ov && eco[ov]) eco[ov].income += income[id] * 0.25;
    }
    for (const id of W.nations()) {
      const e = eco[id];
      e.net = e.income - e.upkeep - e.forts - e.interest;
    }
    s.eco = eco;
    s.ecoDay = s.day;
  }

  function economy(s, id) {
    if (!s.eco || s.ecoDay !== s.day) refreshEconomy(s);
    return s.eco[id];
  }

  function devCost(s, i, which) {
    const cur = which === 'tax' ? s.devTax[i] : which === 'prod' ? s.devProd[i] : s.devMan[i];
    return Math.round(CFG.DEV_COST + cur * CFG.DEV_COST_SCALE * 3);
  }
  function develop(s, id, i, which) {
    if (s.owner[i] !== id || s.control[i] !== id) return false;
    const cost = devCost(s, i, which);
    if (s.treasury[id] < cost) return false;
    const cap = 30;
    if (which === 'tax' && s.devTax[i] >= cap) return false;
    if (which === 'prod' && s.devProd[i] >= cap) return false;
    if (which === 'man' && s.devMan[i] >= cap) return false;
    s.treasury[id] -= cost;
    if (which === 'tax') s.devTax[i]++;
    else if (which === 'prod') s.devProd[i]++;
    else s.devMan[i]++;
    s.unrest[i] = Math.max(0, s.unrest[i] - 0.05);
    return true;
  }

  function buildingCount(s, i) {
    let n = 0;
    for (let b = 0; b < BUILDINGS.length; b++) if (hasBuilding(s, i, b)) n++;
    return n;
  }
  function canBuild(s, id, i, b) {
    if (s.owner[i] !== id || s.control[i] !== id) return false;
    if (hasBuilding(s, i, b)) return false;
    if (BUILDINGS[b].coastal && !COASTAL[i]) return false;
    if (buildingCount(s, i) >= CFG.BUILD_SLOTS) return false;
    return s.treasury[id] >= BUILDINGS[b].cost;
  }
  function construct(s, id, i, b) {
    if (!canBuild(s, id, i, b)) return false;
    s.treasury[id] -= BUILDINGS[b].cost;
    s.build[i] |= (1 << b);
    if (BUILDINGS[b].fort) s.fort[i] += BUILDINGS[b].fort;
    if (BUILDINGS[b].unrest) s.unrest[i] = Math.max(0, s.unrest[i] + BUILDINGS[b].unrest);
    return true;
  }

  function takeLoan(s, id) {
    s.loans[id]++;
    s.treasury[id] += CFG.LOAN_SIZE;
    if (id === s.player) note(s, `Took a loan of ${CFG.LOAN_SIZE} ducats.`, 'warn');
    return true;
  }
  function repayLoan(s, id) {
    if (!s.loans[id] || s.treasury[id] < CFG.LOAN_SIZE) return false;
    s.loans[id]--;
    s.treasury[id] -= CFG.LOAN_SIZE;
    return true;
  }
  function goBankrupt(s, id) {
    s.loans[id] = 0;
    s.treasury[id] = 0;
    s.bankruptUntil[id] = s.day + CFG.BANKRUPT_YEARS * 360;
    s.stability[id] = Math.min(s.stability[id], -1);
    s.prestige[id] -= 25;
    for (const a of s.armies) if (a.owner === id && !a.dead) scale(a, 0.7);
    note(s, `${W.nation(id).name} declares bankruptcy.`, id === s.player ? 'bad' : 'info', id);
  }

  // ---------------------------------------------------------------- armies
  function createArmy(s, owner, prov, mix) {
    const a = {
      id: s.nextArmy++, owner, prov,
      inf: mix.inf | 0, cav: mix.cav | 0, art: mix.art | 0,
      men: ((mix.inf | 0) + (mix.cav | 0) + (mix.art | 0)) * CFG.MEN_PER_REGIMENT,
      morale: CFG.BASE_MORALE, path: null, moveLeft: 0, battle: null, dead: false,
    };
    s.armies.push(a);
    return a;
  }
  const regiments = (a) => a.inf + a.cav + a.art;
  const maxMen = (a) => regiments(a) * CFG.MEN_PER_REGIMENT;
  function scale(a, f) {
    a.men = Math.max(0, Math.round(a.men * f));
    syncRegiments(a);
  }
  /** Regiments follow men: a shattered stack loses whole units. */
  function syncRegiments(a) {
    const want = Math.ceil(a.men / CFG.MEN_PER_REGIMENT);
    let have = regiments(a);
    while (have > want && have > 0) {
      if (a.art > 0 && a.art >= a.cav) a.art--;
      else if (a.cav > 0) a.cav--;
      else if (a.inf > 0) a.inf--;
      else break;
      have--;
    }
    if (!have) a.dead = true;
  }
  function recruitCost(mix) {
    return (mix.inf | 0) * CFG.COST_INF + (mix.cav | 0) * CFG.COST_CAV + (mix.art | 0) * CFG.COST_ART;
  }
  function recruit(s, id, prov, mix) {
    if (s.owner[prov] !== id || s.control[prov] !== id) return null;
    const cost = recruitCost(mix);
    const men = ((mix.inf | 0) + (mix.cav | 0) + (mix.art | 0)) * CFG.MEN_PER_REGIMENT;
    if (s.treasury[id] < cost || s.manpower[id] < men || men <= 0) return null;
    s.treasury[id] -= cost;
    s.manpower[id] -= men;
    // Merge into an army already standing there rather than making a duplicate.
    for (const a of s.armies) {
      if (a.dead || a.owner !== id || a.prov !== prov || a.battle || a.path) continue;
      a.inf += mix.inf | 0; a.cav += mix.cav | 0; a.art += mix.art | 0;
      a.men += men;
      return a;
    }
    return createArmy(s, id, prov, mix);
  }

  const EMPTY = [];
  /** Rebuild province and owner indexes. Every lookup below was a full scan. */
  function indexArmies(s) {
    if (s.armyDay === s.day && s.byProv) return;
    s.armyDay = s.day;
    // Dead armies are never revived, so drop them before they pile up.
    if (s.armies.length > 400 && s.armies.length > countLive(s) * 1.5) {
      s.armies = s.armies.filter((a) => !a.dead);
    }
    const byProv = new Map(), byOwner = [];
    for (const a of s.armies) {
      if (a.dead) continue;
      let l = byProv.get(a.prov);
      if (!l) byProv.set(a.prov, (l = []));
      l.push(a);
      (byOwner[a.owner] || (byOwner[a.owner] = [])).push(a);
    }
    s.byProv = byProv; s.byOwner = byOwner;
  }
  function countLive(s) {
    let n = 0;
    for (const a of s.armies) if (!a.dead) n++;
    return n;
  }
  const armiesAt = (s, prov) => { indexArmies(s); return s.byProv.get(prov) || EMPTY; };
  const armiesOf = (s, id) => { indexArmies(s); return s.byOwner[id] || EMPTY; };

  /** Quickest province path in days (Dijkstra), allowing sea links. Scratch
   *  arrays are stamped per search so nothing is reallocated per call. */
  let PF_DIST = null, PF_PREV = null, PF_SEEN = null, PF_DONE = null, PF_GEN = 0;
  const PF_ENTER = new Uint32Array(256), PF_ENTER_OK = new Uint8Array(256);
  function findPath(s, from, to, owner) {
    if (from === to) return [];
    if (!PF_DIST || PF_DIST.length !== PCOUNT + 1) {
      PF_DIST = new Float64Array(PCOUNT + 1); PF_PREV = new Uint16Array(PCOUNT + 1);
      PF_SEEN = new Uint32Array(PCOUNT + 1); PF_DONE = new Uint32Array(PCOUNT + 1);
    }
    const gen = ++PF_GEN;
    // canEnter depends only on who holds the province, so ask once per holder.
    const enter = (p) => {
      const h = s.control[p];
      if (PF_ENTER[h] !== gen) { PF_ENTER[h] = gen; PF_ENTER_OK[h] = canEnter(s, owner, p) ? 1 : 0; }
      return PF_ENTER_OK[h] === 1;
    };
    const hp = [], hd = [];
    const push = (p, d) => {
      let i = hp.length;
      hp.push(p); hd.push(d);
      while (i > 0) {
        const up = (i - 1) >> 1;
        if (hd[up] <= d) break;
        hp[i] = hp[up]; hd[i] = hd[up]; i = up;
      }
      hp[i] = p; hd[i] = d;
    };
    const pop = () => {
      const top = hp[0], last = hp.pop(), ld = hd.pop();
      if (hp.length) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= hp.length) break;
          if (c + 1 < hp.length && hd[c + 1] < hd[c]) c++;
          if (hd[c] >= ld) break;
          hp[i] = hp[c]; hd[i] = hd[c]; i = c;
        }
        hp[i] = last; hd[i] = ld;
      }
      return top;
    };
    const relax = (u, v, d) => {
      if (PF_DONE[v] === gen || !enter(v)) return;
      if (PF_SEEN[v] === gen && PF_DIST[v] <= d) return;
      PF_SEEN[v] = gen; PF_DIST[v] = d; PF_PREV[v] = u;
      push(v, d);
    };
    PF_SEEN[from] = gen; PF_DIST[from] = 0;
    push(from, 0);
    while (hp.length) {
      const d0 = hd[0], u = pop();
      if (PF_DONE[u] === gen || d0 > PF_DIST[u]) continue;
      PF_DONE[u] = gen;
      if (u === to) {
        const path = [];
        for (let c = to; c !== from; c = PF_PREV[c]) path.push(c);
        return path.reverse();
      }
      const nb = W.neighbours(u);
      for (let k = 0; k < nb.length; k++) relax(u, nb[k], d0 + landDays(s, nb[k]));
      const sea = SEA_LINKS[u];
      if (sea) for (const v of sea) if (!nb.includes(v)) relax(u, v, d0 + seaDays(u, v));
    }
    return null;
  }
  function landDays(s, to) {
    let d = MOVE_DAYS[to];
    if (hasBuilding(s, to, 5)) d *= 1 - BUILDINGS[5].move;
    return Math.max(1, d);
  }

  /** You may enter your own land, an ally's, or anyone you are at war with. */
  function canEnter(s, owner, prov) {
    const holder = s.control[prov];
    if (!holder || holder === owner) return true;
    if (s.allies[owner] && s.allies[owner].has(holder)) return true;
    if (s.overlord[holder] === owner || s.overlord[owner] === holder) return true;
    return atWarWith(s, owner, holder);
  }

  function orderMove(s, army, to) {
    if (army.dead || army.battle) return false;
    const path = findPath(s, army.prov, to, army.owner);
    if (!path || !path.length) return false;
    army.path = path;
    army.moveLeft = stepDays(s, army, army.prov, path[0]);
    return true;
  }
  function stepDays(s, army, from, to) {
    return edgeDays(s, from, to);
  }
  /** Days to step from one province to a neighbour, by land, strait or open sea. */
  function edgeDays(s, from, to) {
    return W.neighbours(from).includes(to) ? landDays(s, to) : seaDays(from, to);
  }
  const seaDays = (a, b) => (W.isStrait(a, b) ? CFG.STRAIT_DAYS : CFG.SEA_MOVE_DAYS);

  // --------------------------------------------------------------- battles
  function startBattle(s, prov, sideA, sideB) {
    const b = {
      prov, day: s.day, phase: 0, phaseDay: 0,
      a: sideA, b: sideB,
      lossA: 0, lossB: 0, done: false,
      attacker: sideA[0].owner, defender: sideB[0].owner,
    };
    for (const x of sideA.concat(sideB)) { x.battle = b; x.path = null; }
    s.stats.battles++;
    const involved = b.attacker === s.player || b.defender === s.player;
    note(s, `Battle of ${W.nameOf(prov)}: ${W.nation(b.attacker).name} attacks ${W.nation(b.defender).name}.`,
      involved ? 'war' : 'info', b.attacker);
    return b;
  }

  function sidePower(side, phase) {
    let inf = 0, cav = 0, art = 0, men = 0, morale = 0, regs = 0;
    for (const a of side) {
      inf += a.inf; cav += a.cav; art += a.art; men += a.men;
      morale += a.morale * regiments(a); regs += regiments(a);
    }
    const front = Math.min(CFG.COMBAT_WIDTH, regs);
    const perReg = regs > 0
      ? (phase === 0 ? (inf * 1.0 + art * 2.0 + cav * 0.5) : (inf * 1.2 + cav * 2.1 + art * 0.6)) / regs
      : 0;
    return { front, perReg, men, regs, morale: regs ? morale / regs : 0, inf, cav, art };
  }

  function tickBattle(s, b) {
    if (b.done) return;
    b.a = b.a.filter((x) => !x.dead);
    b.b = b.b.filter((x) => !x.dead);
    if (!b.a.length || !b.b.length) return endBattle(s, b, b.a.length ? 'a' : 'b');
    if (++b.phaseDay > CFG.PHASE_DAYS) { b.phaseDay = 1; b.phase ^= 1; }

    const A = sidePower(b.a, b.phase), B = sidePower(b.b, b.phase);
    const terr = TERRAIN[TERRAIN_OF[b.prov]];
    const defBonus = terr.def * (1 + (s.fort[b.prov] ? 0.08 * s.fort[b.prov] : 0));
    const rollA = dice(s), rollB = dice(s);

    const dmgToB = A.front * A.perReg * (1.4 + rollA * 0.5) * CFG.ATTACKER_PENALTY / defBonus;
    const dmgToA = B.front * B.perReg * (1.4 + rollB * 0.5) * defBonus;

    applyDamage(s, b.b, dmgToB, B);
    applyDamage(s, b.a, dmgToA, A);
    b.lossB += dmgToB * CFG.CASUALTY_SCALE;
    b.lossA += dmgToA * CFG.CASUALTY_SCALE;

    const A2 = sidePower(b.a.filter((x) => !x.dead), b.phase);
    const B2 = sidePower(b.b.filter((x) => !x.dead), b.phase);
    const aBroke = A2.morale <= 0.02 || !A2.regs, bBroke = B2.morale <= 0.02 || !B2.regs;
    if (aBroke && bBroke) {
      // Both lines broke on the same day: whoever has more left holds the field,
      // and a dead heat goes to the defender rather than to whoever was checked first.
      const edge = (A2.morale - B2.morale) || (A2.men - B2.men);
      return endBattle(s, b, A2.regs && edge > 0 ? 'a' : 'b');
    }
    if (bBroke) return endBattle(s, b, 'a');
    if (aBroke) return endBattle(s, b, 'b');
  }

  function applyDamage(s, side, dmg, power) {
    if (!side.length || !power.regs) return;
    const men = dmg * CFG.CASUALTY_SCALE;
    const moraleHit = dmg * CFG.MORALE_DAMAGE / Math.max(1, power.regs / 10);
    for (const a of side) {
      const share = regiments(a) / power.regs;
      a.men = Math.max(0, a.men - men * share);
      a.morale = Math.max(0, a.morale - moraleHit);
      syncRegiments(a);
    }
  }

  function endBattle(s, b, winner) {
    b.done = true;
    const win = winner === 'a' ? b.a : b.b;
    const lose = winner === 'a' ? b.b : b.a;
    const winOwner = winner === 'a' ? b.attacker : b.defender;
    const loseOwner = winner === 'a' ? b.defender : b.attacker;
    // Pursuit: cavalry turns a defeat into a rout.
    const pw = sidePower(win.filter((x) => !x.dead), 1);
    const pursuit = CFG.ROUT_LOSS + (pw.regs ? pw.cav / pw.regs : 0) * CFG.PURSUIT_CAV * 0.2;
    for (const a of lose) {
      if (a.dead) continue;
      scale(a, 1 - pursuit);
      a.morale = Math.min(a.morale, 0.4);
      a.battle = null;
      if (!a.dead) retreat(s, a);
    }
    for (const a of win) { if (!a.dead) { a.battle = null; } }
    const w = warBetween(s, winOwner, loseOwner);
    if (w) {
      const losses = winner === 'a' ? b.lossB : b.lossA;
      addWarScore(s, w, winOwner, losses * CFG.WARSCORE_BATTLE);
      w.battles.push({ prov: b.prov, day: s.day, winner: winOwner, loser: loseOwner, losses: Math.round(losses) });
    }
    s.prestige[winOwner] += 2;
    s.prestige[loseOwner] -= 1;
    const involved = winOwner === s.player || loseOwner === s.player;
    note(s, `${W.nation(winOwner).name} wins the battle of ${W.nameOf(b.prov)}.`,
      winOwner === s.player ? 'good' : loseOwner === s.player ? 'bad' : involved ? 'war' : 'info', winOwner);
  }

  /** Fall back to the nearest province we may stand in. */
  function retreat(s, a) {
    const nb = W.neighbours(a.prov);
    let best = 0, bestScore = -1;
    for (const n of nb) {
      if (!canEnter(s, a.owner, n)) continue;
      if (armiesAt(s, n).some((o) => atWarWith(s, o.owner, a.owner))) continue;
      const score = (s.control[n] === a.owner ? 3 : 1) + rand(s);
      if (score > bestScore) { bestScore = score; best = n; }
    }
    if (best) { a.prov = best; a.path = null; a.moveLeft = 0; }
  }

  // ---------------------------------------------------------------- sieges
  function tickSiege(s, prov) {
    const besieger = s.siegeBy[prov];
    if (!besieger) return;
    const force = armiesAt(s, prov).filter((a) => a.owner === besieger || s.allies[besieger].has(a.owner));
    if (!force.length) { s.siege[prov] = 0; s.siegeBy[prov] = 0; if (s.sieging) s.sieging.delete(prov); return; }
    let art = 0, regs = 0;
    for (const a of force) { art += a.art; regs += regiments(a); }
    const fort = s.fort[prov];
    const rate = (CFG.SIEGE_BASE + art * CFG.SIEGE_PER_ART) / (1 + fort * CFG.FORT_SCALE)
      * Math.min(1, regs / Math.max(2, fort * 4));
    s.siege[prov] += rate;
    if (s.siege[prov] >= CFG.SIEGE_TARGET) {
      s.siege[prov] = 0; s.siegeBy[prov] = 0;
      if (s.sieging) s.sieging.delete(prov);
      setControl(s, prov, besieger);
      s.stats.sieges++;
      const w = warBetween(s, besieger, s.owner[prov]);
      if (w) recomputeOccupation(s, w);
      note(s, `${W.nameOf(prov)} falls to ${W.nation(besieger).name}.`,
        besieger === s.player ? 'good' : s.owner[prov] === s.player ? 'bad' : 'war', besieger);
    }
  }

  function setControl(s, prov, holder) {
    if (s.control[prov] === holder) return;
    s.control[prov] = holder;
    s.dirty.add(prov);
  }
  function setOwner(s, prov, owner) {
    if (s.owner[prov] === owner) return;
    const old = s.owner[prov];
    if (old && s.natProv[old]) s.natProv[old].delete(prov);
    if (s.natProv[owner]) s.natProv[owner].add(prov);
    s.owner[prov] = owner;
    s.control[prov] = owner;
    s.heldSince[prov] = s.day;
    s.siege[prov] = 0; s.siegeBy[prov] = 0;
    if (s.coreOwner[prov] !== owner) s.unrest[prov] = Math.min(1, s.unrest[prov] + 0.55);
    s.dirty.add(prov);
  }

  // ------------------------------------------------------------------ wars
  const atWarWith = (s, a, b) => !!warBetween(s, a, b);
  function warBetween(s, a, b) {
    for (const w of s.wars) {
      if (w.done) continue;
      if ((w.attackers.has(a) && w.defenders.has(b)) || (w.defenders.has(a) && w.attackers.has(b))) return w;
    }
    return null;
  }
  function warsOf(s, id) { return s.wars.filter((w) => !w.done && (w.attackers.has(id) || w.defenders.has(id))); }

  function canDeclare(s, a, b, cbKey) {
    if (a === b || !s.alive[a] || !s.alive[b]) return 'not a valid target';
    if (atWarWith(s, a, b)) return 'already at war';
    if (truceLeft(s, a, b) > 0) return `truce for ${Math.ceil(truceLeft(s, a, b) / 360)} more years`;
    if (s.allies[a].has(b)) return 'they are your ally';
    if (s.overlord[a] === b || s.overlord[b] === a) return 'they are your subject or overlord';
    const cb = CB[cbKey];
    if (!cb) return 'no such casus belli';
    if (cb.needsClaim) {
      let has = false;
      for (const p of s.claims[a]) if (s.owner[p] === b) { has = true; break; }
      if (!has) return 'you have no claim on their land';
    }
    if (cb.needsCore) {
      let has = false;
      for (const i of ownedBy(s, b)) if (s.coreOwner[i] === a) { has = true; break; }
      if (!has) return 'they hold none of your core land';
    }
    if (cb.needsInsult && !s.insulted[b * 256 + a]) return 'they have not insulted you';
    if (cb.needsOccupiedCore) {
      let has = false;
      for (const i of ownedBy(s, b)) if (s.coreOwner[i] !== b && s.alive[s.coreOwner[i]] === 0) { has = true; break; }
      if (!has) return 'they occupy no nation you could free';
    }
    if (cb.minRatio) {
      const ea = economy(s, a), eb = economy(s, b);
      if (ea.dev < eb.dev * cb.minRatio) return 'you are not strong enough for that pretext';
    }
    return null;
  }

  function declareWar(s, a, b, cbKey, goalProv) {
    const err = canDeclare(s, a, b, cbKey);
    if (err) return { ok: false, why: err };
    const w = {
      id: s.nextWar++, cb: cbKey, goal: goalProv || 0, start: s.day,
      attackers: new Set([a]), defenders: new Set([b]),
      leadA: a, leadB: b, score: 0, battles: [], done: false, occScore: 0,
    };
    // Allies and guarantors are dragged in.
    for (const ally of s.allies[b]) if (s.alive[ally] && !atWarWith(s, ally, a)) w.defenders.add(ally);
    for (const g of W.nations()) if (s.guarantees[g] && s.guarantees[g].has(b) && s.alive[g]) w.defenders.add(g);
    for (const ally of s.allies[a]) if (s.alive[ally] && rand(s) < 0.7) w.attackers.add(ally);
    for (const v of W.nations()) {
      if (s.overlord[v] === a) w.attackers.add(v);
      if (s.overlord[v] === b) w.defenders.add(v);
    }
    w.attackers.delete(0); w.defenders.delete(0);
    for (const x of w.attackers) w.defenders.delete(x);
    s.wars.push(w);
    s.stats.wars++;
    const cb = CB[cbKey];
    s.ae[a] += 5 * cb.ae;
    if (cb.prestige) s.prestige[a] += cb.prestige;
    for (const n of W.nations()) if (n !== a && s.alive[n]) addOp(s, n, a, -Math.round(6 * cb.ae));
    addOp(s, b, a, -60);
    note(s, `${W.nation(a).name} declares war on ${W.nation(b).name} — ${cb.name.toLowerCase()}.`,
      a === s.player ? 'war' : b === s.player ? 'bad' : 'info', a);
    return { ok: true, war: w };
  }

  function addWarScore(s, w, who, amount) {
    const sign = w.attackers.has(who) ? 1 : -1;
    w.score = clamp(w.score + sign * amount, -100, 100);
  }

  /** Occupation contributes to war score continuously, capped. */
  function recomputeOccupation(s, w) {
    let attOcc = 0, defOcc = 0, attTotal = 0, defTotal = 0;
    for (let i = 1; i <= PCOUNT; i++) {
      const o = s.owner[i];
      const devv = s.devTax[i] + s.devProd[i] + s.devMan[i];
      if (w.defenders.has(o)) {
        defTotal += devv;
        if (w.attackers.has(s.control[i])) attOcc += devv;
      } else if (w.attackers.has(o)) {
        attTotal += devv;
        if (w.defenders.has(s.control[i])) defOcc += devv;
      }
    }
    const a = defTotal ? Math.min(CFG.WARSCORE_OCC_CAP, 100 * attOcc / defTotal) : 0;
    const d = attTotal ? Math.min(CFG.WARSCORE_OCC_CAP, 100 * defOcc / attTotal) : 0;
    let goal = 0;
    if (w.goal && w.attackers.has(s.control[w.goal])) goal = CFG.WARSCORE_GOAL;
    // Holding the enemy capital is its own humiliation.
    if (w.attackers.has(s.control[s.capital[w.leadB]])) goal += CFG.WARSCORE_CAPITAL;
    if (w.defenders.has(s.control[s.capital[w.leadA]])) goal -= CFG.WARSCORE_CAPITAL;
    w.occScore = clamp(a - d + goal, -100, 100);
  }
  const warScore = (s, w) => clamp(w.score + w.occScore, -100, 100);

  // ------------------------------------------------------------ peace deal
  function provinceCost(s, w, prov, taker) {
    const devv = s.devTax[prov] + s.devProd[prov] + s.devMan[prov];
    let cost = 3 + devv * 0.75;
    if (s.coreOwner[prov] === taker) cost *= 0.5;           // taking back your own is cheap
    if (s.control[prov] !== taker) cost *= 1.6;             // not even occupied: expensive
    if (s.capital[s.owner[prov]] === prov) cost *= 1.8;
    return Math.round(cost);
  }
  function demandCost(s, w, d, taker) {
    if (d.kind === 'province') return provinceCost(s, w, d.prov, taker);
    if (d.kind === 'gold') return 15;
    if (d.kind === 'humiliate') return 20;
    if (d.kind === 'vassalise') return 60;
    if (d.kind === 'liberate') return 25;
    return 999;
  }
  function peaceCost(s, w, demands, taker) {
    let total = 0;
    for (const d of demands) total += demandCost(s, w, d, taker);
    return total;
  }

  /** Would the losing side sign? They weigh the terms against fighting on. */
  function wouldAccept(s, w, demands, taker) {
    const loser = w.attackers.has(taker) ? w.leadB : w.leadA;
    const sign = w.attackers.has(taker) ? 1 : -1;
    const score = warScore(s, w) * sign;
    const cost = peaceCost(s, w, demands, taker);
    if (!demands.length) return score > -25;                // white peace
    const ex = s.exhaustion[loser];
    const hopeless = score > 55 ? 12 : score > 30 ? 6 : 0;
    return cost <= score + hopeless + ex * 6;
  }

  function makePeace(s, w, taker, demands) {
    const giver = w.attackers.has(taker) ? w.leadB : w.leadA;
    for (const d of demands) {
      if (d.kind === 'province') {
        annex(s, d.prov, taker);
      } else if (d.kind === 'gold') {
        const amount = Math.min(s.treasury[giver], 150);
        s.treasury[giver] -= amount; s.treasury[taker] += amount;
      } else if (d.kind === 'humiliate') {
        s.prestige[giver] -= 25; s.prestige[taker] += 15;
      } else if (d.kind === 'vassalise') {
        s.overlord[giver] = taker;
        note(s, `${W.nation(giver).name} becomes a vassal of ${W.nation(taker).name}.`, 'war', taker);
      } else if (d.kind === 'liberate') {
        for (const i of Array.from(ownedBy(s, giver))) {
          if (s.coreOwner[i] !== giver) annex(s, i, s.coreOwner[i]);
        }
      }
    }
    const kind = taker === s.player ? 'good' : giver === s.player ? 'bad' : 'info';
    const leadA = w.leadA, leadB = w.leadB;
    if (!w.done) s.stats.peaces++;
    endWar(s, w);
    note(s, demands.length
      ? `Peace: ${W.nation(giver).name} concedes to ${W.nation(taker).name}.`
      : `${W.nation(leadA).name} and ${W.nation(leadB).name} agree a white peace.`, kind, taker);
  }

  /** Close a war: truces between the sides, exhaustion eases, and whatever
   *  the former enemies still occupy of each other goes home. */
  function endWar(s, w) {
    if (w.done) return;
    w.done = true;
    w.endDay = s.day;
    for (const a of w.attackers) for (const b of w.defenders) setTruce(s, a, b, CFG.TRUCE_YEARS * 360);
    for (const side of [w.attackers, w.defenders]) for (const n of side) s.exhaustion[n] *= 0.4;
    restoreControl(s);
  }

  /** Occupation only lasts while the two nations are at war. Other wars' fronts
   *  are left exactly as they are. */
  function restoreControl(s) {
    for (let i = 1; i <= PCOUNT; i++) {
      const o = s.owner[i], c = s.control[i];
      if (c !== o && !atWarWith(s, o, c)) setControl(s, i, o);
    }
    if (s.sieging) {
      for (const i of Array.from(s.sieging)) {
        const by = s.siegeBy[i];
        if (by && atWarWith(s, by, s.control[i])) continue;
        s.siegeBy[i] = 0; s.siege[i] = 0; s.sieging.delete(i);
      }
    }
    expelArmies(s);
  }

  /** Armies standing where they may no longer be are sent to the nearest land
   *  of their own (or an ally's); marches through closed borders are cancelled. */
  function expelArmies(s) {
    for (const a of s.armies) {
      if (a.dead || a.battle) continue;
      if (a.path && a.path.some((p) => !canEnter(s, a.owner, p))) { a.path = null; a.moveLeft = 0; }
      if (canEnter(s, a.owner, a.prov)) continue;
      const home = nearestFriendly(s, a.owner, a.prov);
      if (home) { a.prov = home; a.path = null; a.moveLeft = 0; }
      else disband(a);
    }
    s.byProv = null;
  }
  function nearestFriendly(s, owner, from) {
    const friendly = (p) => s.control[p] === owner || (s.allies[owner] && s.allies[owner].has(s.control[p]));
    const seen = new Set([from]);
    let frontier = [from];
    while (frontier.length && seen.size < 6000) {
      const next = [];
      for (const p of frontier) {
        for (const n of W.neighbours(p)) {
          if (seen.has(n)) continue;
          if (friendly(n)) return n;
          seen.add(n); next.push(n);
        }
        for (const n of SEA_LINKS[p] || []) {
          if (seen.has(n)) continue;
          if (friendly(n)) return n;
          seen.add(n); next.push(n);
        }
      }
      frontier = next;
    }
    const cap = s.capital[owner];
    return cap && s.control[cap] === owner ? cap : 0;
  }
  function disband(a) {
    a.dead = true; a.men = 0; a.inf = a.cav = a.art = 0; a.path = null; a.battle = null;
  }

  /** A nation leaving a war (destroyed, for now). A war side with no one left
   *  ends the war; a side that loses its leader passes the lead to its largest member. */
  function leaveWar(s, w, id) {
    const side = w.attackers.has(id) ? w.attackers : w.defenders;
    side.delete(id);
    if (!side.size) { s.stats.peaces++; endWar(s, w); return; }
    if (w.leadA === id || w.leadB === id) {
      let best = 0, bestDev = -1;
      for (const n of side) {
        const d = economy(s, n).dev;
        if (d > bestDev) { bestDev = d; best = n; }
      }
      if (w.leadA === id) w.leadA = best; else w.leadB = best;
    }
    recomputeOccupation(s, w);
  }

  /** Everything a nation leaves behind when it loses its last province. */
  function destroyNation(s, id) {
    s.alive[id] = 0;
    for (const o of s.allies[id]) s.allies[o].delete(id);
    s.allies[id].clear();
    for (const g of W.nations()) if (s.guarantees[g]) s.guarantees[g].delete(id);
    s.guarantees[id].clear();
    s.claims[id].clear();
    for (const v of W.nations()) if (s.overlord[v] === id) s.overlord[v] = 0;
    s.overlord[id] = 0;
    for (const a of s.armies) if (a.owner === id && !a.dead) disband(a);
    s.byProv = null;
    for (let i = 1; i <= PCOUNT; i++) if (s.control[i] === id) setControl(s, i, s.owner[i]);
    if (s.sieging) {
      for (const i of Array.from(s.sieging)) {
        if (s.siegeBy[i] !== id) continue;
        s.siegeBy[i] = 0; s.siege[i] = 0; s.sieging.delete(i);
      }
    }
    for (const w of warsOf(s, id)) leaveWar(s, w, id);
    note(s, `${W.nation(id).name} ceases to exist.`, id === s.player ? 'bad' : 'war', id);
  }

  function annex(s, prov, to) {
    const from = s.owner[prov];
    const devv = s.devTax[prov] + s.devProd[prov] + s.devMan[prov];
    if (!s.alive[to]) s.alive[to] = 1;          // a liberated or risen nation returns
    setOwner(s, prov, to);
    if (s.coreOwner[prov] !== to) s.ae[to] += devv * CFG.AE_PER_DEV * 0.08;
    s.stats.annexed++;
    if (from && !ownsAnything(s, from)) destroyNation(s, from);
    if (!s.capital[to] || s.owner[s.capital[to]] !== to) {
      const first = ownedBy(s, to).values().next();
      if (!first.done) s.capital[to] = first.value;
    }
  }
  const ownsAnything = (s, id) => s.natProv[id] && s.natProv[id].size > 0;
  const ownedBy = (s, id) => s.natProv[id] || new Set();

  // ------------------------------------------------------------ diplomacy
  function canAlly(s, a, b) {
    if (a === b || !s.alive[a] || !s.alive[b]) return false;
    if (s.allies[a].has(b)) return false;
    if (s.allies[a].size >= CFG.ALLY_MAX || s.allies[b].size >= CFG.ALLY_MAX) return false;
    if (atWarWith(s, a, b)) return false;
    if (s.overlord[a] || s.overlord[b]) return false;
    return true;
  }
  function allianceChance(s, a, b) {
    const ea = economy(s, a), eb = economy(s, b);
    let v = op(s, b, a) + 20;
    v += clamp((ea.dev - eb.dev) / Math.max(1, eb.dev) * 25, -30, 40);   // strength is attractive
    v -= s.ae[a] * 0.8;
    for (const w of warsOf(s, a)) v -= 15;
    return clamp(v / 100, 0, 0.95);
  }
  /** b weighs a's offer once; true means the alliance now stands. */
  function proposeAlliance(s, a, b) {
    if (!canAlly(s, a, b)) return false;
    if (rand(s) > allianceChance(s, a, b)) return false;
    return formAlliance(s, a, b);
  }
  /** Both sides have already agreed (e.g. the player accepting an AI offer). */
  function formAlliance(s, a, b) {
    if (!canAlly(s, a, b)) return false;
    s.allies[a].add(b); s.allies[b].add(a);
    addOp(s, a, b, 25); addOp(s, b, a, 25);
    return true;
  }
  function breakAlliance(s, a, b) {
    if (!s.allies[a].has(b)) return false;
    s.allies[a].delete(b); s.allies[b].delete(a);
    addOp(s, b, a, -50);
    s.prestige[a] -= 10;
    for (const o of s.allies[a]) addOp(s, o, a, -15);
    return true;
  }
  function insult(s, a, b) {
    s.insulted[a * 256 + b] = 1;
    addOp(s, b, a, -30);
    s.prestige[a] += 2;
    return true;
  }
  function fabricateClaim(s, a, prov) {
    if (s.treasury[a] < CFG.CLAIM_COST) return false;
    if (s.owner[prov] === a) return false;
    s.treasury[a] -= CFG.CLAIM_COST;
    s.claims[a].add(prov);
    addOp(s, s.owner[prov], a, -15);
    return true;
  }
  function royalMarriage(s, a, b) { addOp(s, a, b, 20); addOp(s, b, a, 20); return true; }
  function guarantee(s, a, b) { s.guarantees[a].add(b); addOp(s, b, a, 25); return true; }
  function giveProvince(s, a, prov, to) {
    if (s.owner[prov] !== a) return false;
    annex(s, prov, to);
    addOp(s, to, a, 40);
    return true;
  }
  /** Everyone who fears the leader can be pulled into a coalition. */
  function coalitionAgainst(s, id) {
    if (s.ae[id] < CFG.COALITION_AE) return [];
    const out = [];
    for (const n of W.nations()) {
      if (n === id || !s.alive[n] || s.overlord[n]) continue;
      if (op(s, n, id) < -20) out.push(n);
    }
    return out;
  }

  // ------------------------------------------------------------ daily tick
  function tick(s) {
    if (s.over) return;
    s.day++;
    s.byProv = null;              // positions change below; force a reindex

    // armies: move, then meet
    for (const a of s.armies) {
      if (a.dead || a.battle) continue;
      if (a.path && a.path.length) {
        a.moveLeft -= 1;
        if (a.moveLeft <= 0) {
          const next = a.path.shift();
          a.prov = next;
          if (!a.path.length) a.path = null;
          else a.moveLeft = stepDays(s, a, next, a.path[0]);
        }
      }
      if (a.morale < CFG.BASE_MORALE && !a.battle) {
        const home = s.control[a.prov] === a.owner || s.allies[a.owner].has(s.control[a.prov]);
        a.morale = Math.min(CFG.BASE_MORALE, a.morale + CFG.MORALE_REGEN * (home ? 1 : 0.5));
      }
    }
    mergeStacks(s);
    resolveContacts(s);
    for (const b of s.battleList || []) tickBattle(s, b);
    s.battleList = (s.battleList || []).filter((b) => !b.done);

    // sieges — tracked in a set so we never sweep 11,000 provinces a day
    if (!s.sieging) s.sieging = new Set();
    for (const i of Array.from(s.sieging)) tickSiege(s, i);
    updateSieges(s);

    if (s.day % 90 === 0 && s.wars.length > 60) {
      const done = s.wars.filter((w) => w.done);
      s.warHistory = (s.warHistory || []).concat(done).slice(-200);
      s.wars = s.wars.filter((w) => !w.done);
    }
    daily(s);
    if (s.day % 360 === 0) yearly(s);
    for (const w of s.wars) if (!w.done && s.day % 10 === 0) recomputeOccupation(s, w);
  }

  /** Two of your own armies in one province are one army. Without this they
   *  accumulate forever and every search over them gets slower. */
  function mergeStacks(s) {
    indexArmies(s);
    for (const [, list] of s.byProv) {
      if (list.length < 2) continue;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.dead || a.battle) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (b.dead || b.battle || b.owner !== a.owner) continue;
          if (a.path || b.path) continue;          // leave armies under orders alone
          // Never merge past what the ground can feed — a starving stack just
          // shrinks again. On campaign an army concentrates anyway and pays
          // the attrition, because scattered detachments cannot take a fort.
          const campaigning = warsOf(s, a.owner).length > 0;
          const cap = supplyLimit(s, a.prov, a.owner) * (campaigning ? 4 : 1.1);
          if (regiments(a) + regiments(b) > cap) continue;
          a.morale = (a.morale * regiments(a) + b.morale * regiments(b))
            / Math.max(1, regiments(a) + regiments(b));
          a.inf += b.inf; a.cav += b.cav; a.art += b.art;
          a.men += b.men;
          b.dead = true; b.men = 0; b.inf = b.cav = b.art = 0;
        }
      }
    }
    s.byProv = null;
  }

  /** Armies of hostile nations standing in the same province start a battle. */
  function resolveContacts(s) {
    s.battleList = s.battleList || [];
    indexArmies(s);
    for (const [prov, all] of s.byProv) {
      if (all.length < 2) continue;
      const list = all.filter((a) => !a.dead && !a.battle);
      if (list.length < 2) continue;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].battle || list[j].battle) continue;
          if (!atWarWith(s, list[i].owner, list[j].owner)) continue;
          const sideA = list.filter((x) => !x.battle && !atWarWith(s, x.owner, list[i].owner) && sameSide(s, x.owner, list[i].owner));
          const sideB = list.filter((x) => !x.battle && !atWarWith(s, x.owner, list[j].owner) && sameSide(s, x.owner, list[j].owner));
          if (!sideA.length || !sideB.length) continue;
          s.battleList.push(startBattle(s, prov, sideA, sideB));
        }
      }
    }
  }
  const sameSide = (s, a, b) => a === b || s.allies[a].has(b) || s.overlord[a] === b || s.overlord[b] === a;

  /** An army alone in hostile territory begins or continues a siege. */
  function updateSieges(s) {
    for (const a of s.armies) {
      if (a.dead || a.battle || a.path) continue;
      const holder = s.control[a.prov];
      if (!holder || holder === a.owner || sameSide(s, holder, a.owner)) continue;
      if (!atWarWith(s, a.owner, holder)) continue;
      if (!s.siegeBy[a.prov]) { s.siegeBy[a.prov] = a.owner; s.sieging.add(a.prov); }
    }
    for (const i of Array.from(s.sieging)) {
      if (!s.siegeBy[i]) { s.sieging.delete(i); continue; }
      const still = armiesAt(s, i).some((a) => a.owner === s.siegeBy[i] && !a.battle);
      if (!still) { s.siegeBy[i] = 0; s.siege[i] = 0; s.sieging.delete(i); }
    }
  }

  /** Everything that accrues over time, applied a day at a time. Rates in CFG stay monthly;
   *  each day applies a thirtieth, so a month adds up to the same as before. */
  const DAY = 1 / CFG.DAYS_PER_MONTH;
  const REVOLT_DAILY = 1 - Math.pow(0.95, DAY);      // was a 5% chance a month
  function daily(s) {
    refreshEconomy(s);
    for (const id of W.nations()) {
      if (!s.alive[id]) continue;
      const e = economy(s, id);
      s.treasury[id] += e.net * DAY;
      if (s.treasury[id] < 0) {
        if (s.loans[id] < 12) takeLoan(s, id);
        else goBankrupt(s, id);
      }
      s.manpower[id] = Math.min(e.maxManpower, s.manpower[id] + e.maxManpower * CFG.MANPOWER_REGEN * DAY);
      const wars = warsOf(s, id).length;
      s.exhaustion[id] = clamp(s.exhaustion[id] + (wars ? CFG.WAR_EXHAUSTION * wars : -CFG.WAR_EXHAUSTION) * DAY, 0, 20);
    }
    // provinces: population, unrest, attrition
    for (let i = 1; i <= PCOUNT; i++) {
      const ceiling = 3000 + (s.devTax[i] + s.devProd[i]) * 40000 * TERRAIN[TERRAIN_OF[i]].supply;
      s.pop[i] += (ceiling - s.pop[i]) * CFG.POP_GROWTH * DAY;
      const owner = s.owner[i];
      let drift = -0.006;
      if (s.coreOwner[i] !== owner) drift += 0.0075;
      if (hasBuilding(s, i, 6)) drift -= 0.004;
      if (s.control[i] !== owner) drift += 0.01;
      drift += s.exhaustion[owner] * 0.0008;
      s.unrest[i] = clamp(s.unrest[i] + drift * DAY, 0, 1);
      if (s.coreOwner[i] !== owner && s.control[i] === owner
        && s.unrest[i] < 0.35 && s.day - s.heldSince[i] > CFG.CORE_YEARS * 360) {
        s.coreOwner[i] = owner;
        s.unrest[i] = Math.max(0, s.unrest[i] - 0.15);
        if (owner === s.player) note(s, `${W.nameOf(i)} is now part of the realm proper.`, 'good');
      }
      if (s.unrest[i] > 0.92 && rand(s) < REVOLT_DAILY) revolt(s, i);
    }
    attrition(s);
  }

  /** How many regiments a province can feed for a given owner. */
  function supplyLimit(s, prov, owner) {
    const t = TERRAIN[TERRAIN_OF[prov]];
    const friendly = s.control[prov] === owner || sameSide(s, s.control[prov], owner);
    return (CFG.SUPPLY_BASE + (s.devTax[prov] + s.devProd[prov]) * CFG.SUPPLY_PER_DEV)
      * t.supply * (friendly ? CFG.SUPPLY_FRIENDLY : 1);
  }

  /** Daily attrition: over-supply, hostile ground and harsh terrain. */
  function attrition(s) {
    const men = new Map();
    for (const a of s.armies) {
      if (a.dead) continue;
      men.set(a.prov, (men.get(a.prov) || 0) + regiments(a));
    }
    for (const a of s.armies) {
      if (a.dead) continue;
      const t = TERRAIN[TERRAIN_OF[a.prov]];
      const friendly = s.control[a.prov] === a.owner || sameSide(s, s.control[a.prov], a.owner);
      const supply = (CFG.SUPPLY_BASE + (s.devTax[a.prov] + s.devProd[a.prov]) * CFG.SUPPLY_PER_DEV)
        * t.supply * (friendly ? CFG.SUPPLY_FRIENDLY : 1);
      const here = men.get(a.prov) || 0;
      let loss = t.attrition;
      if (here > supply) loss += (here - supply) / Math.max(1, supply) * CFG.ATTRITION;
      if (!friendly) loss += CFG.HOSTILE_ATTRITION;
      // Monthly rate, a thirtieth a day; men stay fractional so small daily losses are not rounded away.
      if (loss > 0) { a.men *= 1 - Math.min(0.25, loss) * DAY; syncRegiments(a); }
    }
  }

  function revolt(s, i) {
    const owner = s.owner[i];
    const core = s.coreOwner[i];
    s.unrest[i] = 0.3;
    if (core && core !== owner) {
      if (!s.alive[core]) s.alive[core] = 1;
      annex(s, i, core);
      note(s, `${W.nameOf(i)} rises and returns to ${W.nation(core).name}.`,
        owner === s.player ? 'bad' : 'info', core);
    } else {
      s.pop[i] *= 0.95;
      s.devTax[i] = Math.max(1, s.devTax[i] - 1);
    }
  }

  function yearly(s) {
    for (const id of W.nations()) {
      s.ae[id] = Math.max(0, s.ae[id] - CFG.AE_DECAY * 12);
      s.prestige[id] *= 0.96;
      s.stability[id] = clamp(s.stability[id] + 0.1, -3, 3);
      for (const other of W.nations()) {
        const k = id * 256 + other;
        if (s.opinion[k] > 0) s.opinion[k] = Math.max(0, s.opinion[k] - CFG.OPINION_DECAY);
        else if (s.opinion[k] < 0) s.opinion[k] = Math.min(0, s.opinion[k] + CFG.OPINION_DECAY);
      }
      if (s.bankruptUntil[id] && s.day > s.bankruptUntil[id]) s.bankruptUntil[id] = 0;
      // Aggressive expansion frightens the neighbours.
      if (s.ae[id] > 10) {
        for (const other of W.nations()) if (other !== id && s.alive[other]) addOp(s, other, id, -Math.round(s.ae[id] / 12));
      }
    }
  }

  global.Engine = {
    CFG, BUILDINGS, TERRAIN, CB,
    prepare, newGame, tick,
    // dates
    year, month, dayOfMonth, dateString,
    // economy
    economy, refreshEconomy, provinceIncome, devCost, develop, canBuild, construct, hasBuilding,
    buildingCount, takeLoan, repayLoan,
    // army
    recruit, recruitCost, createArmy, orderMove, armiesAt, armiesOf, regiments, maxMen, findPath, edgeDays,
    indexArmies,
    // war
    canDeclare, declareWar, warBetween, warsOf, atWarWith, warScore, recomputeOccupation,
    provinceCost, demandCost, peaceCost, wouldAccept, makePeace, annex,
    // diplomacy
    canAlly, allianceChance, proposeAlliance, formAlliance, breakAlliance, insult, fabricateClaim,
    royalMarriage, guarantee, giveProvince, coalitionAgainst, op, addOp, truceLeft, setTruce,
    // helpers
    supplyLimit,
    terrainOf: (i) => TERRAIN[TERRAIN_OF[i]],
    terrainIndex: (i) => TERRAIN_OF[i],
    coastal: (i) => COASTAL[i],
    riverShare: (i) => RIVER[i],
    seaLinks: (i) => SEA_LINKS[i] || [],
    moveDays: (i) => MOVE_DAYS[i],
    note, rand, sameSide, ownsAnything, ownedBy,
  };
})(typeof window !== 'undefined' ? window : globalThis);
