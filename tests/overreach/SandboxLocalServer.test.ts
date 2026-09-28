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
import { SandboxStepEvent } from "../../src/client/overreach/SandboxEvents";

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

  it("applies a paused edit as two turns, 250 ms later", () => {
    const before = turns.length;
    send({
      type: "sandbox",
      action: { kind: "set_gold", player: "p", gold: 1 },
    });
    expect(turns.length).toBe(before);
    vi.advanceTimersByTime(250);
    expect(turns.length).toBe(before + 2);
    expect(turns[before].intents.map((i) => i.type)).toEqual(["sandbox"]);
    expect(turns[before + 1].intents).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(turns.length).toBe(before + 2); // still paused
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
