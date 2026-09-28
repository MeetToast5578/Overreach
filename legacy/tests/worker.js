/* Overreach acceptance suites, run in a Web Worker so the page stays responsive.
 *
 * Loads the real game files unchanged. Suites: world, economy, battles, sieges,
 * war, ai (years, seed), bugs. The bugs suite asserts the fixed behaviour of
 * known defects, so it is expected to fail until each fix lands.
 */
self.window = self;
// Cache-busted so a test run always sees the files on disk.
const BUST = '?v=' + Date.now();
importScripts(...['../data/mapdata.js', '../world.js', '../engine.js', '../ai.js'].map((f) => f + BUST));
const MD = self.MAPDATA, W = self.World, E = self.Engine, AIx = self.AI;

const post = (m) => self.postMessage(m);
const log = (text) => post({ type: 'log', text });
let suite = '';
function check(name, ok, detail) {
  post({ type: 'check', suite, name, ok: !!ok, detail: detail == null ? '' : String(detail) });
}

// ------------------------------------------------------------------ setup
let PROVPX = null, TERR = null, buildInfo = null, buildMs = 0;
async function pixels(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(MD.w, MD.h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, MD.w, MD.h).data;
}
async function setup() {
  if (buildInfo) return;
  const n = MD.w * MD.h;
  const a = await pixels('../data/provinces.png');
  PROVPX = new Uint16Array(n);
  for (let i = 0; i < n; i++) PROVPX[i] = (a[i * 4] << 8) | a[i * 4 + 1];
  const b = await pixels('../data/terrain.png');
  TERR = new Uint8Array(n);
  for (let i = 0; i < n; i++) TERR[i] = Math.round(b[i * 4] / 50);
  const t0 = performance.now();
  buildInfo = W.build(MD, PROVPX, TERR, MD.w, MD.h);
  buildMs = performance.now() - t0;
  E.prepare();
  log(`World built: ${buildInfo.provinces} provinces, ${buildInfo.regions} regions in ${Math.round(buildMs)}ms`);
}

// ---------------------------------------------------------------- helpers
const natId = (name) => MD.nations.find((n) => n.name === name).id;
const natName = (id) => (W.nation(id) ? W.nation(id).name : '#' + id);
const devOf = (s, i) => s.devTax[i] + s.devProd[i] + s.devMan[i];
const fresh = (seed) => E.newGame({ seed: seed || 'test', player: 0 });
function run(s, days, ai) {
  for (let d = 0; d < days; d++) { E.tick(s); if (ai) AIx.tick(s); }
}
const sgnf = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
function hexDist(a, b) {
  let d = 0;
  for (let k = 1; k < 7; k += 2) d += Math.abs(parseInt(a.substr(k, 2), 16) - parseInt(b.substr(k, 2), 16));
  return d;
}

/** Two adjacent nations of decent size, and a quiet plains province of B's
 *  (not the capital, with B land around it) to fight over. */
