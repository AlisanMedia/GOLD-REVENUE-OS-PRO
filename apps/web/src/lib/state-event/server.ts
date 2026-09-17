import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dispatchEvents,
  type DomainEvent,
  type EventConsumer,
  type EventDelivery,
  type EventDispatchPort,
  type EventType,
  type LifecycleActorType,
  type EventAuthority,
} from "@gold-revenue-os/domain";

type ClaimRow = {
  outbox_id: number;
  tenant_id: string;
  event_id: string;
  event_type: EventType;
  event_version: number;
  customer_id: string | null;
  payload: Record<string, unknown>;
  actor_type: LifecycleActorType;
  actor_id: string | null;
  authority: EventAuthority;
  correlation_id: string;
  causation_id: string | null;
  occurred_at: string;
  attempt_number: number;
};

function expectRpc<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export function createSupabaseEventDispatchPort(client: SupabaseClient): EventDispatchPort {
  return {
    async claim(workerId, batchSize) {
      const { data, error } = await client.rpc("claim_event_outbox", {
        worker_id_value: workerId,
        batch_size_value: batchSize,
        lease_seconds_value: 60,
      });
      const rows = expectRpc<ClaimRow[]>(data, error);
      return rows.map((row): EventDelivery => ({
        outboxId: row.outbox_id,
        attemptNumber: row.attempt_number,
        event: {
          id: row.event_id,
          tenantId: row.tenant_id,
          customerId: row.customer_id,
          eventType: row.event_type,
          eventVersion: row.event_version,
          payload: row.payload,
          actorType: row.actor_type,
          actorId: row.actor_id,
          authority: row.authority,
          correlationId: row.correlation_id,
          causationId: row.causation_id,
          occurredAt: row.occurred_at,
        } satisfies DomainEvent,
      }));
    },
    async beginConsumer(tenantId, eventId, consumerName, workerId) {
      const { data, error } = await client.rpc("begin_event_consumption", {
        target_tenant_id: tenantId,
        target_event_id: eventId,
        consumer_name_value: consumerName,
        worker_id_value: workerId,
      });
      return expectRpc<boolean>(data, error);
    },
    async completeConsumer(tenantId, eventId, consumerName, workerId) {
      const { error } = await client.rpc("complete_event_consumption", {
        target_tenant_id: tenantId,
        target_event_id: eventId,
        consumer_name_value: consumerName,
        worker_id_value: workerId,
        result_hash_value: "completed",
      });
      expectRpc<boolean>(true, error);
    },
    async failConsumer(tenantId, eventId, consumerName, workerId, errorCode) {
      const { error } = await client.rpc("fail_event_consumption", {
        target_tenant_id: tenantId,
        target_event_id: eventId,
        consumer_name_value: consumerName,
        worker_id_value: workerId,
        error_code_value: errorCode,
      });
      expectRpc<boolean>(true, error);
    },
    async completeOutbox(outboxId, workerId) {
      const { error } = await client.rpc("complete_event_outbox", {
        outbox_id_value: outboxId,
        worker_id_value: workerId,
      });
      expectRpc<boolean>(true, error);
    },
    async failOutbox(outboxId, workerId, errorCode, message) {
      const { data, error } = await client.rpc("fail_event_outbox", {
        outbox_id_value: outboxId,
        worker_id_value: workerId,
        error_code_value: errorCode,
        error_message_value: message,
      });
      return expectRpc<"pending" | "dead_letter" | "not_claimed">(data, error);
    },
  };
}

export async function runEventDispatcher(
  serviceClient: SupabaseClient,
  consumers: readonly EventConsumer[],
  workerId: string,
  batchSize = 25,
) {
  return dispatchEvents(createSupabaseEventDispatchPort(serviceClient), consumers, workerId, batchSize);
}
