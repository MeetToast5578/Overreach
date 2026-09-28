# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run inst             # Install deps (uses npm ci --ignore-scripts — do NOT use npm install)
npm run dev              # Run client + server in dev mode with hot reload
npm run start:client     # Client only
npm run start:server-dev # Server only
npm test                 # Run all tests (Vitest)
npm run test:coverage    # Tests with coverage
npm run lint             # Oxlint + ESLint
npm run lint:fix         # Oxlint + ESLint with auto-fix
npm run format           # Prettier
npm run build-prod       # Production build
```

**Run a single test file:**

```bash
npx vitest tests/YourTest.test.ts --run
npx vitest NationAllianceBehavior --run # match by name pattern
```

## Architecture

OpenFront.io is a real-time multiplayer territorial strategy game. There are four components:

1. **`src/core/`** — Deterministic game simulation. Pure TypeScript with **no external dependencies**. Must remain fully deterministic (seeded PRNG, no floating-point math). Runs in a Web Worker thread. All `src/core` changes **must** include tests.
2. **`src/client/`** — Rendering (Pixi.js/WebGL), UI (Lit web components + Tailwind CSS 4), WebSocket communication.
3. **`src/server/`** — Game coordination, intent relay, WebSocket management (Node.js/Express/ws).
4. **API** — Closed-source Cloudflare Worker handling auth, stats, cosmetics, monetization. Not in this repo.

### Simulation Flow (Intent → Execution)

The game simulation runs **on each client**, not the server. The server only relays intents.

1. Player action → client creates an **Intent** → sent to server
2. Server bundles all intents for the tick into a **Turn** → relays to all clients
3. Client forwards Turn to the Core worker
4. Core creates an **Execution** for each intent
5. Core calls `executeNextTick()` — all executions run and mutate game state
6. Core sends **GameUpdates** back to client → client renders

Intents and all wire messages are Zod-validated schemas defined in `src/core/Schemas.ts`.
Every WebSocket frame is a compact binary encoding of those schemas
(`src/core/ZbinWire.ts`, library docs in `zbin/README.md`). HTTP stays JSON.

### CDN / Static Assets

The game server only serves `index.html` and the WebSocket. All other assets (JS bundle, images, maps, worker) come from a CDN bucket. `CDN_BASE` is an empty string in dev (falls back to same-origin) and a full origin (e.g. `https://cdn.example.com`) in production. It is set as both a Vite build-time variable and a server runtime env var.

## Key Files

| File                        | Purpose                                |
| --------------------------- | -------------------------------------- |
| `src/core/Schemas.ts`       | All intent/message types (Zod schemas) |
| `src/core/GameRunner.ts`    | Simulation orchestrator                |
| `src/core/game/GameImpl.ts` | Game state implementation              |
| `src/server/GameServer.ts`  | Main WebSocket server, game loop       |
| `src/server/Master.ts`      | Lobby and game registry                |
| `tests/util/Setup.ts`       | Test helper — creates test games       |
| `docs/Architecture.md`      | Architecture overview                  |
| `zbin/README.md`            | Binary wire format for zod schemas     |
| `docs/Auth.md`              | JWT/auth flow                          |
| `docs/API.md`               | Public API endpoints                   |
| `vite.config.ts`            | Build config, CDN handling             |

## UI Text / i18n

All user-visible text must go through `translateText()` and have a corresponding entry added to `resources/lang/en.json`. Translations are managed via Crowdin. DO NOT modify any other translation files.

## Testing Patterns

Tests use a `setup()` helper from `tests/util/Setup.ts` that creates a full game instance with map data from `tests/testdata/maps/`. Write tests that exercise the core simulation directly — not mocks.

## Tech Stack

- **Bundler:** Vite + TypeScript 5.7
- **Rendering:** Pixi.js (WebGL)
- **UI Components:** Lit (LitElement) + Tailwind CSS 4
- **Audio:** Howler.js
- **Schemas/Validation:** Zod
- **Testing:** Vitest
- **Server:** Node.js, Express, ws (WebSocket)

## Overreach fork

This repo is **Overreach**, a fork of OpenFront (AGPL-3.0). The plan is `SANDBOX.md` (F0–F8); `ROADMAP.md` §3
holds the 1836 world data. `legacy/` is the pre-fork engine, read-only.

- Our code lives in `src/core/overreach/`, `src/client/overreach/`, `tests/overreach/`. Changes to upstream files are
  one-line hooks, and features we don't use are hidden (`src/client/overreach/overreach.css`), not deleted, so
  `git merge upstream/main` stays cheap.
- Keep "© OpenFront™ and Contributors" (`resources/lang/en.json` → `copyright`) visible. Never call the game OpenFront.
- `proprietary/` holds Overreach's own assets under OpenFront's file names; none of OpenFront's remain there.
- Never call OpenFront's API or CDN. Builds without `DOMAIN` point the API at localhost.
- On this machine: npm 11.19, so install with `npm ci --ignore-scripts --engine-strict=false` until npm 12.1.0 is
  installed. `tests/UpdateRegister.test.ts` fails without `jq` (a deploy-script test, not ours), and
  `MainInitialize`, `InventoryModal` and `UpdateFlagLatest` can time out under full-suite load but pass alone.
- `tests/server/RenderHtml.test.ts` fails whenever a build exists in `static/` (upstream behaviour); delete `static/`
  before running the full suite.
- Browser checks on Windows: `.claude/skills/run-openfront/` targets Ubuntu. Copy `driver.mjs` and `game.mjs` to a
  scratch folder, `npm i playwright-core` there, import from `playwright-core`, launch with
  `executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"` and `--enable-unsafe-swiftshader`, and
  change the start button key from `single_modal.start` to `game_settings.start`.
