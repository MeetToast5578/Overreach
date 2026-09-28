# Overreach: handoff and plan (phases 3–11)

> **28 Sep 2026: the order of work is now set by `ROADMAP.md`** (1836 borders and nations first, then these phases
> as milestones M6–M16). The phase notes below still hold as the detailed "how".

Updated 22 September 2026, at the end of the session that finished phases 0, 1 and the **map rework**
(the new phase 2). The next session starts at **phase 3**, or at the nation work the user asked for next (see the end
of phase 2). Read this file top to bottom before touching code.

- Game: https://claude.ai/artifact/64SK89mMXGEJJxGzXHA2Sc (private; the latest version has the new 8k map)
- Handoff page: https://claude.ai/artifact/R6SAFq9RDVHM3wygiJpjnP (a web version of this file)
- Local working copy: `overreach/` in the project folder. `game/` is the old turn-based prototype, so don't build on it.
- Map builder: `tools/build_map.py` (see §4, phase 2). Previews: `tools/preview_map.py`.

---

## 1. Start here (checklist for the next session)

1. Start the `overreach` launch config (preview_start `{name: "overreach"}`). It serves `overreach/` on port 8766 with Python.
2. Open `http://localhost:8766/tests/?run=world,economy,battles,sieges,war,bugs` and confirm 39/39.
   Then `?run=ai:20:check` and confirm 9/9. Read the results from `window.RESULTS` with the javascript tool.
   Poll in steps under 45 seconds, because each call times out at 45s.
3. If `overreach/` is missing (new machine), pull every file from the game artifact with the Artifact tool
   (`read` with `paths`: index.html, engine.js, ai.js, world.js, data/mapdata.js, data/provinces.png,
   data/provinces-4k.png, data/terrain.png, data/terrain-4k.png, tests/index.html, tests/worker.js,
   tests/baseline-phase0.json, tests/baseline-phase1.json, HANDOFF.md).
   The map builder and its inputs are local only: `tools/build_map.py`, and the Natural Earth and GeoNames
   downloads in `build/` (the file list is in phase 2 below). They're only needed to change the map.
4. Mark a chapter, then begin the next step.

### Rules that held up

- **Write the failing check first.** Add the check to `tests/worker.js`, see it fail, fix the code, then rerun every suite.
  Tag checks with the issue number, e.g. `[#30]`.
- **When a check fails, decide whether the code or the assertion is wrong before changing either.**
  In phase 0, three failures were the test's fault and one was a real bug (#35).
- **Don't tune constants to cover a structural problem.** The great-power freeze was structural, and phase 1 proved it.
- **Measure before and after.** Each balance-affecting phase ends with 80-year runs on seeds `1836`, `alpha` and `beta`,
  saved as `tests/baseline-phaseN.json`.
- **Publish after each phase:**
  1. `Artifact read` the game URL, then Read the whole saved file it names. This is required before a republish.
  2. Publish `overreach/index.html` with `url` set to the game link and `files` naming only the changed files
     (tests included).
  3. Update the handoff page (the `url` for R6SAFq9RDVHM3wygiJpjnP) and this file.
- **Ask the user to open the game after visible changes.** Driving it through the browser pane is unreliable (see §5).

---

## 2. The user's direction (decided, don't re-ask)

- **Realistic mini-EU4.** The main goal is survival and the second is domination. **An alliance of nations must be able to beat a great power.**
- **Save and load:** both a browser autosave and a copyable save code.
- **Endings:**
  - **World Peace:** every surviving nation is in one alliance/pact web, and there have been no wars for 10 years.
  - **Monopoly:** one nation earns 75% or more of world trade income.
  - **Domination:** every province is owned by you or your vassals.
  - **Nuclear Winter / Apocalypse:** strikes pass a threshold and the world collapses. Everyone loses.
  - **Survival:** being alive in 2036 is a win. A destroyed player gets a game-over screen.
