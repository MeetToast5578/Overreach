# Overreach on OpenFront: the fork plan

**Decided 28 September 2026:** the Overreach engine is replaced by a fork of **OpenFrontIO**
(`github.com/openfrontio/OpenFrontIO`, inspected at commit `93a136a`, 26 Sep 2026). Provinces, named cities, a sandbox
mode and the 1836 world get built on top of it. The goal is to be efficient: take everything OpenFront already does
and build only what's missing.

The old engine (`engine.js`, `ai.js`, `world.js`, `index.html`) becomes a read-only reference. `ROADMAP.md` §3 (the 1836
data: sources, rules, checks, names, Appendix A) still holds and feeds F3 below.

---

## 1. What the fork gives us for free (checked in the code)

| We needed                                   | OpenFront has it                                                                                       | Where                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| A deterministic tile simulation in a worker | Yes: pure TypeScript, a seeded PRNG, no floating-point maths                                           | `src/core/` (49k lines), `GameRunner.ts`, `worker/`, `DetMath.ts`                          |
| Commands, a command log, replays            | Intents → Executions, turn records, a replay tool                                                      | `Schemas.ts`, `execution/ExecutionManager.ts`, `VersionedReplay.ts`, `npm run replay:game` |
| Snapshots (undo, rewind)                    | `snapshotGame()` / `restoreGame()`                                                                     | `src/core/snapshot/`                                                                       |
| A world tile map                            | World is 2000×1000 (652k land tiles). Giant World is 4000×2000. There are 130 maps in all              | `resources/maps/`                                                                          |
| Enough nation ids                           | 12 bits per tile, so up to 4,095 players                                                               | `game/GameMap.ts`                                                                          |
| Fronts, expansion, attacks                  | Yes, including retreat and expansion into unowned land ("terra nullius")                               | `AttackExecution.ts`, `TerraNulliusImpl.ts`                                                |
| Boats and landings                          | Transport ships, warships, trade ships, ports                                                          | `TransportShipExecution.ts` and related files                                              |
| Structures                                  | Cities, defence posts, factories, railways, missile silos, SAMs                                        | `CityExecution.ts`, `DefensePostExecution.ts` and others                                   |
| Nukes                                       | Atom bombs, MIRVs, a doomsday clock                                                                    | `NukeExecution.ts`, `MIRVExecution.ts`                                                     |
| Diplomacy                                   | Alliances (requests, extensions), embargoes, donations                                                 | `execution/alliance/` and others                                                           |
| AI                                          | AI nations and roaming tribes                                                                          | `NationExecution.ts`, `execution/nation/`, `TribeExecution.ts`                             |
| Rendering and interface                     | Pixi.js (WebGL), Lit components, Tailwind, translations                                                | `src/client/` (119k lines)                                                                 |
| Single-player with no server                | Yes                                                                                                    | `src/client/LocalServer.ts`                                                                |
| Multiplayer                                 | A Node server that relays intents                                                                      | `src/server/`                                                                              |
| Maps from images                            | A Go generator reads a PNG (terrain from the blue channel) plus `info.json` (nations and spawn points) | `map-generator/`                                                                           |
| Tests                                       | 534 test files in Vitest, speed scripts, a test-game helper                                            | `tests/`, `tests/util/Setup.ts`, `npm run perf`                                            |

**Ownership choke point:** every tile ownership change goes through `GameImpl.conquer()` and `GameImpl.relinquish()`
(`src/core/game/GameImpl.ts` ~799 and ~823). The only other writer is snapshot restore. So the province layer needs
exactly two hooks.

## 2. What we build

1. **Sandbox mode:** god tools as new intents and executions, so they're replayable, testable and multiplayer-safe
   with no extra work.
2. **Scenario starts:** nations begin with pre-drawn territory (1836, or a saved sandbox) and skip the spawn phase.
3. **The World 1836 map:** our Python builder writes OpenFront's map inputs, with the 1836 owners from the `ROADMAP.md`
   §3 rules.
4. **Provinces:** a tile layer plus records, hooked at the choke point, with auto-generation and player tools.
5. **Named cities:** extend OpenFront's City with a name, population, founding date and province-capital role.
   Real towns are placed by default.