function pickPair(skip) {
  const big = (id) => W.provincesOf(id).length >= 15;
  for (let i = 1; i <= W.count(); i++) {
    const b = W.nationOf(i);
    if (!big(b) || (skip && skip.has(b)) || W.capital(b) === i || E.terrainIndex(i) !== 0) continue;
    let a = 0, own = 0;
    for (const n of W.neighbours(i)) {
      const o = W.nationOf(n);
      if (o === b) own++;
      else if (!a && big(o) && !(skip && skip.has(o))) a = o;
    }
    if (a && own >= 2) return { A: a, B: b, p: i };
  }
  return null;
}
let PAIR = null;
function arena(seed) {
  const s = fresh(seed || 'arena');
  if (!PAIR) PAIR = pickPair();
  const { A, B, p } = PAIR;
  s.armies = []; s.byProv = null;
  s.fort[p] = 0;
  const r = E.declareWar(s, A, B, 'none', p);
  return { s, A, B, p, w: r.war };
}
function lastWinner(s, from) {
  for (let k = s.log.length - 1; k >= from; k--) {
    const m = /^(.*) wins the battle of /.exec(s.log[k].text);
    if (m) return m[1];
  }
  return null;
}
function fight(regA, regB, seed) {
  const { s, A, B, p } = arena(seed);
  const a = E.createArmy(s, A, p, { inf: regA });
  const b = E.createArmy(s, B, p, { inf: regB });
  const from = s.log.length;
  let days = 0, started = false;
  for (; days < 120; days++) {
    E.tick(s);
    if (a.battle || b.battle) started = true;
    if (started && !a.battle && !b.battle) break;
  }
  const w = lastWinner(s, from);
  const winner = w === natName(A) ? 'A' : w === natName(B) ? 'B' : null;
  return { s, A, B, p, a, b, winner, days: days + 1 };
}
function siegeDays(fort, inf, art, seed) {
  const { s, A, B, p } = arena(seed);
  s.fort[p] = fort;
  E.createArmy(s, A, p, { inf, art });
  for (let d = 1; d <= 1000; d++) {
    E.tick(s);
    if (s.control[p] === A) return { days: d, owner: s.owner[p], s, A, B, p };
  }
  return { days: Infinity, owner: s.owner[p], s, A, B, p };
}

// ------------------------------------------------------------------ world
function worldSuite() {
  const { N, W: WW } = W.dims(), PROV = W.prov(), count = W.count();
  let unassigned = 0, onWater = 0;
  for (let p = 0; p < N; p++) {
    const land = TERR[p] === 1 || TERR[p] === 2;
    if (land && !PROV[p]) unassigned++;
    if (!land && PROV[p]) onWater++;
  }
  check('Every land pixel is in exactly one province', !unassigned && !onWater,
    `${unassigned} unassigned, ${onWater} on water or ice`);

  // Nations -> regions -> provinces.
  const badReg = [];
  for (let i = 1; i <= count; i++) if (W.region(W.regionOf(i)).nation !== W.nationOf(i)) badReg.push(i);
  check('Every province lies in one region of its own nation', !badReg.length, `${badReg.length} misfiled`);
  const perRegion = W.regions().map((r) => W.regionProvinces(r.id).length).sort((a, b) => a - b);
  const median = perRegion[perRegion.length >> 1];
  check('Regions hold a handful of provinces each', !perRegion.includes(0) && median >= 2 && median <= 6
    && perRegion[perRegion.length - 1] <= 14,
    `${perRegion.length} regions; median ${median}, max ${perRegion[perRegion.length - 1]} provinces`);

  // The shipped adjacency agrees with the pixels.
  let missing = 0;
  for (let p = 0; p < N - 1; p++) {
    const a = PROV[p], b = PROV[p + 1];
    if (a && b && a !== b && (p + 1) % WW && !W.neighbours(a).includes(b)) missing++;
  }
  check('Adjacency matches the map', !missing, `${missing} touching pairs not listed`);

  const noProv = W.nations().filter((id) => !W.provincesOf(id).length);
  check('Every nation has a province', !noProv.length, noProv.map(natName).join(', ') || `${W.nations().length} nations`);
  const badCap = W.nations().filter((id) => W.provincesOf(id).length && W.nationOf(W.capital(id)) !== id);
  check('Every capital is inside its own nation', !badCap.length, badCap.map(natName).join(', '));

  let asym = 0;
  for (let i = 1; i <= count; i++) for (const n of W.neighbours(i)) if (!W.neighbours(n).includes(i)) asym++;
  check('Adjacency is symmetric', !asym, `${asym} one-way links`);

  let worst = Infinity, worstPair = '';
  for (let i = 1; i <= count; i++) {
    const a = W.nationOf(i);
    for (const n of W.neighbours(i)) {
      const b = W.nationOf(n);
      if (a >= b) continue;
      const d = hexDist(W.colour(a), W.colour(b));
      if (d < worst) { worst = d; worstPair = `${natName(a)} / ${natName(b)}`; }
    }
  }
  // Channel-sum distance undersells hue shifts: #4444a7 vs #44a7a7 scores 99 yet
  // reads plainly as blue against teal on the map.
  check('Neighbouring nations have clearly different colours', worst >= 90, `worst ${worst} of 765 (${worstPair})`);

  // Towns: most provinces are named for one, and it sits inside the province.
  let towns = 0, strays = 0;
  for (let i = 1; i <= count; i++) {
    if (!W.cityOf(i)) continue;
    towns++;
    const [x, y] = W.cityPx(i);
    let ok = false;
    for (let dy = -4; dy <= 4 && !ok; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const yy = Math.round(y) + dy, xx = (Math.round(x) + dx + WW) % WW;
        if (yy >= 0 && yy < W.dims().H && PROV[yy * WW + xx] === i) { ok = true; break; }
      }
    }
    if (!ok) strays++;
  }
  check('Most provinces have a town, inside the province', towns >= count * 0.8 && !strays,
    `${towns} of ${count} have a town; ${strays} outside`);

  // Istanbul faces Asia across the Bosphorus: a short strait crossing, not open sea.
  let ist = 0;
  for (let i = 1; i <= count; i++) if (W.cityOf(i) && W.cityOf(i).name === 'Istanbul') ist = i;
  const across = ist ? W.seaLinks(ist).filter((j) => W.isStrait(ist, j) && W.cityPx(j)[0] > W.cityPx(ist)[0]) : [];
  check('The Bosphorus is a strait crossing', ist && across.length,
    ist ? `${W.nameOf(ist)} ↔ ${across.map((j) => W.nameOf(j)).join(', ') || 'nothing'}` : 'no Istanbul');

  let empty = 0;
  for (let i = 1; i <= count; i++) if (!W.sizeOf(i) || !W.nameOf(i)) empty++;
  check('Province count is sane and none is empty', count >= 4500 && count <= 6000 && !empty, `${count} provinces, ${empty} empty`);
  check('World indexes in under 3s', buildMs < 3000, `${Math.round(buildMs)}ms at ${WW}px`);
}

