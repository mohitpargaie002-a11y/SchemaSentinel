import { describe, it, expect } from "vitest";
import {
  SessionStatus,
  StateTransitionError,
  transitionSessionState,
  VALID_SESSION_TRANSITIONS,
} from "../../lib/domain/contracts.js";

describe("Session State Machine — Valid & Invalid Transitions", () => {
  it("allows standard happy path transitions: CREATED -> RUNNING -> REVIEW_READY -> AWAITING_APPROVAL -> APPROVED -> APPLYING -> VERIFYING -> COMPLETED", () => {
    let state: SessionStatus = "CREATED";

    state = transitionSessionState(state, "RUNNING");
    expect(state).toBe("RUNNING");

    state = transitionSessionState(state, "REVIEW_READY");
    expect(state).toBe("REVIEW_READY");

    state = transitionSessionState(state, "AWAITING_APPROVAL");
    expect(state).toBe("AWAITING_APPROVAL");

    state = transitionSessionState(state, "APPROVED");
    expect(state).toBe("APPROVED");

    state = transitionSessionState(state, "APPLYING");
    expect(state).toBe("APPLYING");

    state = transitionSessionState(state, "VERIFYING");
    expect(state).toBe("VERIFYING");

    state = transitionSessionState(state, "COMPLETED");
    expect(state).toBe("COMPLETED");
  });

  it("allows operator rejection from AWAITING_APPROVAL -> REJECTED", () => {
    const state = transitionSessionState("AWAITING_APPROVAL", "REJECTED");
    expect(state).toBe("REJECTED");
  });

  it("strictly fails closed on unauthorized direct jump from AWAITING_APPROVAL to APPLYING", () => {
    expect(() => transitionSessionState("AWAITING_APPROVAL", "APPLYING")).toThrow(StateTransitionError);
  });

  it("strictly fails closed on attempting to apply a REJECTED session", () => {
    expect(() => transitionSessionState("REJECTED", "APPLYING")).toThrow(StateTransitionError);
  });

  it("strictly fails closed on attempting to apply a COMPLETED session (terminal state immutability)", () => {
    expect(() => transitionSessionState("COMPLETED", "APPLYING")).toThrow(StateTransitionError);
    expect(() => transitionSessionState("COMPLETED", "RUNNING")).toThrow(StateTransitionError);
  });

  it("strictly fails closed on attempting to apply a FAILED session", () => {
    expect(() => transitionSessionState("FAILED", "APPLYING")).toThrow(StateTransitionError);
  });

  it("handles VERIFICATION_FAILED terminal state from VERIFYING", () => {
    const state = transitionSessionState("VERIFYING", "VERIFICATION_FAILED");
    expect(state).toBe("VERIFICATION_FAILED");
    expect(() => transitionSessionState("VERIFICATION_FAILED", "APPLYING")).toThrow(StateTransitionError);
  });

  it("ensures all terminal states have zero outbound transitions", () => {
    const terminalStates: SessionStatus[] = ["COMPLETED", "REJECTED", "FAILED", "VERIFICATION_FAILED"];
    for (const t of terminalStates) {
      expect(VALID_SESSION_TRANSITIONS[t]).toEqual([]);
    }
  });
});