- **Timeline:** the game runs 1836 → 2036. Technology eras (Industrial → Railways → Machine Age → Atomic) unlock nukes.
- **EU4 systems to include:** religion, culture, technology, trade nodes, national ideas, vassals, personal unions, coalitions,
  rebels, fort zones of control, navy, pacts (multi-nation alliances), and a great-power ranking.
- **Skipped on purpose:** monarch points and estates. Add them later only if the user asks.
- **Map (done):** realism first. The map is 8k (plus 4k on phones), with a nation → region → province hierarchy.
  Regions are real admin-1 states, and there are about 5,000 provinces, each named for a real town that is drawn on the map.
  EU4-like density: small provinces in settled lands, big ones in empty lands. The Bosphorus, Dardanelles and Kerch are open.
  Nation fixes come next and were deliberately left for later.

---

## 3. Status of the 35-item issue list

| # | Issue | Phase |
|---|---|---|
| 1 | A peace reset every occupation in the world | **done (1)** |
| 2 | Save/load missing; the Save window falsely claims autosave | 4 |
| 3 | Difficulty unused | 5 |
| 4 | No game over or endings | 10 |
| 5 | Alliance double roll and wrong message | **done (1)** |
| 6 | Peace terms ignore the casus belli; vassalise and liberate can't be demanded | 6 |
| 7 | Unlimited loans plus free bankruptcy | 5 |
| 8 | Wars stuck when the leader dies | **done (1)** |
| 9 | Routing by hops with a 4,000-node cap | **done (1)** |
| 10 | Dead nations' armies persist | **done (1)** |
| 11 | Stability has no effect | 5 |
| 12 | Prestige has no effect | 5 |
| 13 | Bankruptcy penalty never checked | 5 |
| 14 | Coalitions never used | **3** |
| 15 | Claims are instant (CLAIM_DAYS unused) | 5 |
| 16 | University devgrow unused | 5 |
| 17 | HUD "Unrest risk" is actually AE | 5 |
| 18 | Gift, marriage and insult spam | 6 |
| 19 | Guarantees free, unlimited and permanent | 6 |
| 20 | Player can't choose the claim target or war goal | 6 |
| 21 | No military access | 6 |
| 22 | Army split, merge, disband, stop, inspect enemy, training time | 7 |
| 23 | Vassals have no UI or integration; the AI never vassalises | 6 |
| 24 | No navy | 7 |
| 25 | No rebel armies | 7 |
| 26 | Buildings instant and permanent | 7 |
| 27 | No fort zone of control | **3** |
| 28 | Peace list capped at 60/40 | **done (1)** |
| 29 | Tutorial, sound, graphs, offer-expiry warning | 10–11 |
| 30 | Unfortified provinces take about 111 days | **3** |
| 31 | Terrain is guessed (no mountains or forests) | 11 (ask the user) |
| 32 | Side panel rebuild eats clicks | **done (1)** |
| 33 | Clock runs behind modals | 10 |
| 34 | "Great powers" list leftover code | 5 |
| 35 | Battles about 2 days, ties go to the attacker | **done (1)** |

Found on screen but not numbered yet:
- In the phone layout the dispatch feed covers most of the map. Fix in phase 10.
- World share counts equirectangular pixels (Russia 19%, really about 11%). Fix in phase 3.

---

## 4. The plan

Each phase lists its **goal**, **how to build it** (grounded in the current code), **checks to add first**, and **done when**.

### Phase 2: Map rework, nations → regions → provinces (DONE)
The user asked for a realistic province system in place of the old one (10,957 provinces grown pixel by pixel
on a 4k map, with boxy shapes and slivers). It replaced the old "straits" phase.