// ---------------------------------------------------------------- economy
function economySuite() {
  const s = fresh('economy');
  const broke = [];
  for (const id of W.nations()) {
    const e = E.economy(s, id);
    if (s.treasury[id] < 0 || e.net < 0) broke.push(natName(id));
  }
  check('Every nation starts solvent', !broke.length, broke.slice(0, 8).join(', ') || 'all 241');

  const fr = natId('France'), cap = s.capital[fr];
  s.treasury[fr] = 1e6;
  const c0 = E.devCost(s, cap, 'tax');
  E.develop(s, fr, cap, 'tax');
  const c1 = E.devCost(s, cap, 'tax');
  check('Development gets dearer as it rises', c1 > c0, `${c0} → ${c1}`);

  const i0 = E.provinceIncome(s, cap);
  E.construct(s, fr, cap, 0);
  const i1 = E.provinceIncome(s, cap);
  check('A marketplace raises province income', i1 > i0, `${i0.toFixed(3)} → ${i1.toFixed(3)}`);

  // The world updates every day: money and manpower move on ordinary days, not only at month end.
  const d = fresh('daily');
  const rs = natId('Russia');
  d.manpower[rs] *= 0.5;
  const t0v = d.treasury[rs], m0 = d.manpower[rs];
  run(d, 3, false);                                    // days 1-3, nowhere near a month end
  const perMonth = E.economy(d, rs).net;
  check('The treasury and manpower change every day', d.treasury[rs] !== t0v && d.manpower[rs] > m0
    && Math.abs((d.treasury[rs] - t0v) - perMonth * 3 / 30) < Math.abs(perMonth) * 0.05 + 0.01,
    `3 days: treasury ${sgnf(d.treasury[rs] - t0v)} (a month is ${sgnf(perMonth)}), manpower +${Math.round(d.manpower[rs] - m0)}`);

  const t = fresh('century');
  const from = t.log.length;
  const t0 = performance.now();
  run(t, 36000, false);
  const ms = (performance.now() - t0) / 36000;
  const bankrupt = new Set();
  for (let k = from; k < t.log.length; k++) {
    const m = /^(.*) declares bankruptcy\./.exec(t.log[k].text);
    if (m) bankrupt.add(m[1]);
  }
  let pop = 0;
  for (let i = 1; i <= W.count(); i++) pop += t.pop[i];
  check('A century passes without mass bankruptcy', bankrupt.size < 12, `${bankrupt.size} nations went bankrupt (log keeps last 500 entries)`);
  check('World population settles in a sane range', pop > 2e9 && pop < 15e9, `${(pop / 1e9).toFixed(2)}bn after 100 years · ${ms.toFixed(2)}ms/day engine only`);
}

