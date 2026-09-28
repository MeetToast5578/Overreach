import type { GameEvent } from "../../core/EventBus";
import type { SandboxAction } from "../../core/overreach/Sandbox";

// Transport sends this as a "sandbox" intent.
export class SendSandboxIntentEvent implements GameEvent {
  constructor(public readonly action: SandboxAction) {}
}

// LocalServer runs one turn while paused.
export class SandboxStepEvent implements GameEvent {}