**What exists now**
- **`tools/build_map.py`** builds everything offline in 4 cached stages (`python tools/build_map.py [1|2|3|4|all]`,
  about a minute in total; caches go in `build/map8k/`).
  1. **Base rasters at 7680 × 3840** from Natural Earth 10m: countries (same 241 nations and ids as before),
     lakes, rivers (scalerank ≤ 9), ice sheets (glacier blobs ≥ 4,000 px, plus Antarctica) and admin-1 states.
     Straits too narrow to rasterise are carved 3 px wide (`STRAITS`: Bosphorus, Dardanelles, Kerch).
     `WATER_LINKS` asserts that 8 sea pairs connect edge-to-edge.
  2. **Regions.** Each state is trimmed to its own nation and the gaps are filled from the same nation.
     GeoNames cities (≥ 15k) are snapped to land. Countries whose states are tiny (the UK, Slovenia, Latvia, France,
     Italy…) are grouped by the admin-1 `region` field, and anything expected to hold fewer than 2 provinces merges into
     a neighbour. This gives 1,418 base regions.
  3. **Provinces.** About 5,000 are allocated by weight `area^0.35 × (1 + Σ√pop/1000)^0.5`. Regions over 10 provinces
     are split evenly into sub-regions ("Northern Texas").
     - **Seeds:** cities, largest first and spaced apart, then farthest-point fill with Lloyd relaxation for empty land.
     - **Growth:** a graph Voronoi on 8-connected pixels (scipy dijkstra) with a smooth-noise travel cost, so borders
       wander naturally. River pixels cost +6, so borders follow rivers.
     - **Clean-up:** cells under 900 km² merge into a neighbour, and detached specks join the nearest province of the region.
     - **Size cap:** 200k km², relaxed toward the poles (`max_prov_km2`).
  4. **Metadata and output.**
     - Terrain from Natural Earth geography polygons: mountains need ≥ 60% cover, hills ≥ 50%, desert, marsh and arctic.
       River valley and coastal come after those.
     - Names for provinces without a town, taken from geography ("Gobi Desert") or compass words; `dedupe_names`
       makes them unique within a nation.
     - Population: towns plus the nation's rural remainder, shared out by area.
     - Land adjacency; sea links (a half-resolution water Voronoi, coasts ≤ 160 km apart); straits (gap ≤ 25 km,
       crossed in 2 days).
     - Nation records and colours (each nation takes the family variant furthest from its neighbours).
     - Rasters and `data/mapdata.js`, then acceptance checks.
- **Output** (in `overreach/data/`): `provinces.png` (8k, RGB: id = R×256 + G), `provinces-4k.png`, `terrain.png` /
  `terrain-4k.png` (class × 50), and `mapdata.js` (`{v:2, w, h, nations, regions, provinces: columnar table}`).
  All of it together is under 3 MB.
- **Result:** 5,245 provinces, 1,718 regions (median 3 provinces, max 10), 4,558 provinces with a town.
  Median province 13,000 km². No rectangles. Single-piece compactness p5 > 0.18.
  Terrain: 1,282 plains, 1,287 coastal, 729 river valley, 760 mountains, 711 hills, 282 desert, 150 arctic, 44 marsh.
  A 20-year AI run takes 3.8 ms per game day (it was 10 ms on the old map).
- **`world.js` is now a loader:** `World.build(md, provRaster, terrRaster, w, h)`.
  New API: `regionOf`, `region`, `regionProvinces`, `regions`, `cityOf`, `cityPx`, `areaKm`, `terrainClass`, `coastal`,
  `riverShare`, `seaLinks`, `isStrait`. Positions come in loaded pixels. The engine uses only table data (area, terrain,
  links), so it behaves the same at 8k and 4k.
- **`engine.js`:**
  - `prepare()` reads the table.
  - `TERRAIN` gained mountains, hills and marsh (indices 5–7).
  - `MOVE_DAYS = (2.4 + √areaKm × 0.022) × terrain move`.
  - `edgeDays()` covers land, strait (`STRAIT_DAYS` 2) and sea (12).
- **`index.html`:**
  - Resolution is 8k, or 4k when the screen is < 700 px or `deviceMemory` ≤ 4 (`?res=4k|8k` overrides).
  - Region borders are drawn between province and nation borders.
  - Towns show as you zoom in (the capital in brass), and province names appear at the town.
  - The panel shows region, chief town and area.
  - Zoom thresholds use `zoomOf(s)`, which is tuned on 3840-wide terms.