// ---------------------------------------------------------------- battles
function battleSuite() {
  let bigWins = 0;
  for (let k = 0; k < 6; k++) if (fight(24, 12, 'big' + k).winner === 'A') bigWins++;
  check('The bigger army wins', bigWins >= 5, `${bigWins} of 6 (24 vs 12 regiments)`);

  let evenA = 0, decided = 0, evenDays = 0;
  for (let k = 0; k < 12; k++) {
    const r = fight(12, 12, 'even' + k);
    if (r.winner) decided++;
    if (r.winner === 'A') evenA++;
    evenDays += r.days;
  }
  check('[#35] Even armies are a coin toss', decided === 12 && evenA >= 3 && evenA <= 9,
    `attacker won ${evenA} of 12, battles lasted ${(evenDays / 12).toFixed(1)} days on average`);
  check('[#35] An even battle lasts several days', evenDays / 12 >= 5 && evenDays / 12 <= 15,
    `${(evenDays / 12).toFixed(1)} days on average`);

  const r = fight(20, 12, 'rout');
  const loser = r.winner === 'A' ? r.b : r.a;
  check('The loser routs rather than dies', r.winner && !loser.dead && loser.men > 0 && loser.prov !== r.p,
    `loser keeps ${loser.men} men, moved ${loser.prov !== r.p}`);
  check('Battles take days, not a single roll', r.days > 1, `${r.days} days`);

  // Combat width: past 20 regiments, extra men add depth but not damage. Compare
  // two armies that both stay wider than the front, since a 20-regiment army
  // loses regiments and so front as it takes casualties.
  const loss = (regA) => {
    const { s, A, B, p } = arena('width');
    E.createArmy(s, A, p, { inf: regA });
    const b = E.createArmy(s, B, p, { inf: 20 });
    const before = b.men;
    E.tick(s); E.tick(s);
    return before - b.men;
  };
  const l40 = loss(40), l60 = loss(60);
  check('Combat width caps the damage a huge army deals', Math.abs(l60 - l40) <= l40 * 0.01,
    `40 regiments: ${Math.round(l40)} · 60 regiments: ${Math.round(l60)} men killed in two days`);
}

