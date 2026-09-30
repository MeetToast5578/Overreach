# Overreach handoff (30 Sep 2026)

Where the fork stands after F0–F8, G0 and G1, and what the next session should pick up. The plan is `MASTERPLAN.md`
(G0–G10); each phase has a **Status** block there. `SANDBOX.md` has F0–F8 (done). This file covers what those don't:
the state of the repo, what the owner has to decide, how to rebuild things, and the traps.

Read first: `CLAUDE.md` (rules and this machine's quirks), then `MASTERPLAN.md`. `legacy/HANDOFF.md` describes the
pre-fork engine; it's read-only.

## State

- **Plan:** F0–F8 and G0, G1 are done. **G2 (the grand-strategy shell) is mostly done.** Built and checked in Chrome:
  left-click selection, top bar, province and nation windows, outliner, curved country names, five map modes, save and
  load. Built but **never opened in a browser: the new-game page with nation picking** (`overreach/NewGame.ts`).
  Left: that browser check, an alerts row, the event window's look, and tooltips with breakdowns. Then G3.
- **Not pushed:** `main` is ahead of `origin` (`MeetToast5578/Overreach`, private). The owner allowed commits, not pushes.
  They said (30 Sep 2026) to automate everything since it's a private project with nothing to lose; that covered local
  commits and builds. Pushing, deploying and going public were never done or authorized.
- **The client is single-player only.** OpenFront's home page, lobbies, accounts, store, clans and ads are deleted
  (G0). `overreach/Title.ts` is the title screen (Continue, New game, Sandbox, Help, Settings, saved games). The server
  in `src/server/` still exists for multiplayer (G10).
- **One map:** Earth, 7,680 × 2,944 (6.9M land tiles). OpenFront's other 132 maps are deleted. `tests/testdata/maps/`
  keeps small copies for the tests.
- **Tests:** the whole suite passes except `tests/UpdateRegister.test.ts` (needs `jq`). `tests/overreach` has 85 tests
  (~30 s); `FullGameSnapshot` is slow (~2.5 min).
- **Play it:** `npm run dev`, then New game → click a nation on the map → Play as. Sandbox is on the title screen.
  `npm run build-static` writes `static-site/` (95 MB, 1,488 files), which runs with no game server. It's up to date
  with the new-game page. No server is running now; start one with
  `cd static-site; python -m http.server 9100` (PowerShell `Start-Process`, and keep the PID to stop it later).

## Waiting on the owner

Don't do these without the owner's go-ahead.

1. **G1 sign-off:** look at World 1836 on screen in Europe, the Americas, India and Africa. The game also needs a check on
   a real GPU: the Earth map's textures are 22M pixels, and I could only test on a software renderer (see G1's status).
   If it's too heavy, `build_earth.py --width 5632` is the fallback.
2. **Push** the commits.
3. **Deploy** `static-site/` (fits GitHub Pages and Cloudflare Pages; the biggest files are the 22 MB map and 16 MB relief).
4. **Make the repo public and wire up the Source link** (`src/client/components/Footer.ts`, `SOURCE_URL`) before anyone
   else plays (AGPL).
5. **npm 12.1.0:** `npm i -g npm@12.1.0` (possible since 29 Sep 2026, 17:11 UTC). After that `npm run inst` works and the
   `--engine-strict=false` workaround in `CLAUDE.md` can go.

## Rebuilding the map and the scenario

The inputs are outside git: `tools/overreach/data/` (git-ignored) holds the ETOPO 2022 GeoTIFF (466 MB), the Natural Earth II
zip, `world_1815.geojson`, and OWID's `population.csv`; the legacy builder's rasters are in `../My Map Game/build`.
Where to download each is in `build_earth.py`'s docstring and `CREDITS.md`.

```bash
python tools/overreach/build_earth.py --legacy "../My Map Game/build" \
  --etopo tools/overreach/data/ETOPO_2022_v1_60s_surface.tif --relief tools/overreach/data/NE2_LR_LC_SR_W.zip
(cd map-generator && go run . --maps=earth) # writes resources/maps/earth and src/core/game/Maps.gen.ts
python tools/overreach/build_1836.py --legacy "../My Map Game/build" --geojson tools/overreach/data/world_1815.geojson
```

Each takes about a minute. `--width` on the first changes the map's size; the second reads the size from the map.

## Next work

1. **Finish G2** (`MASTERPLAN.md` G2 status has the list):
   - **Browser-check the new-game page first.** The script I was about to run: open the site, click New game
     (`overreach-title a[href="#modal=new-game"]`), wait for the `#ov-newgame-map` canvas, hover and
     click Prussia on the preview (map position = lon/lat on the 360° × 138° equirectangular frame, lat 80°N at the
     top), confirm the button says "Play as Prussia", press it, and confirm the game starts as that nation
     (`document.querySelector("build-menu").game.myPlayer().name()`). Screenshots of hover and pick go in a scratch folder.
     Things likely to be off: preview resolution and click mapping, hover card placement, start-up time of the preview.
   - Then the **alerts row** (a formable is ready, an event waits, a coalition forms, a truce ends), the **event window**
     restyle (`StoryPanel.ts`), and **tooltips that break numbers down** (top bar first).
   - Run `npx tsc --noEmit`, `npm run lint`, the tests, update the G2 status, commit.