- **Downloads in `build/`:**
  - Natural Earth 10m: `admin_0_countries`, `admin_1_states_provinces`, `lakes`, `rivers_lake_centerlines`,
    `glaciated_areas`, `geography_regions_polys`.
  - GeoNames `cities15000.zip`.

**Not yet seen on screen.** The browser pane's screenshots timed out (the app window was hidden), so the game view of the
new map was checked by DOM and canvas reads only. The build previews (`tools/preview_map.py` → `build/prev_*.png`)
were inspected. Ask the user to open the game and report.

**Also done after the map rework (same session)**
- **Daily updates.** `Engine.tick` now calls `daily(s)`, not `monthly(s)`: treasury, manpower, war exhaustion, population,
  unrest and attrition apply a thirtieth of their monthly rate every day. Revolt odds are converted
  (`REVOLT_DAILY = 1 - 0.95^(1/30)`), and attrition keeps men fractional so small daily losses are not rounded away.
  CFG rates stay monthly. `yearly()` (AE decay, prestige, opinion decay) is unchanged. There's a check:
  "The treasury and manpower change every day".
- **Observer mode.** "Watch the world" on the intro calls `startGame(0)` (no player, so every nation is AI) and sets
  `observer = true`.
  - The HUD shows world stats.
  - Clicking a province, army or great-power row sets `watched`, and the panel shows that nation read-only (`watchedHtml`).
  - All armies are drawn once zoomed in, and battles are drawn at any zoom.
  - Dispatches skip battle and siege lines (`NOISE`) unless they involve the watched nation.
  - The Relations map mode is seen from the watched nation's side.
  - A new speed 5 runs 60 days a second.
- **Terrain map mode fixed.** It crashed on the new terrain types (mountains, hills, marsh had no colour). Now there's a
  `TERRAIN_RGB` entry per `Engine.TERRAIN` type, a plains fallback, and a legend in terrain mode.
- **Repaints are about 10× faster.** `buildEdges()` precomputes the static edge bits once at load (province 1, coast 2,
  region 4), so `paintProvince` only re-checks owners on edge pixels. An 8k map-mode switch takes about 0.1 s (it was 1–2 s).
  Keep it this way: any new per-pixel map mode must stay cheap.
- **Test runner is cache-busted** (`worker.js?v=`, and `importScripts` with `?v=`), so a run always uses the files on disk.
- **The game loop runs on requestAnimationFrame,** so it pauses whenever the tab or browser pane is hidden. That's normal
  browser behaviour, and it's why the clock couldn't be seen advancing in the hidden pane during testing.

**Still open from the old phase 2**
- Canals (Suez 1869, Panama 1914) as data for the navy. Do these in phase 7.
- 16 duplicate province names within a nation remain (towns sharing a name in the same region).
- 1836-era names: towns carry modern names ("Istanbul", "Kinshasa"). Decide with the user when the nation phase comes.
- EU4-style wasteland (impassable Sahara core, High Arctic, Tibetan plateau) is not modelled. Big empty provinces stand in
  for it. Ask the user.

**The user's next request:** "then we can move towards the nations and fixing some issues with them." Ask what they
dislike about the nations before planning.
Likely topics:
- The 241 modern countries in 1836.
- Colonies and overseas parts (France includes Guiana).
- Tiny microstates.
- Tribal and uncolonised lands.

### Phase 3: Pacing and balance (the great-power problem)
**Goal:** a living map where great powers can grow and can be beaten by a coalition. Fixes #14, #27, #30, and world share.

**How:**
1. **True area.** `World.areaKm(i)` already exists (from the map build). Switch the world-share checks (`shareTable` in
   tests/worker.js still sums `W.sizeOf` pixels), the "Great powers" list and (later) Domination to it.