// ----------------------------------------------------------------- sieges
function siegeSuite() {
  const f1 = siegeDays(1, 12, 0, 's1'), f4 = siegeDays(4, 20, 0, 's4'), guns = siegeDays(1, 10, 10, 'sg');
  const f0 = siegeDays(0, 6, 0, 's0');
  check('Higher forts hold out longer', f4.days > f1.days && f1.days > f0.days,
    `fort 0: ${f0.days}d · fort 1: ${f1.days}d · fort 4: ${f4.days}d`);
  check('Artillery shortens a siege', guns.days < f1.days, `fort 1 with ten guns: ${guns.days}d`);
  check('Occupation never transfers ownership', f1.owner === f1.B && f4.owner === f4.B && guns.owner === guns.B);

  // Relief: a much larger defending army arrives mid-siege.
  const { s, A, B, p } = arena('relief');
  s.fort[p] = 2;
  E.createArmy(s, A, p, { inf: 8 });
  run(s, 20, false);
  const started = s.siegeBy[p] === A && s.siege[p] > 0;
  E.createArmy(s, B, p, { inf: 30 });
  run(s, 40, false);
  check('A relief army lifts a siege', started && s.siegeBy[p] !== A && s.control[p] === B,
    `siege started ${started}, besieger now ${natName(s.siegeBy[p]) || 'none'}`);
}

// -------------------------------------------------------------------- war
function warSuite() {
  const s = fresh('war');
  if (!PAIR) PAIR = pickPair();
  const { A, B, p } = PAIR;
  const refused = E.canDeclare(s, A, B, 'conquest');
  s.treasury[A] = 1000;
  E.fabricateClaim(s, A, p);
  const allowed = E.canDeclare(s, A, B, 'conquest');
  check('A conquest needs a claim', refused && allowed === null, `without: "${refused}" · with: ${allowed === null ? 'allowed' : allowed}`);

  const w = E.declareWar(s, A, B, 'conquest', p).war;
  const bp = Array.from(E.ownedBy(s, B)).filter((i) => i !== s.capital[B]).slice(0, 6);
  const sc0 = E.warScore(s, w);
  for (const i of bp) s.control[i] = A;
  E.recomputeOccupation(s, w);
  const sc1 = E.warScore(s, w);
  check('Occupation drives war score', sc1 > sc0, `${sc0.toFixed(1)} → ${sc1.toFixed(1)}`);

  const greedy = Array.from(E.ownedBy(s, B)).slice(0, 40).map((i) => ({ kind: 'province', prov: i }));
  check('Over-large demands are refused', !E.wouldAccept(s, w, greedy, A), `${greedy.length} provinces for score ${sc1.toFixed(0)}`);

  // Demand the cheapest occupied province; the other two stay with their owner.
  const occ = bp.slice().sort((x, y) => E.provinceCost(s, w, x, A) - E.provinceCost(s, w, y, A));
  const demand = [{ kind: 'province', prov: occ[0] }];
  const accept = E.wouldAccept(s, w, demand, A);
  E.makePeace(s, w, A, demand);
  const moved = s.owner[occ[0]] === A && s.owner[occ[1]] === B && s.owner[occ[2]] === B;
  check('Peace transfers exactly what was demanded and ends the war', accept && moved && w.done && !E.atWarWith(s, A, B),
    `accepted ${accept} (cost ${E.peaceCost(s, w, demand, A)} vs score ${E.warScore(s, w).toFixed(1)}), transferred ${moved}, war over ${w.done}`);
  const truce = E.canDeclare(s, A, B, 'none');
  check('Truces are enforced', truce && /truce/.test(truce), truce);

  const t = fresh('white');
  const w2 = E.declareWar(t, A, B, 'none', p).war;
  check('An even war can end in white peace', E.wouldAccept(t, w2, [], A));
}