6. **Diplomacy additions:** puppets and vassals, revolts and civil wars (split off whole provinces), coalitions.
7. **Grand-strategy layer:** the 1836–2036 calendar, eras and the EU4 systems from `ROADMAP.md` M8–M13, adapted.
8. **Our name, and their commercial parts removed** (see §3).

## 3. Licence: the terms and how we meet them

| Term                                                                                                          | What it means for Overreach                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code is **AGPL-3.0**                                                                                          | All Overreach code becomes AGPL-3.0 too. If _other people_ play it over a network, the game shows a **"Source" link** to a public copy of our code. Using it privately has no publishing duty. |
| Section 7(b): keep **"© OpenFront and Contributors"** visible (footer, loading screen, splash or main menu)   | Keep their notice where it is now, on the footer and loading screen.                                                                                                                           |
| Section 7(c): don't misrepresent the origin, don't use "OpenFront" as the main title, don't imply endorsement | The game is called **Overreach**. The About screen says "Built on OpenFront (AGPL-3.0)".                                                                                                       |
| `/resources` assets are **CC BY-SA 4.0**                                                                      | Credit "OpenFront". Any modified asset stays CC BY-SA.                                                                                                                                         |
| `/proprietary` is **all rights reserved** (logo, favicon, font, music, the game-start sound)                  | **Delete it** and replace with our own or free assets. Make sure the build no longer tries to use it.                                                                                          |
| Their CDN, database and API assets (skins, cosmetics) and their closed API (accounts, stats, payments)        | Never fetch or call them. Disconnect the API and hide the features that need it.                                                                                                               |
| Our 1836 border data (`historical-basemaps`, GPL-3.0)                                                         | Compatible: GPLv3 section 13 allows combining with AGPLv3.                                                                                                                                     |

Their `LICENSE`, `LICENSE-ASSETS`, `LICENSING.md` and `CREDITS.md` stay in the repo. We add our own copyright line for
our changes.

## 4. Rules that keep this efficient

1. **Keep upstream.** Add `openfrontio/OpenFrontIO` as the `upstream` git remote and merge their updates regularly
   while that's still cheap. Their bug fixes and speed-ups come in for free.
2. **Our code in our own folders:** `src/core/overreach/`, `src/client/overreach/` and `tests/overreach/`. Changes to
   their files are one-line hooks. Small hooks mean cheap merges.
3. **Hide, don't delete.** Menus we don't need (store, accounts, clans, leaderboards, matchmaking, ads) get hidden with
   one flag. Deleting their files would conflict with every upstream merge. The exceptions are `/proprietary` and
   anything that calls their API or shows ads, because those must go.
4. **Follow their `CLAUDE.md`:**
   - every `src/core` change comes with a Vitest test built on `tests/util/Setup.ts`;
   - interface text goes through `translateText()` and `resources/lang/en.json`;
   - install with `npm run inst`, never `npm install`;
   - run `npm run lint` before each commit.
5. **Every sandbox action is an Intent plus an Execution,** never a direct state edit from the page. Replays, undo,
   determinism checks, tests and multiplayer then work without extra code.
6. **Maps:** `tools/export_openfront.py` (new, reusing `build_map.py`'s rasters) writes `image.png` (terrain in their
   blue-channel key) and `info.json`, plus our extra layers `owners.png` and `provinces.png`. Their Go generator then
   makes `map.bin`.
7. **Tests guard the rules of our own layers** (the province rule, scenario tile counts). Balance gets checked with
   their `npm run perf:game` and replays.

---

## 5. Milestones

### F0: Set up (1–2 sessions)

**Status (28 Sep 2026): done, except pushing to GitHub** (the GitHub connector can't create repos; the user creates
the empty private repo). Checked: lint clean; production build passes; tests pass apart from the known machine
quirks listed in `CLAUDE.md`; a 50-bot single-player game on World starts, spawns and expands in headless Chrome;
network traffic goes only to the local server, the absent local API (`localhost:8787`) and OpenFront's YouTube
tutorial video. Left for later: the "Use verified" name button, sounds and music (none yet), and translations in
other languages still say OpenFront.

