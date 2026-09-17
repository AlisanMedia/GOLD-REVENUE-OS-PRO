import { describe, expect, it } from "vitest";
import { CUSTOMER_STATES } from "./customer-os";
import {
  dispatchEvents,
  EVENT_CONTRACTS,
  EVENT_TYPES,
  isAllowedTransition,
  TRANSITION_MATRIX,
  validateEventContract,
  type DomainEvent,
  type EventConsumer,
  type EventDelivery,
  type EventDispatchPort,
} from "./state-event-engine";

function event(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: "00000000-0000-0000-0000-000000000010",
    tenantId: "00000000-0000-0000-0000-000000000001",
    customerId: "00000000-0000-0000-0000-000000000002",
    eventType: "customer.state_changed",
    eventVersion: 1,
    payload: { from_state: "NEW", to_state: "CONTACT_READY", reason_code: "ready", triggering_event: "operator.requested" },
    actorType: "HUMAN",
    actorId: "00000000-0000-0000-0000-000000000003",
    authority: "TRUSTED",
    correlationId: "00000000-0000-0000-0000-000000000004",
    causationId: null,
    occurredAt: "2026-09-16T00:00:00.000Z",
    ...overrides,
  };
}

class FakePort implements EventDispatchPort {
  deliveries: EventDelivery[] = [];
  completedConsumers = new Set<string>();
  completedOutbox: number[] = [];
  failedOutbox: number[] = [];
  deadLetter = false;

  claim(): Promise<readonly EventDelivery[]> { return Promise.resolve(this.deliveries); }
  beginConsumer(_tenantId: string, eventId: string, consumerName: string): Promise<boolean> {
    return Promise.resolve(!this.completedConsumers.has(`${eventId}:${consumerName}`));
  }
  completeConsumer(_tenantId: string, eventId: string, consumerName: string): Promise<void> {
    this.completedConsumers.add(`${eventId}:${consumerName}`);
    return Promise.resolve();
  }
  failConsumer(): Promise<void> { return Promise.resolve(); }
  completeOutbox(outboxId: number): Promise<void> { this.completedOutbox.push(outboxId); return Promise.resolve(); }
  failOutbox(outboxId: number): Promise<"pending" | "dead_letter"> {
    this.failedOutbox.push(outboxId);
    return Promise.resolve(this.deadLetter ? "dead_letter" : "pending");
  }
}

describe("lifecycle transition matrix", () => {
  it("contains every customer state and exactly 23 allowed directed transitions", () => {
    expect(Object.keys(TRANSITION_MATRIX).sort()).toEqual([...CUSTOMER_STATES].sort());
    expect(Object.values(TRANSITION_MATRIX).reduce((sum, policy) => sum + policy.to.length, 0)).toBe(23);
  });

  it.each([
    ["NEW", "CONTACT_READY"], ["OFFER_SENT", "INTERESTED"], ["OFFER_SENT", "NOT_INTERESTED"],
    ["RENEWAL_DUE", "RENEWED"], ["RENEWAL_DUE", "EXPIRED"], ["TRIAL_ACTIVE", "INTERESTED"],
    ["TRIAL_ACTIVE", "EXPIRED"], ["WINBACK", "INTERESTED"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(isAllowedTransition(from, to)).toBe(true);
  });

  it.each([
    ["NEW", "PAID"], ["PAID", "ACTIVE"], ["ACTIVE", "CHURNED"],
    ["EXPIRED", "ACTIVE"], ["OFFER_SENT", "PAID"], ["WINBACK", "PAID"],
  ] as const)("forbids %s -> %s", (from, to) => {
    expect(isAllowedTransition(from, to)).toBe(false);
  });
});

describe("event contracts", () => {
  it("defines every required Phase 3 event at schema version 1", () => {
    expect(Object.keys(EVENT_CONTRACTS).sort()).toEqual([...EVENT_TYPES].sort());
    expect(Object.values(EVENT_CONTRACTS).every((contract) => contract.version === 1)).toBe(true);
  });

  it("rejects untrusted payment/access/state authority", () => {
    expect(validateEventContract(event({ authority: "UNTRUSTED" }))).toContain("trusted_producer_required");
    expect(validateEventContract(event({ eventType: "payment.confirmed", authority: "UNTRUSTED", payload: { payment_id: "p", tx_hash: "t" } }))).toContain("trusted_producer_required");
  });

  it("reports missing payload keys and unsupported versions", () => {
    expect(validateEventContract(event({ eventVersion: 2, payload: {} }))).toEqual([
      "unsupported_event_version", "missing_payload_key:from_state", "missing_payload_key:to_state",
      "missing_payload_key:reason_code", "missing_payload_key:triggering_event",
    ]);
  });
});

describe("event dispatcher", () => {
  const consumer = (handle: EventConsumer["handle"]): EventConsumer => ({ name: "state-observer", accepts: ["customer.state_changed"], handle });

  it("completes a claimed event after an idempotent consumer", async () => {
    const port = new FakePort();
    port.deliveries = [{ outboxId: 7, event: event(), attemptNumber: 1 }];
    const calls: string[] = [];
    const summary = await dispatchEvents(port, [consumer((value) => { calls.push(value.id); return Promise.resolve(); })], "worker-1");
    expect(calls).toEqual([event().id]);
    expect(port.completedOutbox).toEqual([7]);
    expect(summary).toMatchObject({ claimed: 1, completed: 1, retried: 0 });
  });

  it("skips a duplicate completed consumer without repeating its mutation", async () => {
    const port = new FakePort();
    port.deliveries = [{ outboxId: 8, event: event(), attemptNumber: 2 }];
    port.completedConsumers.add(`${event().id}:state-observer`);
    let calls = 0;
    const summary = await dispatchEvents(port, [consumer(() => { calls += 1; return Promise.resolve(); })], "worker-1");
    expect(calls).toBe(0);
    expect(summary.duplicateConsumerSkips).toBe(1);
    expect(port.completedOutbox).toEqual([8]);
  });

  it("schedules a safe retry after a transient consumer failure", async () => {
    const port = new FakePort();
    port.deliveries = [{ outboxId: 9, event: event(), attemptNumber: 1 }];
    const summary = await dispatchEvents(port, [consumer(() => Promise.reject(new Error("temporary")))], "worker-1");
    expect(port.failedOutbox).toEqual([9]);
    expect(summary).toMatchObject({ retried: 1, completed: 0, deadLettered: 0 });
  });

  it("keeps terminal failures observable in the dead-letter path", async () => {
    const port = new FakePort();
    port.deadLetter = true;
    port.deliveries = [{ outboxId: 10, event: event(), attemptNumber: 8 }];
    const summary = await dispatchEvents(port, [consumer(() => Promise.reject(new Error("terminal")))], "worker-1");
    expect(summary.deadLettered).toBe(1);
    expect(summary.completed).toBe(0);
  });
});
