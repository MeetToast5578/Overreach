# Overreach handoff (29 Sep 2026)

Where the fork stands after F0–F8, and what the next session should pick up. The detail for each phase is in its
**Status** block in `SANDBOX.md`. This file covers what those blocks don't: the state of the repo, what the owner has
to decide, the next work, and the traps.

Read first: `CLAUDE.md` (rules and this machine's quirks), then `SANDBOX.md` §5. `legacy/HANDOFF.md` describes the
pre-fork engine; it's read-only.

## State

- **Plan:** F0–F8 each have a first pass, one commit per slice (`git log --oneline 4845bab8..`). HEAD is `fad5ec61`
  and the tree is clean.
- **Not pushed:** `main` is 12 commits ahead of `origin` (`MeetToast5578/Overreach`, private). The owner allowed
  commits, not pushes.
- **Tests (29 Sep):** `tests/overreach` has 85 tests and passes in about 30 s. `FullGameSnapshot` has 12 and passes in
  about 2.5 min. The full suite has the known machine failures that `CLAUDE.md` lists.
- **Play it:** `npm run dev`, then Solo → "World 1836" → "Your nation" → Start. The Sandbox tab starts you as an
  observer. `npm run build-static` writes `static-site/`, which runs single-player and the sandbox with no game server.

## Waiting on the owner

Don't do these without the owner's go-ahead.

1. **F3 sign-off:** look at World 1836 on screen in Europe, the Americas, India and Africa.
2. **Push** the 12 commits.
3. **Deploy** `static-site/` (638 MB, 2,102 files, 588 MB of it maps; fits GitHub Pages or Cloudflare Pages).
4. **Make the repo public and wire up the Source link** before anyone else plays (AGPL).
5. **npm 12.1.0:** it can be installed after 29 Sep 2026, 17:11 UTC (`npm i -g npm@12.1.0`). After that, `npm run inst`
   works and the `--engine-strict=false` workaround in `CLAUDE.md` can go.

## Next work, in suggested order

**Superseded (30 Sep 2026) by `MASTERPLAN.md`**, whose §9 says where each item below went.

1. **Too many wars.** 218 were open by 1846, mostly coalition members' and small skirmishes'. The knobs are in
   `Diplomacy.ts`:
   - `WAR_CHANCE`: 1 in 4 per AI nation per year;
   - `PEACE_TICKS`: 3 years;
   - coalitions and event wars, which declare wars for every member.

   The 10-year figures in F7's status came from a throwaway run that isn't in the repo. To measure again, load
   `resources/scenarios/world-1836.json` the way `tests/overreach/Provinces.test.ts:318` does, run 6,000 ticks, and
   count live nations, subjects and `diplomacy.wars.size`. The target is F7's table: 139 nations alive after 10 years.

2. **Era units (M11).** An 1836 army still fights like a 1950 one. Gate or rescale through `Config`, the way
   `eraLocked` does.
3. **Government and stability (M8), trade goods (M12), more events (`Events.ts`) and formables (`Formables.ts`).**
4. **Population scaled per country** (ROADMAP §3.6); today one factor, 0.137, covers the world. Also historical town
   names. Both belong in `tools/overreach/build_1836.py`.
5. **Diplomacy, from `SANDBOX.md` F6:** the AI can still betray its own subjects, and protecting them needs a hook in
   its alliance code. Humans also need a way to demand vassalage or release nations outside the sandbox (M14's
   interface).
6. **Multiplayer:** later, on upstream's `Dockerfile` server.

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
  - `ScenarioFile`: the built-in list, the nation picker, save and load;
  - `ProvinceLayer`, `ProvincePass`: borders and labels;
  - `SandboxPanel`;
  - `CalendarBar`, `StoryPanel`: the date, event cards and form buttons;
  - `Renames`, `EndingTitle`, `StaticSite`;
  - `Layers`: plugs the rest into `GameRenderer`.
- **Upstream hooks:** 27 files plus `en.json` (`git diff --stat 4845bab8..HEAD -- src ':!src/core/overreach' ':!src/client/overreach'`). The
  biggest are `SinglePlayerModal`, `GameRunner`, `LocalServer`, `GameView` and `Transport`. Keep new hooks to one
  line, so merging upstream stays cheap.
- **World 1836 builder:** `tools/overreach/build_1836.py`, with its data in `world1836.py`. It writes
  `resources/scenarios/world-1836.json` (178 nations, 5,352 provinces). Its inputs live outside the repo:
  - `../My Map Game/build` (present);
  - historical-basemaps' `geojson/world_1815.geojson`. The only copy was in a session scratchpad, which gets cleared,
    so download it again from `github.com/aourednik/historical-basemaps` (GPL-3.0, which makes the scenario GPL).

## Traps

- **Determinism:** no floats in core (for example, `FORM_PERCENT` is an integer percent), and sort a `Set` before
  iterating it when the order matters.
- **New execution state:** it needs a snapshot type in `ExecutionRegistry`. `tests/core/snapshot/FullGameSnapshot`
  checks that everything is covered; list anything that is never stored in its `neverStored`, and derived fields in
  `tests/util/Snapshot.ts`.
- **Province flips** wait for `ProvinceExecution`'s tick, not `conquer()`. After a restore, the lazy index must use
  `indexBefore()`, or it counts tiles twice.
- **Human-picked nation:** the human replaces scenario nation `player`. Anything keyed on scenario nations (subjects,
  events) must map through it. `DiplomacyExecution.init` and `Events.player()` already do.
- **Game end:** calendar games skip upstream's `WinCheckExecution`; `CalendarExecution` runs the endings instead.
- **Balance:** aggression counts tiles, not provinces, with coalitions at 3,000. Counting provinces made coalitions
  form over tiny provinces. Liberty compares land, not troops, which had freed vassals mid-war.
- **Windows shell:** Bash eats backslashes and Python writes CRLF. For fiddly edits, write a script file and run it.
- **Static build:** stop any server holding `static-site/` before rebuilding (`EBUSY`), and delete `static/` before
  running the full test suite.
- **Browser checks:** follow the recipe in `CLAUDE.md`. The drivers aren't in the repo.
