import type { CustomerState } from "./customer-os";

export const LIFECYCLE_ACTOR_TYPES = ["SYSTEM", "HUMAN", "AGENT", "WEBHOOK", "SCHEDULER"] as const;
export type LifecycleActorType = (typeof LIFECYCLE_ACTOR_TYPES)[number];
export type EventAuthority = "UNTRUSTED" | "TRUSTED";

export const EVENT_TYPES = [
  "customer.created", "customer.updated", "customer.state_changed",
  "message.received", "message.sent", "qualification.completed",
  "offer.created", "offer.accepted", "payment.intent_created",
  "payment.confirmed", "payment.failed", "subscription.started",
  "subscription.renewal_due", "subscription.renewed", "subscription.expired",
  "access.granted", "access.revoked", "survey.completed",
  "escalation.created", "escalation.resolved", "agent.task_created",
  "agent.task_completed", "lifecycle.transition_rejected",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type TransitionPolicy = {
  to: readonly CustomerState[];
};

export const TRANSITION_MATRIX: Readonly<Record<CustomerState, TransitionPolicy>> = {
  NEW: { to: ["CONTACT_READY"] },
  CONTACT_READY: { to: ["CONTACTED"] },
  CONTACTED: { to: ["REPLIED"] },
  REPLIED: { to: ["QUALIFIED"] },
  QUALIFIED: { to: ["OFFER_SENT"] },
  OFFER_SENT: { to: ["INTERESTED", "NOT_INTERESTED"] },
  INTERESTED: { to: ["PAYMENT_PENDING"] },
  NOT_INTERESTED: { to: ["SURVEY_OFFERED"] },
  SURVEY_OFFERED: { to: ["SURVEY_COMPLETED"] },
  SURVEY_COMPLETED: { to: ["TRIAL_ACTIVE"] },
  TRIAL_ACTIVE: { to: ["INTERESTED", "EXPIRED"] },
  PAYMENT_PENDING: { to: ["PAID"] },
  PAID: { to: ["ACCESS_GRANTED"] },
  ACCESS_GRANTED: { to: ["ACTIVE"] },
  ACTIVE: { to: ["RENEWAL_DUE"] },
  RENEWAL_DUE: { to: ["RENEWED", "EXPIRED"] },
  RENEWED: { to: ["ACTIVE"] },
  EXPIRED: { to: ["CHURNED"] },
  CHURNED: { to: ["WINBACK"] },
  WINBACK: { to: ["INTERESTED"] },
};

export function isAllowedTransition(from: CustomerState, to: CustomerState): boolean {
  return TRANSITION_MATRIX[from].to.includes(to);
}

type EventContract = {
  version: 1;
  requiredPayloadKeys: readonly string[];
  trustedProducerRequired: boolean;
};

export const EVENT_CONTRACTS: Readonly<Record<EventType, EventContract>> = {
  "customer.created": { version: 1, requiredPayloadKeys: ["source"], trustedProducerRequired: false },
  "customer.updated": { version: 1, requiredPayloadKeys: ["changed_fields"], trustedProducerRequired: false },
  "customer.state_changed": { version: 1, requiredPayloadKeys: ["from_state", "to_state", "reason_code", "triggering_event"], trustedProducerRequired: true },
  "message.received": { version: 1, requiredPayloadKeys: ["conversation_id", "message_id", "channel"], trustedProducerRequired: false },
  "message.sent": { version: 1, requiredPayloadKeys: ["conversation_id", "message_id", "channel"], trustedProducerRequired: false },
  "qualification.completed": { version: 1, requiredPayloadKeys: ["qualification_id"], trustedProducerRequired: false },
  "offer.created": { version: 1, requiredPayloadKeys: ["offer_id"], trustedProducerRequired: false },
  "offer.accepted": { version: 1, requiredPayloadKeys: ["offer_id"], trustedProducerRequired: false },
  "payment.intent_created": { version: 1, requiredPayloadKeys: ["payment_id", "amount", "asset", "network"], trustedProducerRequired: true },
  "payment.confirmed": { version: 1, requiredPayloadKeys: ["payment_id", "tx_hash"], trustedProducerRequired: true },
  "payment.failed": { version: 1, requiredPayloadKeys: ["payment_id", "reason"], trustedProducerRequired: true },
  "subscription.started": { version: 1, requiredPayloadKeys: ["subscription_id", "starts_at", "ends_at"], trustedProducerRequired: true },
  "subscription.renewal_due": { version: 1, requiredPayloadKeys: ["subscription_id", "ends_at"], trustedProducerRequired: true },
  "subscription.renewed": { version: 1, requiredPayloadKeys: ["subscription_id", "new_ends_at"], trustedProducerRequired: true },
  "subscription.expired": { version: 1, requiredPayloadKeys: ["subscription_id"], trustedProducerRequired: true },
  "access.granted": { version: 1, requiredPayloadKeys: ["channel_access_id", "channel_id"], trustedProducerRequired: true },
  "access.revoked": { version: 1, requiredPayloadKeys: ["channel_access_id", "channel_id", "reason"], trustedProducerRequired: true },
  "survey.completed": { version: 1, requiredPayloadKeys: ["survey_response_id"], trustedProducerRequired: false },
  "escalation.created": { version: 1, requiredPayloadKeys: ["escalation_id", "category", "severity"], trustedProducerRequired: false },
  "escalation.resolved": { version: 1, requiredPayloadKeys: ["escalation_id", "resolution"], trustedProducerRequired: false },
  "agent.task_created": { version: 1, requiredPayloadKeys: ["task_id", "agent"], trustedProducerRequired: false },
  "agent.task_completed": { version: 1, requiredPayloadKeys: ["task_id", "outcome"], trustedProducerRequired: false },
  "lifecycle.transition_rejected": { version: 1, requiredPayloadKeys: ["from_state", "to_state", "reason_code", "rejection_code"], trustedProducerRequired: true },
};

export type DomainEvent = {
  id: string;
  tenantId: string;
  customerId: string | null;
  eventType: EventType;
  eventVersion: number;
  payload: Readonly<Record<string, unknown>>;
  actorType: LifecycleActorType;
  actorId: string | null;
  authority: EventAuthority;
  correlationId: string;
  causationId: string | null;
  occurredAt: string;
};

export function validateEventContract(event: DomainEvent): readonly string[] {
  const contract = EVENT_CONTRACTS[event.eventType];
  const issues: string[] = [];
  if (event.eventVersion !== contract.version) issues.push("unsupported_event_version");
  for (const key of contract.requiredPayloadKeys) {
    if (!(key in event.payload)) issues.push(`missing_payload_key:${key}`);
  }
  if (contract.trustedProducerRequired && event.authority !== "TRUSTED") {
    issues.push("trusted_producer_required");
  }
  return issues;
}

export type EventDelivery = {
  outboxId: number;
  event: DomainEvent;
  attemptNumber: number;
};

export type EventConsumer = {
  name: string;
  accepts: readonly EventType[];
  handle(event: DomainEvent): Promise<void>;
};

export interface EventDispatchPort {
  claim(workerId: string, batchSize: number): Promise<readonly EventDelivery[]>;
  beginConsumer(tenantId: string, eventId: string, consumerName: string, workerId: string): Promise<boolean>;
  completeConsumer(tenantId: string, eventId: string, consumerName: string, workerId: string): Promise<void>;
  failConsumer(tenantId: string, eventId: string, consumerName: string, workerId: string, errorCode: string): Promise<void>;
  completeOutbox(outboxId: number, workerId: string): Promise<void>;
  failOutbox(outboxId: number, workerId: string, errorCode: string, message: string): Promise<"pending" | "dead_letter" | "not_claimed">;
}

export type DispatchSummary = {
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
  duplicateConsumerSkips: number;
};

function errorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    return { code: error.name || "consumer_error", message: error.message.slice(0, 500) };
  }
  return { code: "consumer_error", message: "Unknown consumer failure" };
}

