import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/EventBus";
import type { GameStartInfo, Turn } from "../../src/core/Schemas";

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-jwt"),
  getPersistentID: vi.fn(() => "123e4567-e89b-12d3-a456-426614174000"),
}));
vi.mock("../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "https://api.test"),
}));
vi.mock("src/client/ClientEnv", () => ({
  ClientEnv: {
    turnIntervalMs: vi.fn(() => 100),
    gitCommit: vi.fn(() => "DEV"),
  },
}));

import { LocalServer } from "../../src/client/LocalServer";
import {
  routeSandboxIntent,
  SandboxStepEvent,
  setSandboxControl,
} from "../../src/client/overreach/SandboxEvents";

const CLIENT_ID = "abCD1234";

describe("LocalServer in a paused sandbox", () => {
  let bus: EventBus;
  let server: LocalServer;
  let turns: Turn[];

  const send = (intent: object) =>
    server.onMessage({ type: "intent", intent } as never);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    bus = new EventBus();
    turns = [];
    server = new LocalServer(
      {
        gameStartInfo: {
          gameID: "gameID12",
          lobbyCreatedAt: 1000,
          config: { gameType: "Singleplayer", sandbox: true },
          players: [{ clientID: CLIENT_ID, username: "Me", clanTag: null }],
        } as unknown as GameStartInfo,
        playerName: "Me",
        playerClanTag: null,
      } as never,
      false,
      bus,
    );
    server.updateCallback(
      () => {},
      (msg) => {
        if (msg.type === "turn") turns.push(msg.turn);
      },
    );
    server.start();
    send({ type: "toggle_pause", paused: true });
  });

  afterEach(() => {
    server.endGame();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("applies a paused edit as three turns, 250 ms later", () => {
    const before = turns.length;
    send({
      type: "sandbox",
      action: { kind: "set_gold", player: "p", gold: 1 },
    });
    expect(turns.length).toBe(before);
    vi.advanceTimersByTime(250);
    expect(turns.length).toBe(before + 3);
    expect(turns[before].intents.map((i) => i.type)).toEqual(["sandbox"]);
    expect(turns[before + 1].intents).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(turns.length).toBe(before + 3); // still paused
  });

  it("applies a paused answer to an event as three turns, 250 ms later", () => {
    const before = turns.length;
    send({
      type: "overreach",
      action: { kind: "event", event: "opium_war", option: 0 },
    });
    expect(turns.length).toBe(before);
    vi.advanceTimersByTime(250);
    expect(turns.length).toBe(before + 3);
    expect(turns[before].intents.map((i) => i.type)).toEqual(["overreach"]);
    expect(turns[before + 1].intents).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(turns.length).toBe(before + 3); // still paused
  });

  it("steps one turn while paused, and not while running", () => {
    const before = turns.length;
    bus.emit(new SandboxStepEvent());
    expect(turns.length).toBe(before + 1);

    send({ type: "toggle_pause", paused: false });
    const running = turns.length;
    bus.emit(new SandboxStepEvent());
    expect(turns.length).toBe(running);
  });
});

describe("routeSandboxIntent", () => {
  const attack = { type: "attack", targetID: null, troops: 5 } as const;
  const pause = { type: "toggle_pause", paused: true } as const;
  afterEach(() => setSandboxControl(false, null));

  it("passes everything through outside a sandbox", () => {
    expect(routeSandboxIntent(attack)).toBe(attack);
  });

  it("drops orders while observing and sends them as the controlled player", () => {
    setSandboxControl(true, null);
    expect(routeSandboxIntent(attack)).toBeNull();
    expect(routeSandboxIntent(pause)).toBe(pause);
    setSandboxControl(true, "nation01");
    expect(routeSandboxIntent(attack)).toEqual({
      type: "sandbox",
      action: { kind: "as", player: "nation01", intent: attack },
    });
    expect(routeSandboxIntent(pause)).toBe(pause);
  });
});