Measured 28 Sep: 36 interface files call OpenFront's API or login, and 18 are store, ads, Steam or cosmetics code.
Their notice string lives in `resources/lang/en.json` under `"copyright"`; keep it.

1. **Save the old engine:** `git init` in `Overreach/`, commit the current files, then move them to `legacy/`.
2. **Get the fork:**
   - fork `openfrontio/OpenFrontIO` into your GitHub account, clone it into `Overreach/`, and add `upstream`;
   - a private fork is fine until other people play.
3. **Tooling:**
   - `npm run inst` needs **npm 12.1.0 or newer**; this machine has npm 11.19 (Node 24.21 is fine).
     - npm 12.1.0 was published on 22 Sep 2026, and the repo's own `.npmrc` refuses packages under 7 days old
       (`min-release-age=7`). So it can only be installed after 29 Sep 2026, 17:11 UTC. Then run `npm i -g npm@12.1.0`.
       Plain `npm@12` gives 12.0.2, which fails the check.
     - Until then, `npm ci --ignore-scripts --engine-strict=false` with npm 11 works. Every other safety rule stays on.
   - Install **Go** for the map generator.
4. **Run it:** `npm test` passes, `npm run dev` starts, and a single-player game on World plays to the end.
5. **Strip and rebrand:**
   - delete `/proprietary` and add replacements;
   - rename to Overreach, keep the © notice, add the Source link;
   - hide the API-backed menus;
   - point the API base at nothing and make the calls that `LocalServer` uses (game record, heartbeat) do nothing.

**Done when:** `npm run build-prod` works, a single-player game runs from the build, and DevTools shows no requests to
any `openfront.io` host.

### F1: Sandbox mode v1

- **A "Sandbox" game mode** in `SinglePlayerModal`, plus a `sandbox` flag in the game config.
- **New intents:**
  - paint territory (a tile list, owner or none);
  - create a nation (tile, name, colour, flag) and delete one;
  - set troops and gold;
  - toggle the AI;
  - force war, peace or alliance;
  - place a structure for free;
  - play as any nation.
- **Controls:**
  - pause already exists (`PauseExecution`);
  - add step-one-turn to `LocalServer`;
  - undo: restore the last snapshot and replay the intents minus the last one.
- **Screen:** a sandbox toolbar (Lit), a brush on the map through their input handler, and a tile inspector
  (owner, terrain, elevation, defence).
- **Checks:**
  - a Vitest test per intent;
  - a recorded sandbox session replays to the same state hash;
  - undo restores the exact state.
- **Done when:** you can paint two nations on World, make them fight, pause, step and undo, and the replay reproduces it.

### F2: Scenario starts (pre-drawn territory)

- A map folder can carry `owners.png` plus `scenario.json`: nations (tag, name, colour, flag, owner colour), alliances
  and wars.
- A start execution gives each nation its tiles through `conquer()`, so the choke point holds, and skips the spawn phase.
- In the sandbox, "Save scenario" downloads those files and "Load scenario" reads them.
- **Checks:**
  - after loading, each nation's tile count equals its pixel count in the image;
  - a synthetic 250-nation scenario on World stays within the tick-time budget (`npm run perf:game`).
  - Most OpenFront games start with small spawns, not a full map, so **measure this first**.

### F3: The World 1836 map

- `tools/export_openfront.py` downsamples our terrain to 2000×1000:
  - water and lakes use blue 106;
  - plains, hills and mountains map to their elevation ranges (blue 140–200).
- It also rasterises the 1836 owners from the `ROADMAP.md` §3.3 rules into `owners.png`. The town list and the
  ~60 town→owner checks from `ROADMAP.md` §3.3 run on that raster.
- **Done when:** "World 1836" shows in the map list and starts with 1836 borders, and you sign off Europe, the
  Americas, India and Africa on screen.

### F4: Provinces

- **Core** (`src/core/overreach/Provinces.ts`):
  - a Uint16 province per tile, plus province records;
  - one hook in `conquer()` and one in `relinquish()`;
  - snapshot save and restore.
- **Default provinces:**
  - on World 1836, our 5,245-province raster, downsampled;
  - on other maps, generated per nation from its cities (grown outward by travel cost, rivers cost more).