2. **Fast occupation of unfortified land (#30).**
   - With fort 0 and no hostile army present, control flips after `OCC_DAYS_BASE` (about 8) + size and terrain days, not about 111.
   - Implement in `tickSiege` as a separate `SIEGE_TARGET` for fort 0, or a different rate.
   - Target: fort 0 in 10–25 days, and keep forts slow (fort 1 about 90 days with some artillery).
3. **Fort zone of control (#27).** In hostile territory an army can't move from one province adjacent to an enemy-held fort
   (fort ≥ 1) to another such province unless the target is the fort itself. Apply it in the `findPath` relax step
   (it needs `from` and `to`) and in AI targeting. Forts should then matter: the AI builds them on borders already.
4. **Coalitions (#14).** This is the "alliance beats a great power" rule.
   - Per-pair fear: nations with `op(n, target) < -50` and `ae[target] ≥ COALITION_AE` join `s.coalitions[target]` (a Set). Recheck monthly.
   - When the coalition's summed power is at least 1.0–1.2 × the target's plus its allies' (the AI's `power()`), the largest member declares a
     `coalition` war (new CB): **every member joins as an attacker, and the war score is shared.**
   - Coalition peace terms: return provinces whose `coreOwner` is a member, reparations and humiliation. Truce for everyone.
   - The player can be targeted, and can join coalitions (an offer through the inbox).
5. **Army sizing.**
   - Great powers run at about 30% of force limit because income can't pay upkeep. Either lower `FORCE_LIMIT_PER_DEV` so the limit
     matches the economy, or scale upkeep. Target: AI armies at 60–90% of limit in peacetime.
   - The AI recruits in several provinces near the front, not only at the capital (`runEconomy` → `where`).
6. **AI war choice.** Let great powers pick targets by expected gain (dev reachable per war), not just the power ratio.
   Opportunists attack great powers that are already at war (`E.warsOf(s, n).length`).

**Checks first:**
- Fort 0 falls in 10–25 days, and fort 1 still takes over 60.
- ZoC stops a march past an enemy fort.
- A scripted coalition forms against a nation with AE ≥ threshold, declares, and the target loses land after a forced occupation.
- True-area shares: Russia is about 11%.

**Done when:** the 100-year runs on three seeds meet these targets (turn them into `ai` suite checks):
- No AI nation passes 15% true area.
- In at least 2 of 3 seeds some great power loses land to a coalition.
- Coalitions win most of their wars.
- At least 60% of nations with 5 or fewer provinces survive.
- Some great power gains at least 5% of its starting area.
- Speed stays under 12ms a day.
- Saved as `tests/baseline-phase3.json`.

### Phase 4: Save and load (#2)
**Goal:** a browser autosave plus a copyable save code, versioned, with an exact round trip.

**How:**
1. **`Engine.serialize(s)` and `Engine.deserialize(obj)`:**
   - Typed arrays → base64 of the buffer.
   - Sets → arrays.
   - Armies and wars → plain objects. Battles are stored by army ids and relinked on load.
   - Also: `s.ai` (offers, traits, rota), `rng`, `day`, `nextArmy/nextWar`, `stats`, and the last 100 log entries.
   - Drop caches (`eco`, `byProv`, `sieging`: rebuild them).
   - Header: `{v: 1, mapHash, provinces, seed, player, difficulty}`. `mapHash` is a checksum of the province count plus seeds.
     Refuse to load a save made on a different map.
2. **Save code:** JSON → `CompressionStream('gzip')` → base64url. Expect about 100–150 KB. The UI has a textarea with Copy, and a paste box with Load.
3. **Autosave:** every game month to `localStorage` (try/catch, since it can fail). The intro's **Continue** button appears when a save exists.
   Replace the false message in the Save window.

**Checks first:**
- Round trip: run 5 years, save, load, run 5 more years on both copies. They're identical (hash the owner, control and pop arrays plus the army list).
- A save from another map is refused.
- A corrupt code gives a readable error, not an exception.
- Loading mid-battle and mid-siege works.

**Done when:** the checks pass, and the user confirms Continue works after a reload.

### Phase 5: Make the do-nothing numbers work (#3, #7, #11–13, #15–17, #34)

**How:**
- **Difficulty (#3):** `s.mods` from difficulty covers AI income ×0.85/1/1.15, AI `TARGET_EDGE` ±, AI peace greed, and player AE ×.
- **Stability (#11)** runs from -3 to +3:
  - Effects: income ±8% a point, and unrest drift.
  - Raise it for ducats (scaling cost).
  - It drops on bankruptcy, a war with no CB, a lost war, or breaking an alliance.
- **Prestige (#12)** runs from -100 to 100:
  - Effects: morale ±, alliance chance, and AE decay.
  - It decays toward 0.
- **Loans (#7):**
  - Cap at `5 + dev/150`.
  - Interest rises with each loan.
  - The player's "take a loan" is blocked at the cap.
- **Bankruptcy (#13):** for 5 years there are no loans, stability is -2, morale is ×0.5 and buildings cost +50%. Check `bankruptUntil` everywhere relevant.
- **Claims (#15):** fabricating takes `CLAIM_DAYS` in a queue (`s.fabricating`), and the target's opinion drops when it completes.
- **University (#16):** each year it has a chance to add +1 development and reduces unrest.
- **HUD label (#17):** rename to "Aggr. expansion", or show real unrest risk.
- **Great-powers list (#34):** tidy the leftover code and show true-area % (phase 3).

**Checks:** one per mechanic, for example:
- Hard AI earns more than easy AI.
- A bankrupt nation can't take loans.
- A claim isn't usable before 180 days.
- A university province gains development.

### Phase 6: Diplomacy and subjects (#6, #18–21, #23, plus pacts and personal unions)

**How:**
- **Cooldowns (#18):** `s.cooldown` keyed by action, `a` and `b`. Gifts every year, marriage once (and it gives a future union chance), insult every 5 years.
- **Guarantees (#19):** capped by a diplomatic capacity (e.g. 3), cost upkeep, and can be cancelled.
- **Your choices (#20):**
  - A claim mode: click an enemy province on the map to target it.
  - The war screen lets you pick the war goal from your claims or bordering provinces.
- **Peace terms by casus belli (#6):** the peace table offers only `CB[cb].allows`:
  - vassalise
  - liberate (release a nation whose cores the loser holds)
  - gold
  - humiliate
  - provinces
  - coalition terms

  The AI uses the same rules in `buildDemands`.
- **Military access (#21):**
  - `s.access` pairs. Request, grant or revoke it.
  - `canEnter` respects it.
  - The AI grants to friends.
- **Vassals (#23):**
  - A subjects screen shows liberty desire and integration (an annex progress bar over years, costing ducats per development).
  - Vassals join wars.
  - The AI uses the vassalise CB against much weaker neighbours.
- **Pacts:**
  - `s.pacts = [{id, name, leader, members: Set}]`. Invite, join and leave.
  - Attacking a member calls all members in.
  - Needed for the World Peace ending (the alliance graph plus pacts must connect every living nation).
- **Personal unions:** the "Claim the throne" action needs a royal marriage, opinion over 100 and a much weaker target. The target becomes a junior
  partner, like a vassal that can be integrated.

**Checks:** a cooldown blocks a repeat, access lets you path through, a vassalise peace sets `overlord`, a pact member is called in,
integration completes and annexes.

### Phase 7: Armies, rebels, buildings, navy (#22, #24–26)

**How:**
- **Army controls (#22):**
  - Split (choose counts), merge (the selected armies in one province), disband (refund some manpower), and stop.
  - Click enemy armies to inspect them (read-only).
  - Recruitment queues per province, with 30 days of training and a custom count.
- **Rebels (#25):**
  - At revolt, spawn a rebel army (reserved nation id 255, hostile to the province owner).
  - It sieges nearby provinces. If it holds them for 12 months they flip to the `coreOwner` (independence), or development drops.
  - `atWarWith` treats 255 as hostile to the owner of the land it stands in.
- **Buildings (#26):** a construction queue (90–365 days by type). Demolishing refunds nothing.
- **Navy (#24):** the big job.
  1. Generate **sea zones** by clustering ocean pixels into about 150–250 zones (Voronoi on ocean-pixel seeds) in a tool script. Store them as a raster in a new `data/seadata.js`.
  2. Add ports: every coastal province, with its adjacent zones.
  3. Fleets of light, heavy and transport ships:
     - They move zone to zone.
     - Transports carry armies, which replace the abstract army sea links. Keep the strait crossings.
     - Naval battles.
     - Blockades cut enemy province income and slow sieges.
  4. An enemy fleet in a strait zone blocks the crossing.
  5. Canals open by year (phase 2 data).
  6. The AI builds fleets in proportion to its coastline and uses transports for overseas targets.

**Checks:**
- A split keeps the total men.
- Training takes 30 days.
- A rebel army spawns and flips a province.
- A building completes after its timer.
- A fleet moves between zones.
- A transport lands an army overseas.
- A blockade reduces income.
- A strait is blocked by an enemy fleet.
- Suez is closed before 1869.

### Phase 8: Religion, culture, technology, ideas

**How:**
- **Data file `data/peoples.js`:** for each of the 241 nations (by ISO3), a state religion and a culture group, written by hand.
  - Religions: Catholic, Protestant, Orthodox, Sunni, Shia, Hindu, Buddhist, Shinto, Jewish, and folk/animist.
  - Optional province overrides by latitude/longitude box for mixed countries (Nigeria north/south, India, Lebanon, Bosnia and so on).
  - Ask the user nothing here. Use standard 1836-era majorities where the modern country didn't exist.
- **Religion:**
  - Province religion.
  - Unrest when it differs from the state religion, reduced by tolerance.
  - Missionaries convert over time for ducats.
  - A holy-war CB (cheap AE against a different religion).
  - Opinion bonus for shared faith.
- **Culture:**
  - Accepted cultures: the primary culture plus up to 2 more, gained through development or years held.
  - Unrest and lower income in non-accepted provinces.
- **Technology:**
  - Three tracks (administrative, diplomatic, military), levels 0–30, grouped into four eras.
  - Research points come from development, universities and a treasury slider.
  - Being ahead of your time costs more.
  - Unlocks by era:
    - Industrial: factory +production.
    - Railways: movement +35% and faster manpower recovery.
    - Machine Age: better infantry and artillery, and tanks as a unit.
    - Atomic: the nuke programme.
  - The AI researches with the same rules.
- **National ideas:** sets by region or culture group, e.g. "Steppe Horsemen: cavalry +15%". 3–5 bonuses unlocked by administrative tech.

**Checks:**
- A wrong-religion province has more unrest.
- Conversion completes.
- A holy war is allowed only across religions.
- Research advances each month.
- An era unlock applies its effect.
- Starting-era mechanics apply to everyone.

### Phase 9: Trade (Monopoly ending groundwork)

**How:**
- **Trade network:** about 40 trade nodes as a hand-written directed graph with downstream flow (e.g. Canton → Malacca → Bengal → … → English Channel).
  Each province belongs to a node (nearest node centre, or a lookup).
- **Money:**
  - Trade value = production development × goods price.
  - Trade power = province development + buildings (harbour, marketplace) + light ships.
  - Merchants (2 plus diplomatic tech) collect or steer.
  - Trade income is paid monthly.
- **Interface:** a trade map mode and a trade screen.
- **Monopoly measure:** player trade income / world trade income, tracked monthly.

**Checks:**
- Value flows downstream.
- Steering increases the downstream node.
- More trade power means a bigger share.
- The world's total trade income is conserved (minus retained value).

### Phase 10: Endings, game flow, nukes (#4, #29 partly, #33, and the phone layout)

**How:**
- **History:** record a snapshot every year (true-area share, income, army, development and alliances for the top 20 plus the player).
- **End screen:** graphs (small inline SVG line charts) and the reason the game ended.
- **Ending checks, monthly:**
  - Survival: reaching 1 January 2036 alive.
  - Game over: the player is destroyed.
  - World Peace: one connected alliance/pact web and no wars for 10 years.
  - Monopoly: at least 75% of trade income.
  - Domination: every province owned by the player or their vassals.
  - Nuclear Winter: cumulative strikes pass N.
- **Nukes** (the Atomic era):
  - Build warheads (expensive) and delivery (range from owned territory).
  - A strike on a province: population ×0.2, development −50%, armies there wiped, and fallout unrest for decades.
  - The world's opinion of the striker collapses.
  - AI deterrence: nuclear powers are much less likely to be attacked, and a strike triggers retaliation.
  - A global "nuclear winter" meter raises world attrition and cuts income as it grows.
- **Game flow:**
  - An expiry countdown and warning on AI offers.
  - The clock pauses while the diplomacy, peace or war windows are open.
  - The phone layout: the feed collapses to a single line that expands on tap.

**Checks:**
- Each ending triggers in a scripted scenario and not in a normal 80-year AI run (no false positives).
- A strike applies its effects.
- History has one entry per year.

### Phase 11: Polish

- **Tutorial:** a step-by-step overlay (select a province, develop it, raise troops, march, declare war, make peace), which can be skipped.
- **Sound:** small WebAudio cues (battle, siege won, peace, war declared) and a mute toggle.
- **Real terrain (#31):** needs an elevation/biome raster source. **Ask the user first.**
- **Performance:** a final pass keeping it under 12ms a day with all systems on.

---

## 5. Environment notes and pitfalls

- **No Node on this machine.** Python 3.13 with Pillow 12, numpy 2.5, scipy 1.18, shapely and pyshp is available. The browser is
  the test runner.
- **Memory is tight** (8 GB RAM, often about 1.5 GB free). `build_map.py` avoids whole-map index arrays; keep it that way.
- **Test harness:** `tests/worker.js` (all suites, in a Web Worker) and `tests/index.html` (runner page, `?run=` param,
  `window.RESULTS`).
  - Suites: world, economy, battles, sieges, war, bugs, `ai:years:seed`, and `powers:years:seed` (a diagnosis that asserts nothing).
  - The worker helpers `arena()`, `fight()`, `siegeDays()` and `pickPair()` build isolated scenarios. Reuse them.
- **Driving the game in the browser pane:**
  - With `resize_window` 1440×900 the page is scaled to fit. Coordinate clicks from a fresh screenshot work.
  - `ref` clicks land in the wrong place, and small buttons (the speed controls) miss.
  - The game loop stalls while the pane is hidden between tool calls.
  - Screenshots can be taken before a paint, so wait a second.
  - Prefer reading the DOM through the javascript tool to check state. Reset the viewport to `desktop` when finished.
- **Baselines:** `tests/baseline-phase0.json` (the original build) and `tests/baseline-phase1.json`.
- **Speed:** a single AI run takes about 10ms per game day in the browser. Three in parallel run about 10ms each after phase 1.
- **The map files** in `data/` are generated by `tools/build_map.py`. Never hand-edit them; change the builder and rerun it.
  After a rebuild, rerun all suites, because province ids change.

## 6. Code map (after phase 1)

| File | Notes |
|---|---|
| `engine.js` | `CFG` constants at the top. |
| `ai.js` | `AI` constants at the top. The AI runs on a 24-day rota, and wartime armies are ordered every 3 days. |
| `world.js` | Loads the prebuilt map (raster plus table) and indexes it. It has no game state. |
| `index.html` | Rendering, input, panel, modals, loop. `renderPanel` skips identical markup (`lastPanel`) and doesn't rebuild while a pointer is held on the panel. |

Key functions in `engine.js`:

| Function | What it does |
|---|---|
| `findPath` | Dijkstra over travel days, with stamped scratch arrays and `canEnter` memoised per holder. |
| `landDays(s, to)` | The cost of stepping onto a land province (roads applied). |
| `endWar` → `restoreControl` → `expelArmies` | Closes a war cleanly. |
| `destroyNation` → `leaveWar` | Removes a nation that lost its last province. |
| `annex` | Revives dead nations (liberation and revolts) and destroys emptied ones. |
| `formAlliance` / `proposeAlliance` | An accepted pact, and the roll-once proposal. |
| `makePeace` | Applies the demands, then calls `endWar`. |