// --------------------------------------------------------------------- ai
function shareTable(s) {
  const land = new Float64Array(256);
  for (let i = 1; i <= W.count(); i++) land[s.owner[i]] += W.sizeOf(i);
  const total = W.totalLand();
  return W.nations().map((id) => ({ id, name: natName(id), share: 100 * land[id] / total, provs: E.ownedBy(s, id).size }))
    .sort((a, b) => b.share - a.share);
}
function aiSuite(years, seed) {
  years = years || 60; seed = seed || '1836';
  const s = fresh(seed);
  AIx.init(s);
  const start = shareTable(s);
  const startShare = new Map(start.map((r) => [r.id, r.share]));
  const days = years * 360;
  const t0 = performance.now();
  for (let d = 1; d <= days; d++) {
    E.tick(s); AIx.tick(s);
    if (d % 3600 === 0) {
      const top = shareTable(s).slice(0, 5).map((r) => `${r.name} ${r.share.toFixed(1)}%`).join(', ');
      log(`year ${d / 360}: ${s.stats.wars} wars, ${s.stats.peaces} peaces, ${s.stats.annexed} transfers · ${top}`);
    }
  }
  const ms = (performance.now() - t0) / days;
  const end = shareTable(s);
  const allWars = new Map();
  for (const w of (s.warHistory || []).concat(s.wars)) allWars.set(w.id, w);
  const ended = [...allWars.values()].filter((w) => w.done && w.endDay != null);
  const avgYears = ended.length ? ended.reduce((t, w) => t + (w.endDay - w.start), 0) / ended.length / 360 : 0;
  let alive = 0, alliances = 0, moved = 0;
  for (const id of W.nations()) { if (s.alive[id]) alive++; alliances += s.allies[id].size; }
  for (let i = 1; i <= W.count(); i++) if (s.owner[i] !== W.nationOf(i)) moved++;
  alliances /= 2;
  const perYear = s.stats.wars / years;

  check('Wars start regularly', perYear >= 5, `${s.stats.wars} wars in ${years} years`);
  check('Over half of wars end at a table', s.stats.peaces > s.stats.wars * 0.5, `${s.stats.peaces} peaces`);
  check('An average war lasts one to four years', avgYears >= 1 && avgYears <= 4, `${avgYears.toFixed(2)} years`);
  check('Battles and sieges both happen', s.stats.battles > 0 && s.stats.sieges > 0, `${s.stats.battles} battles, ${s.stats.sieges} sieges`);
  check('Land changes hands', s.stats.annexed > years * 3, `${s.stats.annexed} transfers, ${moved} provinces not with their 1836 owner`);
  check('No nation exceeds 45% of the world', end[0].share < 45, `${end[0].name} ${end[0].share.toFixed(1)}%`);
  check('60+ nations survive', alive >= 60, `${alive} alive`);
  check('Alliances form', alliances > 0, `${alliances} alliances standing`);
  check('Under 10ms per simulated day', ms < 10, `${ms.toFixed(2)}ms`);

  const top = start.slice(0, 10).map((r) => {
    const now = end.find((x) => x.id === r.id);
    return { name: r.name, start: +r.share.toFixed(2), end: +now.share.toFixed(2), provsStart: r.provs, provsEnd: now.provs };
  });
  const risers = end.slice(0, 10).map((r) => ({ name: r.name, start: +startShare.get(r.id).toFixed(2), end: +r.share.toFixed(2) }));
  post({ type: 'stats', key: `ai:${seed}:${years}`, stats: {
    seed, years, wars: s.stats.wars, peaces: s.stats.peaces, battles: s.stats.battles, sieges: s.stats.sieges,
    transfers: s.stats.annexed, provincesMoved: moved, alive, destroyed: W.nations().length - alive, alliances,
    avgWarYears: +avgYears.toFixed(2), msPerDay: +ms.toFixed(2), greatPowers: top, largestAtEnd: risers,
  } });
}