2. **G3, war and peace** (occupation, war score, peace deals), which also fixes the "too many wars" problem: 218 wars were open
   by 1846. `Diplomacy.ts` holds the knobs (`WAR_CHANCE`, `PEACE_TICKS`), but they get replaced.
3. Then G4–G10 in `MASTERPLAN.md`'s order. The old `SANDBOX.md` F6 leftovers (the AI betraying its own subjects, humans
   demanding vassalage) go into G3 and G2.

## Code map

- **Core (`src/core/overreach/`):**
  - `Scenario`, `ScenarioExecution`: the file format and the start;
  - `Provinces`, `ProvinceExecution`, `ProvinceView`: the province layers, flips, and the updates sent to the client;
  - `Cities`: named towns;
  - `Diplomacy`, `DiplomacyExecution`: subjects, coalitions, revolts, civil wars, formables and wars;
  - `Calendar`, `CalendarExecution`, `Economy`, `Events`, `Endings`, `Formables`: the calendar game;
  - `OverreachIntent`: the player's `form` and `event` answers;
  - `Sandbox`, `SandboxExecution`: god-mode edits.
- **Client (`src/client/overreach/`):**
  - `Title`, `NewGame`: the title screen and the new-game page (`previewGrid` draws the owners map, `start()` builds the
    `gameStartInfo` and dispatches `join-lobby`);
  - `ScenarioFile`: the built-in list and scenario loading;
  - `Saves`: save, list, delete, load (core snapshot, gzipped, in IndexedDB) and `setCurrentGame`;
  - `Selection`: the selection store and left-click-selects; `SelectionWindow`, `Outliner`, `TopBar`, `DateText`;
  - `CountryNames` (curved names), `MapMode` and `MapModes` (palettes and legends);
  - `ProvinceLayer`, `ProvincePass`: borders, labels, centroids and the map-mode pass;
  - `SandboxPanel`;
  - `CalendarBar`, `StoryPanel`: event cards and form buttons (the date moved to `TopBar`);
  - `Renames`, `EndingTitle`, `StaticSite`;
  - `Layers`: plugs the rest into `GameRenderer` (adds the `overreach-gsg` body class, which hides OpenFront's left sidebar).
- **Client files from OpenFront that remain:** `Main.ts` (a single-player rewrite), `SinglePlayerModal`, `ClientGameRunner`,
  `LocalServer`, `Transport`, `hud/`, `render/`, the settings and help modals. `Api`, `Auth`, `ServerList` and the CrazyGames
  and Steam wrappers stay because the game path imports them; they can go with multiplayer.
- **Upstream merges:** run `scripts/overreach/merge-upstream.sh`. It keeps the files we deleted deleted and stops at
  anything else that conflicts (`Main.ts`, `index.html`, our hooks).
- **Builders:** `tools/overreach/build_earth.py` (the map, geometry in `earthgeo.py`), `build_1836.py` with its data in
  `world1836.py` (nations, rules, town checks, 1836 names, founding years).

## Traps

- **Determinism:** no floats in core (for example, `FORM_PERCENT` is an integer percent), and sort a `Set` before
  iterating it when the order matters.
- **New execution state:** it needs a snapshot type in `ExecutionRegistry`. `tests/core/snapshot/FullGameSnapshot` checks that
  everything is covered; list anything that is never stored in its `neverStored`, and derived fields in `tests/util/Snapshot.ts`.
  Adding a field to a province record changes the snapshot schema, so regenerate the fixture:
  `git rm tests/testdata/snapshots/format-1.snapshot.gz; mkdir tests/testdata/snapshots; UPDATE_SNAPSHOT_FIXTURES=1 npx vitest tests/core/snapshot/SnapshotFixtures.test.ts --run`.
- **Province flips** wait for `ProvinceExecution`'s tick, not `conquer()`. After a restore, the lazy index must use
  `indexBefore()`, or it counts tiles twice.
- **Human-picked nation:** the human replaces scenario nation `player`. Anything keyed on scenario nations (subjects,
  events) must map through it. `DiplomacyExecution.init` and `Events.player()` already do.
- **Game end:** calendar games skip upstream's `WinCheckExecution`; `CalendarExecution` runs the endings instead.
- **Balance:** aggression counts tiles, not provinces, with coalitions at 3,000. Counting provinces made coalitions
  form over tiny provinces. Liberty compares land, not troops, which had freed vassals mid-war. The Earth map has 14.7×
  the tiles of the old one, so these tile-count thresholds (and attack pace) need retuning in G3.
- **Tests and maps:** the tests that load World 1836 read Earth from `resources/maps` (the helper falls back to it when a
  map isn't in `tests/testdata/maps`). Duplicate object keys pass Vitest but fail `tsc`, which `npm run build-prod` runs: run
  `npx tsc --noEmit` before a build.
- **Windows shell:** Bash eats backslashes and Python writes CRLF (open files with `newline=""`). For fiddly edits, write a
  script file and run it. `python3.13` processes started for a test server survive `taskkill`: stop them with
  `Get-Process python3.13 | Stop-Process`, or the static build dies with `EBUSY`.
- **Static build:** delete `static/` before running the full test suite.
- **Browser checks:** follow the recipe in `CLAUDE.md`. The drivers aren't in the repo. Launch Chrome with only
  `--enable-unsafe-swiftshader`; extra GL flags make the game refuse the renderer.
