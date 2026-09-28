/* Overreach — the AI.
 *
 * Nations are evaluated on a rota so the daily cost stays flat. Each one runs
 * its economy, moves its armies, decides whether to start a war, and decides
 * whether to end one. Wars are fought with intent: concentrate, take the field,
 * besiege what you mean to keep, and sue for peace when the score says so.
 */
(function (global) {
  'use strict';

  const W = global.World, E = global.Engine;

  const AI = {
    ROTA_DAYS: 24,            // every nation gets a turn this often
    RECRUIT_FILL: 0.92,       // recruit up to this share of the force limit
    WAR_FILL: 1.0,
    TREASURY_FLOOR: 60,       // never spend below this
    DEV_BUDGET: 320,          // start developing above this
    BUILD_BUDGET: 420,
    ATTACK_EDGE: 1.15,        // only seek battle at this strength advantage
    AVOID_EDGE: 0.72,         // below this, retreat rather than fight
    TARGET_EDGE: 1.45,        // strength ratio needed to start a war
    AE_CAUTION: 55,           // stop expanding above this aggressive expansion
    PEACE_MIN_SCORE: 12,      // enough score to bother demanding something
    GIVE_UP_SCORE: -35,       // concede below this
    WAR_MIN_DAYS: 180,
    PERSONALITIES: ['expansionist', 'opportunist', 'builder', 'defensive'],
  };

  /** Cheap strength number for comparing nations, cached for the day. */
  function power(s, id) {
    if (s.ai.powerDay !== s.day) {
      s.ai.powerDay = s.day;
      const men = new Float64Array(256);
      for (const a of s.armies) if (!a.dead) men[a.owner] += a.men;
      s.ai.men = men;
      s.ai.power = new Float64Array(256);
      for (const n of W.nations()) {
        s.ai.power[n] = men[n] + E.economy(s, n).dev * 40 + s.manpower[n] * 0.25;
      }
    }
    return s.ai.power[id];
  }
  const armyMen = (s, id) => {
    let m = 0;
    for (const a of s.armies) if (!a.dead && a.owner === id) m += a.men;
    return m;
  };

  function init(s) {
    s.ai = { rota: 0, trait: new Uint8Array(256), offers: [], nbCache: new Map(), powerDay: -1 };
    for (const id of W.nations()) {
      s.ai.trait[id] = Math.floor(E.rand(s) * AI.PERSONALITIES.length);
    }
  }

  function tick(s) {
    if (!s.ai) init(s);
    const ids = W.nations();
    const perDay = Math.ceil(ids.length / AI.ROTA_DAYS);
    for (let k = 0; k < perDay; k++) {
      const id = ids[s.ai.rota % ids.length];
      s.ai.rota++;
      if (id !== s.player && s.alive[id]) nationTurn(s, id);
    }
    // Armies at war need orders often, but staggered: a third of the warring
    // nations each day rather than every one of them at once.
    const slice = s.day % 3;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      if (id === s.player || !s.alive[id] || k % 3 !== slice) continue;
      if (E.warsOf(s, id).length) moveArmies(s, id);
    }
    s.ai.offers = s.ai.offers.filter((o) => s.day - o.day < 120
      && (o.kind !== 'peace' || s.wars.some((w) => w.id === o.war && !w.done)));
  }

  function nationTurn(s, id) {
    const wars = E.warsOf(s, id);
    runEconomy(s, id, wars.length > 0);
    if (wars.length) {
      for (const w of wars) considerPeace(s, id, w);
      moveArmies(s, id);
    } else {
      diplomacy(s, id);
      considerWar(s, id);
      moveArmies(s, id);
    }
  }

  // --------------------------------------------------------------- economy
  function runEconomy(s, id, atWar) {
    let e = E.economy(s, id);
    while (s.treasury[id] > 260 && s.loans[id] > 0) E.repayLoan(s, id);
    if (e.net < 0 && s.loans[id] > 6) return;              // stop digging

    // Recruit toward the force limit. The batch scales with the country, or a
    // great power would need decades to fill an army it can already afford.
    const want = e.forceLimit * (atWar ? AI.WAR_FILL : AI.RECRUIT_FILL);
    const PER_REG = 0.65 * E.CFG.COST_INF + 0.15 * E.CFG.COST_CAV + 0.2 * E.CFG.COST_ART;
    let guard = 0;
    while (e.regiments < want && s.treasury[id] > AI.TREASURY_FLOOR && guard++ < 12) {
      const gap = Math.max(1, Math.floor(want - e.regiments));
      const pace = Math.ceil(e.forceLimit * (atWar ? 0.12 : 0.06));
      // Buy what the treasury can actually cover. Sizing the batch by force
      // limit alone made large nations quit before raising a single regiment.
      const affordable = Math.floor((s.treasury[id] - AI.TREASURY_FLOOR) / PER_REG);
      const batch = Math.min(gap, pace, affordable);
      if (batch < 1) break;
      const mix = {
        inf: Math.max(1, Math.round(batch * 0.65)),
        cav: Math.round(batch * 0.15),
        art: Math.round(batch * 0.2),
      };
      const cost = E.recruitCost(mix);
      const men = (mix.inf + mix.cav + mix.art) * E.CFG.MEN_PER_REGIMENT;
      if (s.treasury[id] - cost < AI.TREASURY_FLOOR || s.manpower[id] < men) break;
      const where = s.owner[s.capital[id]] === id ? s.capital[id] : firstOwned(s, id);
      if (!where || !E.recruit(s, id, where, mix)) break;
      E.refreshEconomy(s);
      e = E.economy(s, id);
    }
    if (atWar) return;

    const trait = AI.PERSONALITIES[s.ai.trait[id]];
    const budget = trait === 'builder' ? AI.DEV_BUDGET * 0.6 : AI.DEV_BUDGET;
    // Guns before butter: do not develop while the army is a token force, or
    // the treasury never accumulates enough to raise one.
    e = E.economy(s, id);
    if (trait !== 'builder' && e.regiments < e.forceLimit * 0.45) return;
    // Spend down the surplus rather than hoarding it for a century.
    let spend = 0;
    while (s.treasury[id] > budget && spend++ < 10) {
      if (s.treasury[id] > AI.BUILD_BUDGET) {
        const p = bestBuildSite(s, id);
        if (p && E.construct(s, id, p.prov, p.b)) continue;
      }
      const prov = bestDevSite(s, id);
      if (!prov) break;
      const which = E.rand(s) < 0.45 ? 'tax' : (E.rand(s) < 0.5 ? 'prod' : 'man');
      if (!E.develop(s, id, prov, which)) break;
    }
  }

  function firstOwned(s, id) {
    for (const p of E.ownedBy(s, id)) if (s.control[p] === id) return p;
    return 0;
  }
  function ownedProvinces(s, id) {
    const out = [];
    for (const p of E.ownedBy(s, id)) if (s.control[p] === id) out.push(p);
    return out;
  }
  function bestDevSite(s, id) {
    let best = 0, bestScore = -1;
    for (const i of ownedProvinces(s, id)) {
      const score = (s.devTax[i] + s.devProd[i]) / Math.max(1, E.devCost(s, i, 'tax')) * (1 - s.unrest[i]);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
  function bestBuildSite(s, id) {
    let best = null, bestScore = 0;
    for (const i of ownedProvinces(s, id)) {
      for (let b = 0; b < E.BUILDINGS.length; b++) {
        if (!E.canBuild(s, id, i, b)) continue;
        let score = (s.devTax[i] + s.devProd[i]) / E.BUILDINGS[b].cost;
        if (b === 3) score *= borderRisk(s, id, i) ? 2.2 : 0.2;   // forts only where it matters
        if (b === 6) score *= 1 + s.unrest[i] * 2;
        if (score > bestScore) { bestScore = score; best = { prov: i, b }; }
      }
    }
    return best;
  }
  const borderRisk = (s, id, i) => Array.from(W.neighbours(i)).some((n) => s.owner[n] !== id);

  // -------------------------------------------------------------- diplomacy
  function diplomacy(s, id) {
    if (E.rand(s) > 0.2) return;
    const trait = AI.PERSONALITIES[s.ai.trait[id]];
    const neighbours = neighbourNations(s, id);
    const threat = biggestThreat(s, id, neighbours);
    // A frightened nation looks for friends; a strong one looks for clients.
    let best = 0, bestScore = 0;
    for (const n of neighbours) {
      if (!E.canAlly(s, id, n)) continue;
      // Alliances are between peers. A much weaker neighbour is prey, and a
      // much stronger one will not be held to anything.
      const ratio = power(s, id) / Math.max(1, power(s, n));
      if (ratio > 2.2 || ratio < 0.45) continue;
      let score = E.allianceChance(s, id, n) * 100;
      if (threat && (s.allies[n].has(threat) || n === threat)) score *= 0.2;
      if (trait === 'defensive') score *= 1.4;
      if (s.ae[n] > AI.AE_CAUTION) score *= 0.3;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    if (best && bestScore > 45) {
      if (best === s.player) {
        if (!s.ai.offers.some((o) => o.from === id && o.kind === 'alliance')) {
          s.ai.offers.push({ kind: 'alliance', from: id, day: s.day });
          E.note(s, `${W.nation(id).name} proposes an alliance.`, 'info', id);
        }
      } else E.proposeAlliance(s, id, best);
    }
  }

  function neighbourNations(s, id) {
    const cache = s.ai.nbCache;
    const hit = cache.get(id);
    if (hit && hit.day === s.day) return hit.list;
    const out = new Set();
    for (const i of E.ownedBy(s, id)) {
      for (const n of W.neighbours(i)) {
        const o = s.owner[n];
        if (o && o !== id) out.add(o);
      }
      for (const q of E.seaLinks(i)) {
        const o = s.owner[q];
        if (o && o !== id) out.add(o);
      }
    }
    const list = Array.from(out);
    cache.set(id, { day: s.day, list });
    return list;
  }
  function biggestThreat(s, id, neighbours) {
    let best = 0, bestP = 0;
    for (const n of neighbours || neighbourNations(s, id)) {
      const p = power(s, n);
      if (p > bestP) { bestP = p; best = n; }
    }
    return bestP > power(s, id) * 1.3 ? best : 0;
  }

  // ------------------------------------------------------------ starting wars
  function considerWar(s, id) {
    const trait = AI.PERSONALITIES[s.ai.trait[id]];
    if (trait === 'builder' && E.rand(s) < 0.7) return;
    if (trait === 'defensive' && E.rand(s) < 0.85) return;
    if (s.ae[id] > AI.AE_CAUTION) return;
    if (s.loans[id] > 4 || s.exhaustion[id] > 8) return;
    const e = E.economy(s, id);
    // Ready enough: either the army is a real share of what the country could
    // field, or it simply outweighs the neighbour being considered.
    const ready = e.regiments >= e.forceLimit * 0.35;

    const mine = power(s, id);
    let best = null, bestScore = 0;
    for (const n of neighbourNations(s, id)) {
      if (!s.alive[n] || s.overlord[n] === id) continue;
      const ratio = mine / Math.max(1, power(s, n));
      const armyEdge = s.ai.men[id] > s.ai.men[n] * 1.6;
      if (!ready && !armyEdge) continue;
      let edge = AI.TARGET_EDGE;
      if (trait === 'expansionist') edge -= 0.2;
      if (trait === 'opportunist' && E.warsOf(s, n).length) edge -= 0.35;   // kick them while down
      if (ratio < edge) continue;
      const cb = pickCB(s, id, n);
      if (!cb) continue;
      let score = ratio * (1 + E.economy(s, n).dev / Math.max(1, e.dev));
      score *= 1 + Math.max(0, -E.op(s, id, n)) / 100;
      if (s.ae[n] > E.CFG.COALITION_AE) score *= 1.6;       // contain the bully
      if (score > bestScore) { bestScore = score; best = { n, cb }; }
    }
    if (!best) { maybeFabricate(s, id); return; }
    const goal = pickWarGoal(s, id, best.n);
    E.declareWar(s, id, best.n, best.cb, goal);
  }

  /** The cheapest pretext available, preferring the ones the world forgives. */
  function pickCB(s, id, target) {
    for (const key of ['reconquest', 'conquest', 'imperial', 'humiliate']) {
      if (E.canDeclare(s, id, target, key) === null) return key;
    }
    if (E.canDeclare(s, id, target, 'none') === null && E.rand(s) < 0.12) return 'none';
    return null;
  }
  function maybeFabricate(s, id) {
    if (s.treasury[id] < E.CFG.CLAIM_COST + 200) return;
    const ns = neighbourNations(s, id);
    if (!ns.length) return;
    const target = ns[Math.floor(E.rand(s) * ns.length)];
    if (power(s, id) < power(s, target) * 0.9) return;
    for (const i of E.ownedBy(s, target)) {
      if (s.claims[id].has(i)) continue;
      if (!Array.from(W.neighbours(i)).some((n) => s.owner[n] === id)) continue;
      E.fabricateClaim(s, id, i);
      return;
    }
  }
  function pickWarGoal(s, id, target) {
    for (const i of s.claims[id]) if (s.owner[i] === target) return i;
    for (const i of E.ownedBy(s, target)) {
      if (Array.from(W.neighbours(i)).some((n) => s.owner[n] === id)) return i;
    }
    return 0;
  }

  // -------------------------------------------------------------- ending wars
  function considerPeace(s, id, w) {
    if (s.day - w.start < AI.WAR_MIN_DAYS) return;
    const iAmAttacker = w.attackers.has(id);
    if ((iAmAttacker ? w.leadA : w.leadB) !== id) return;     // only the war leader negotiates
    E.recomputeOccupation(s, w);
    const score = E.warScore(s, w) * (iAmAttacker ? 1 : -1);
    const enemy = iAmAttacker ? w.leadB : w.leadA;

    if (score >= AI.PEACE_MIN_SCORE) {
      const demands = buildDemands(s, w, id, score);
      if (!demands.length) return;
      if (enemy === s.player) {
        offerToPlayer(s, w, id, demands);
        return;
      }
      if (E.wouldAccept(s, w, demands, id)) E.makePeace(s, w, id, demands);
      return;
    }
    // Losing, exhausted, or simply stuck: take the exit. A war that has gone
    // nowhere for years is a white peace waiting to be signed.
    const years = (s.day - w.start) / 360;
    const stalemate = years > 6 && Math.abs(score) < 10;
    if (score <= AI.GIVE_UP_SCORE || (s.exhaustion[id] > 6 && score < 5) || stalemate) {
      if (enemy === s.player) { offerToPlayer(s, w, enemy, []); return; }
      if (E.wouldAccept(s, w, [], enemy)) E.makePeace(s, w, enemy, []);
      else if (years > 12) E.makePeace(s, w, enemy, []);   // both sides are done
    }
  }

  /** Greedily add what the loser will still sign for. */
  function buildDemands(s, w, taker, score) {
    const giver = w.attackers.has(taker) ? w.leadB : w.leadA;
    const candidates = [];
    for (const i of E.ownedBy(s, giver)) {
      const occupied = s.control[i] === taker;
      const core = s.coreOwner[i] === taker;
      const adjacent = Array.from(W.neighbours(i)).some((n) => s.owner[n] === taker);
      if (!occupied && !core) continue;
      const devv = s.devTax[i] + s.devProd[i] + s.devMan[i];
      const value = devv * (core ? 2.2 : 1) * (adjacent ? 1.4 : 1) * (w.goal === i ? 2 : 1);
      candidates.push({ prov: i, value, cost: E.provinceCost(s, w, i, taker) });
    }
    candidates.sort((a, b) => b.value / b.cost - a.value / a.cost);
    const goalFirst = candidates.findIndex((c) => c.prov === w.goal);
    if (goalFirst > 0) candidates.unshift(candidates.splice(goalFirst, 1)[0]);
    const demands = [];
    for (const c of candidates) {
      const trial = demands.concat([{ kind: 'province', prov: c.prov }]);
      if (E.peaceCost(s, w, trial, taker) > score) break;
      demands.push({ kind: 'province', prov: c.prov });
      if (demands.length >= 12) break;
    }
    if (!demands.length && score > 25) demands.push({ kind: 'gold' });
    return demands;
  }

  function offerToPlayer(s, w, taker, demands) {
    if (s.ai.offers.some((o) => o.kind === 'peace' && o.war === w.id)) return;
    s.ai.offers.push({ kind: 'peace', war: w.id, from: taker, demands, day: s.day });
    E.note(s, demands.length
      ? `${W.nation(taker).name} offers terms.`
      : `${W.nation(taker).name} proposes a white peace.`, 'info', taker);
  }

  // ----------------------------------------------------------------- armies
  function moveArmies(s, id) {
    const wars = E.warsOf(s, id);
    const mine = E.armiesOf(s, id);
    if (!mine.length) return;
    const enemies = new Set();
    for (const w of wars) {
      const side = w.attackers.has(id) ? w.defenders : w.attackers;
      for (const n of side) enemies.add(n);
    }

    for (const army of mine) {
      if (army.battle || army.path) continue;
      // An army that found nothing to do waits rather than re-scanning daily.
      if (army.idleUntil && s.day < army.idleUntil) continue;
      if (!enemies.size) { garrison(s, id, army); continue; }

      // A neighbouring enemy army is either an opportunity or a threat.
      const foe = nearestEnemyArmy(s, army, enemies);
      if (foe) {
        const ratio = army.men / Math.max(1, foe.men);
        if (ratio >= AI.ATTACK_EDGE && foe.dist <= 2) { E.orderMove(s, army, foe.prov); continue; }
        if (ratio < AI.AVOID_EDGE && foe.dist <= 1) {
          const safe = retreatTarget(s, army, enemies);
          if (safe) { E.orderMove(s, army, safe); continue; }
        }
      }
      // Relieve our own besieged provinces before anything else.
      const relief = besiegedNearby(s, id, army);
      if (relief) { E.orderMove(s, army, relief); continue; }
      // Otherwise take ground: the nearest enemy province we do not hold.
      const target = nearestTarget(s, army, enemies);
      if (target && target !== army.prov) { E.orderMove(s, army, target); continue; }
      // Nothing close by. A large nation's armies sit thousands of miles from
      // the front, so march toward the war instead of idling forever.
      const far = distantTarget(s, army, enemies);
      if (far && E.orderMove(s, army, far)) continue;
      army.idleUntil = s.day + 20;
    }
  }

  function garrison(s, id, army) {
    // Move off any province that cannot supply this army, toward one that can.
    const supply = E.supplyLimit(s, army.prov, id);
    const here = E.regiments(army);
    if (here > supply) {
      let best = 0, bestSpare = 0;
      for (const n of W.neighbours(army.prov)) {
        if (s.owner[n] !== id || s.control[n] !== id) continue;
        const spare = E.supplyLimit(s, n, id) - stationed(s, n);
        if (spare > bestSpare) { bestSpare = spare; best = n; }
      }
      if (best) { E.orderMove(s, army, best); return; }
    }
    const cap = s.capital[id];
    if (s.owner[cap] === id && army.prov !== cap && E.rand(s) < 0.12) E.orderMove(s, army, cap);
  }
  function stationed(s, prov) {
    let n = 0;
    for (const a of E.armiesAt(s, prov)) n += E.regiments(a);
    return n;
  }

  /** Breadth-first walk outward from the army, up to a few provinces. */
  function scanOut(s, from, maxDepth, fn) {
    const seen = new Set([from]);
    let frontier = [from];
    for (let d = 0; d <= maxDepth; d++) {
      const next = [];
      if (seen.size > 600) break;            // a wide search is not worth the time
      for (const p of frontier) {
        const hit = fn(p, d);
        if (hit) return hit;
        for (const n of W.neighbours(p)) if (!seen.has(n)) { seen.add(n); next.push(n); }
        if (d < 2) for (const n of E.seaLinks(p)) if (!seen.has(n)) { seen.add(n); next.push(n); }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return null;
  }

  function nearestEnemyArmy(s, army, enemies) {
    return scanOut(s, army.prov, 2, (p, d) => {
      for (const a of E.armiesAt(s, p)) {
        if (a.dead || !enemies.has(a.owner)) continue;
        return { prov: p, men: a.men, dist: d };
      }
      return null;
    });
  }
  function nearestTarget(s, army, enemies) {
    return scanOut(s, army.prov, 5, (p) => {
      if (!enemies.has(s.owner[p])) return null;
      if (s.control[p] === army.owner) return null;
      if (s.siegeBy[p] && s.siegeBy[p] !== army.owner) return null;
      return p;
    });
  }
  /** The closest enemy-held province by straight-line distance, at any range. */
  function distantTarget(s, army, enemies) {
    const [ax, ay] = W.centroid(army.prov);
    const ww = W.dims().W;
    let best = 0, bd = Infinity;
    for (const e of enemies) {
      for (const p of E.ownedBy(s, e)) {
        if (s.control[p] === army.owner) continue;
        const [px, py] = W.centroid(p);
        let dx = Math.abs(px - ax); if (dx > ww / 2) dx = ww - dx;
        const d = dx * dx + (py - ay) * (py - ay);
        if (d < bd) { bd = d; best = p; }
      }
    }
    return best;
  }

  function besiegedNearby(s, id, army) {
    return scanOut(s, army.prov, 3, (p) => {
      if (s.owner[p] !== id) return null;
      if (!s.siegeBy[p] || s.siegeBy[p] === id) return null;
      let enemyMen = 0;
      for (const a of E.armiesAt(s, p)) if (a.owner === s.siegeBy[p]) enemyMen += a.men;
      return army.men > enemyMen * AI.ATTACK_EDGE ? p : null;
    });
  }
  function retreatTarget(s, army, enemies) {
    for (const n of W.neighbours(army.prov)) {
      if (s.control[n] !== army.owner) continue;
      if (E.armiesAt(s, n).some((a) => enemies.has(a.owner))) continue;
      return n;
    }
    return 0;
  }

  global.AI = { tick, init, power, armyMen, neighbourNations, buildDemands, pickCB, AI };
})(typeof window !== 'undefined' ? window : globalThis);