// ------------------------------------------------------------------- bugs
function bugsSuite() {
  // #1 — a peace in one war must not undo occupations in another.
  {
    if (!PAIR) PAIR = pickPair();
    const { A, B } = PAIR;
    const other = pickPair(new Set([A, B]));
    const s = fresh('bug1');
    const w1 = E.declareWar(s, A, B, 'none', 0).war;
    E.declareWar(s, other.A, other.B, 'none', other.p);
    s.control[other.p] = other.A;
    E.makePeace(s, w1, A, []);
    check('[#1] Peace in one war leaves other wars\' occupations alone', s.control[other.p] === other.A,
      `${W.nameOf(other.p)} is held by ${natName(s.control[other.p])}, should be ${natName(other.A)}`);
  }
  // #1 follow-on — at peace, an army standing in its former enemy's land goes home.
  {
    const { A, B, p } = PAIR;
    const s = fresh('bug1b');
    const w = E.declareWar(s, A, B, 'none', 0).war;
    const a = E.createArmy(s, A, p, { inf: 5 });
    s.control[p] = A;
    E.makePeace(s, w, A, []);
    check('[#1] At peace, armies leave their former enemy\'s land', s.control[p] === B && s.owner[a.prov] !== B && !a.dead,
      `army now in ${W.nameOf(a.prov)} (${natName(s.owner[a.prov])}), ${W.nameOf(p)} held by ${natName(s.control[p])}`);
  }
  // #8 and #10 — a war leader wiped off the map.
  {
    const { A, B } = PAIR;
    const s = fresh('bug8');
    const w = E.declareWar(s, A, B, 'none', 0).war;
    const third = W.nations().find((id) => id !== A && id !== B && !w.attackers.has(id) && !w.defenders.has(id) && W.provincesOf(id).length > 3);
    for (const i of Array.from(E.ownedBy(s, B))) E.annex(s, i, third);
    run(s, 2, false);
    const dead = !s.alive[B];
    check('[#8] A war ends or passes on when its leader is destroyed', dead && (w.done || s.alive[w.leadB]),
      `${natName(B)} alive ${!dead}, war open ${!w.done}`);
    const left = E.armiesOf(s, B).filter((a) => !a.dead).length;
    check('[#10] A destroyed nation\'s armies disband', dead && !left, `${left} armies still standing`);
  }
  // #9 — marches take the quickest route, not the fewest hops.
  {
    const s = fresh('bug9');
    const nats = ['Russia', 'United States of America', 'China', 'Brazil', 'Canada', 'Australia', 'India', 'Indonesia'].map(natId);
    const costOf = (from, path) => {
      let t = 0, prev = from;
      for (const q of path) { t += E.edgeDays(s, prev, q); prev = q; }
      return t;
    };
    const optimal = (from, to, owner) => {
      const dist = new Map([[from, 0]]), done = new Set();
      const heap = [[0, from]];
      while (heap.length) {
        let bi = 0;
        for (let k = 1; k < heap.length; k++) if (heap[k][0] < heap[bi][0]) bi = k;
        const [d, u] = heap.splice(bi, 1)[0];
        if (done.has(u)) continue;
        done.add(u);
        if (u === to) return d;
        const nb = W.neighbours(u);
        for (const v of nb) if (s.owner[v] === owner && !done.has(v)) {
          const nd = d + E.edgeDays(s, u, v);
          if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); heap.push([nd, v]); }
        }
        for (const v of E.seaLinks(u)) if (!nb.includes(v) && s.owner[v] === owner && !done.has(v)) {
          const nd = d + E.edgeDays(s, u, v);
          if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); heap.push([nd, v]); }
        }
      }
      return Infinity;
    };
    let worst = 1, worstNote = '', missing = 0, tried = 0;
    for (const id of nats) {
      const ps = Array.from(W.provincesOf(id));
      for (let k = 0; k < 3; k++) {
        const from = ps[(k * 7919) % ps.length], to = ps[(k * 104729 + ps.length >> 1) % ps.length];
        if (from === to) continue;
        const best = optimal(from, to, id);
        if (!isFinite(best)) continue;
        tried++;
        const path = E.findPath(s, from, to, id);
        if (!path) { missing++; continue; }
        const r = costOf(from, path) / best;
        if (r > worst) { worst = r; worstNote = `${natName(id)}: ${W.nameOf(from)} → ${W.nameOf(to)}`; }
      }
    }
    check('[#9] Marches take the quickest route', worst <= 1.05 && !missing,
      `${tried} routes, ${missing} not found, worst ${(worst * 100 - 100).toFixed(0)}% slower than best${worstNote ? ' (' + worstNote + ')' : ''}`);
  }
}