export async function dispatchEvents(
  port: EventDispatchPort,
  consumers: readonly EventConsumer[],
  workerId: string,
  batchSize = 25,
): Promise<DispatchSummary> {
  const deliveries = await port.claim(workerId, batchSize);
  const summary: DispatchSummary = { claimed: deliveries.length, completed: 0, retried: 0, deadLettered: 0, duplicateConsumerSkips: 0 };

  for (const delivery of deliveries) {
    const contractIssues = validateEventContract(delivery.event);
    if (contractIssues.length > 0) {
      const result = await port.failOutbox(delivery.outboxId, workerId, "invalid_event_contract", contractIssues.join(","));
      if (result === "dead_letter") summary.deadLettered += 1;
      else if (result === "pending") summary.retried += 1;
      continue;
    }

    const interested = consumers.filter((consumer) => consumer.accepts.includes(delivery.event.eventType));
    let failed = false;
    for (const consumer of interested) {
      const shouldRun = await port.beginConsumer(delivery.event.tenantId, delivery.event.id, consumer.name, workerId);
      if (!shouldRun) {
        summary.duplicateConsumerSkips += 1;
        continue;
      }
      try {
        await consumer.handle(delivery.event);
        await port.completeConsumer(delivery.event.tenantId, delivery.event.id, consumer.name, workerId);
      } catch (error) {
        const details = errorDetails(error);
        await port.failConsumer(delivery.event.tenantId, delivery.event.id, consumer.name, workerId, details.code);
        const result = await port.failOutbox(delivery.outboxId, workerId, details.code, details.message);
        if (result === "dead_letter") summary.deadLettered += 1;
        else if (result === "pending") summary.retried += 1;
        failed = true;
        break;
      }
    }
    if (!failed) {
      await port.completeOutbox(delivery.outboxId, workerId);
      summary.completed += 1;
    }
  }
  return summary;
}