- **Rules:**
  - every owned tile is in exactly one province of its owner;
  - a province flips whole when its capital city falls, or when more than half its tiles are held;
  - loose conquered tiles join the conqueror's neighbouring province with the longest shared edge.
- **Sandbox tools as intents:** create, brush-assign, split along a line, merge, rename, set capital.
- **Drawing:** a Pixi layer for province borders and names.
- **Checks:**
  - fuzzing: 10,000 turns of random intents, and the province rule never breaks;
  - a province flips when its city falls;
  - a split keeps the tile total.

### F5: Named cities

- OpenFront's City is a building that raises the population cap. Extend it with a name, population, founding tick and
  province-capital role.
- Place named cities from our towns data on World 1836.
- A found-city intent: free in the sandbox, costs gold in a normal game.
- Labels by zoom level.
- **Checks:** founding respects spacing; capturing a province's capital city flips the province (F4 rule).

### F6: Diplomacy additions

- Puppets and vassals.
- Revolts and civil wars that split off whole provinces into a new nation.
- Coalitions against aggressive nations (`legacy/HANDOFF.md` §2: "an alliance must be able to beat a great power").
- The AI through their `execution/nation/` code.
- **Checks:** a civil war splits off whole provinces; an allied pair beats a stronger single nation in most seeds.

### F7: Grand-strategy layer

- A calendar mapping turns to dates, 1836 → 2036.
- Eras that unlock OpenFront's modern features: nukes, SAMs and trains in later eras, not in 1836.
- Province economy, events, decisions and formable nations, from `ROADMAP.md` M8–M13, adapted.
- The endings from `legacy/HANDOFF.md` §2.

### F8: Hosting

- **Single-player and sandbox:** a static build (the client plus `LocalServer`) can go on any static host:
  Vercel, Cloudflare Pages, GitHub Pages or a claude.ai artifact (check the file count and size then).
- **Before anyone else plays:** make the repo public and wire up the Source link.
- **Multiplayer later:** needs their Node server running somewhere (they ship a `Dockerfile`).

---

## 6. What happens to the older plans

- **`ROADMAP.md`:**
  - §3 (1836 data) and Appendix A feed F3 unchanged.
  - M1 is dropped: nation ids and tiles are already handled.
  - M2's province re-cut is dropped: borders come from the tile raster.
  - M3 (editor) becomes F1 and F4.
  - M5 (colonisation) is already covered by OpenFront's expansion into unowned land.
  - M6–M13 become F6–F7, adapted.
- **`legacy/HANDOFF.md`** describes the old engine. Keep it for reference, along with its direction decisions (§2).
- **Old sandbox checklist:** of the earlier A–L items, OpenFront already covers the core engine (A), the war mechanics
  (C1–C8), structures and boats (G), multiplayer (L1), nukes (L2) and the navy (L3). What's left is F1–F7.

## 7. Decisions for you (the default applies if you don't say)

1. **GitHub:** a private fork under your account now, made public before anyone else plays (for the AGPL source link).
2. **World 1836 size:** 2000×1000 like their World map. The alternative, 4000×2000 like their Giant World, makes the
   small German and Italian states visible but costs 4× the memory and speed.
3. **Modern features:** all on in the sandbox, and gated by era in the 1836 game (F7).
4. **Multiplayer:** it comes with the fork. Switch it on when there's a server to host it.
5. **npm 12 and Go:** install both on this machine (F0 step 3).

## 8. Risks

- **Codebase size:** 180k lines of TypeScript vs our 4k lines of JavaScript. Mitigations:
  - their `CLAUDE.md` and `docs/Architecture.md`;
  - keeping our code in our own folders;
  - reading before changing.
- **Upstream moves fast.** Merge often, and keep the one-line-hook rule.
- **Speed with ~250 nations holding land from turn 1.** That's an unusual start for OpenFront, so it gets measured
  first (F2).
- **Their client assumes their API** in places (accounts, cosmetics, telemetry), so F0's strip may take longer than a day.
- **Windows:** their npm scripts are cross-platform (`cross-env`), but `build.sh`, `deploy.sh` and similar are bash.
  Use Git Bash, or skip them for local work.