// -------------------------------------------------------------- diagnosis
/** Why do the largest nations neither grow nor shrink? Follow the top six
 *  through every war they fight. Reports, asserts nothing. */
function powersDiag(years, seed) {
  years = years || 30; seed = seed || '1836';
  const s = fresh(seed);
  AIx.init(s);
  const top = shareTable(s).filter((r) => r.name !== 'Greenland').slice(0, 6).map((r) => r.id);
  const R = new Map(top.map((id) => [id, {
    name: natName(id), attacked: 0, defended: 0, wonProv: 0, lostProv: 0, whitePeace: 0,
    peakOcc: 0, peakOccOf: 0, regSum: 0, flSum: 0, samples: 0, loansMax: 0, warDays: 0, battlesWon: 0, battlesLost: 0,
  }]));
  const seen = new Set();
  const ownerBefore = new Map();
  const fromLog = s.log.length;
  for (let d = 1; d <= years * 360; d++) {
    E.tick(s); AIx.tick(s);
    for (const w of s.wars) {
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      for (const id of top) {
        if (w.leadA === id) R.get(id).attacked++;
        if (w.defenders.has(id)) R.get(id).defended++;
      }
    }
    if (d % 30 === 0) {
      for (const id of top) {
        const r = R.get(id), e = E.economy(s, id);
        r.regSum += e.regiments; r.flSum += e.forceLimit; r.samples++;
        r.loansMax = Math.max(r.loansMax, s.loans[id]);
        if (E.warsOf(s, id).length) r.warDays += 30;
        // How much of its enemies' land does it hold right now?
        let occ = 0, total = 0;
        for (const w of E.warsOf(s, id)) {
          const foes = w.attackers.has(id) ? w.defenders : w.attackers;
          for (const f of foes) for (const p of E.ownedBy(s, f)) { total++; if (s.control[p] === id) occ++; }
        }
        if (occ > r.peakOcc) { r.peakOcc = occ; r.peakOccOf = total; }
      }
    }
  }
  for (let k = fromLog; k < s.log.length; k++) {
    const t = s.log[k].text;
    for (const id of top) {
      const n = natName(id);
      if (t.startsWith(n + ' wins the battle')) R.get(id).battlesWon++;
    }
  }
  for (let i = 1; i <= W.count(); i++) {
    const was = W.nationOf(i), now = s.owner[i];
    if (was === now) continue;
    if (R.has(now)) R.get(now).wonProv++;
    if (R.has(was)) R.get(was).lostProv++;
  }
  const rows = [...R.values()].map((r) => ({
    name: r.name, warsStarted: r.attacked, warsDefended: r.defended, yearsAtWar: +(r.warDays / 360).toFixed(1),
    provincesGainedNet: r.wonProv, provincesLost: r.lostProv, peakOccupied: `${r.peakOcc} of ${r.peakOccOf}`,
    armyVsLimit: `${Math.round(r.regSum / r.samples)} / ${Math.round(r.flSum / r.samples)}`, maxLoans: r.loansMax,
    battlesWon: r.battlesWon,
  }));
  post({ type: 'stats', key: `powers:${seed}:${years}`, stats: rows });
}

// ----------------------------------------------------------------- driver
const SUITES = { world: worldSuite, economy: economySuite, battles: battleSuite, sieges: siegeSuite, war: warSuite, ai: aiSuite, bugs: bugsSuite, powers: powersDiag };
self.onmessage = async (e) => {
  const { name, args } = e.data;
  try {
    await setup();
    suite = name;
    const t0 = performance.now();
    SUITES[name](...(args || []));
    post({ type: 'done', suite: name, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    post({ type: 'error', suite: name, text: String(err && err.stack || err) });
  }
};
