import type { GameEvent } from "../../core/EventBus";
import type { PlayerID } from "../../core/game/Game";
import type { OverreachAction } from "../../core/overreach/OverreachIntent";
import {
  SANDBOX_AS_TYPES,
  type SandboxAction,
} from "../../core/overreach/Sandbox";
import type { Intent } from "../../core/Schemas";

// Transport sends this as a "sandbox" intent.
export class SendSandboxIntentEvent implements GameEvent {
  constructor(public readonly action: SandboxAction) {}
}

// Transport sends this as an "overreach" intent: a player's own decision.
export class SendOverreachIntentEvent implements GameEvent {
  constructor(public readonly action: OverreachAction) {}
}

// LocalServer runs one turn while paused.
export class SandboxStepEvent implements GameEvent {}

// Who this client plays as in a sandbox game (null observes). Module state:
// one game runs at a time, and createSandboxPanel resets it for each game.
const control = { sandbox: false, player: null as PlayerID | null };

export function setSandboxControl(sandbox: boolean, player: PlayerID | null) {
  control.sandbox = sandbox;
  control.player = player;
}

type AsIntent = Extract<SandboxAction, { kind: "as" }>["intent"];

// Transport hook. In a sandbox, orders go out as the controlled player and
// are dropped while observing. Everything else passes through.
export function routeSandboxIntent(intent: Intent): Intent | null {
  if (!control.sandbox) return intent;
  if (!(SANDBOX_AS_TYPES as readonly string[]).includes(intent.type)) {
    return intent;
  }
  if (control.player === null) return null;
  return {
    type: "sandbox",
    action: { kind: "as", player: control.player, intent: intent as AsIntent },
  };
}
