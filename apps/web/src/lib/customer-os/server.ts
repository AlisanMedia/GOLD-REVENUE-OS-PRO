import "server-only";

import { randomUUID } from "node:crypto";
import type { AppRole } from "@gold-revenue-os/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";

export type CustomerRow = {
  id: string;
  tenant_id: string;
  external_ref: string | null;
  display_name: string | null;
  state: string;
  segment: string | null;
  risk_level: string;
  assigned_manager_id: string | null;
  automation_paused: boolean;
  source_type: string | null;
  source_name: string | null;
  source_record_ref: string | null;
  created_at: string;
  updated_at: string;
};

export type IdentityRow = { id: string; customer_id: string; identity_type: string; identity_value: string; normalized_value: string; is_primary: boolean; source_type: string | null; source_name: string | null };
export type ProfileRow = Record<string, unknown> & { customer_id: string; tenant_id: string };
export type MemoryRow = { id: string; customer_id: string; memory_key: string; memory_value: unknown; source_type: string; source_id: string | null; confidence: number; observed_at: string; superseded_at: string | null };
export type StateHistoryRow = { id: string; customer_id: string; from_state: string | null; to_state: string; reason_code: string | null; actor_type: string; actor_id: string | null; correlation_id: string; causation_id: string | null; triggering_event: string; triggering_event_id: string | null; state_change_event_id: string | null; occurred_at: string; created_at: string };
export type EventRow = { id: string; customer_id: string | null; event_type: string; event_version: number; actor_type: string; producer: string; authority: string; correlation_id: string; causation_id: string | null; payload: Record<string, unknown>; occurred_at: string; recorded_at: string };
export type TransitionAttemptRow = { id: string; customer_id: string; expected_from_state: string; observed_from_state: string; to_state: string; reason_code: string; result: string; rejection_code: string | null; correlation_id: string; triggering_event: string; created_at: string };
export type OutboxRow = { id: number; event_id: string; status: string; attempts: number; max_attempts: number; available_at: string; last_error_code: string | null; last_error_message: string | null; completed_at: string | null; dead_lettered_at: string | null; updated_at: string };

export type TenantContext = { userId: string; tenantId: string; role: AppRole };

export async function requireCustomerTenant(allowedRoles?: readonly AppRole[]): Promise<TenantContext> {
  const context = await getUserContext();
  if (!context || context.tenants.length === 0) throw new Error("UNAUTHORIZED");
  const tenant = context.tenants[0]!;
  if (allowedRoles && !allowedRoles.includes(tenant.role)) throw new Error("FORBIDDEN");
  return { userId: context.user.id, tenantId: tenant.id, role: tenant.role };
}

export function apiError(error: unknown, fallback = "Request failed"): Response {
  const message = error instanceof Error ? error.message : fallback;
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
  return Response.json({ error: { code: message, message: status < 500 ? message.toLowerCase().replaceAll("_", " ") : fallback, request_id: randomUUID() } }, { status });
}

export async function getCustomer360(customerId: string) {
  const { tenantId } = await requireCustomerTenant();
  const supabase = await createSupabaseServerClient();
  const [customerResult, identityResult, profileResult, memoryResult, historyResult, eventResult, transitionResult] = await Promise.all([
    supabase.from("customers").select("id,tenant_id,external_ref,display_name,state,segment,risk_level,assigned_manager_id,automation_paused,source_type,source_name,source_record_ref,created_at,updated_at").eq("tenant_id", tenantId).eq("id", customerId).maybeSingle(),
    supabase.from("customer_identities").select("id,customer_id,identity_type,identity_value,normalized_value,is_primary,source_type,source_name").eq("tenant_id", tenantId).eq("customer_id", customerId).order("is_primary", { ascending: false }),
    supabase.from("customer_profiles").select("*").eq("tenant_id", tenantId).eq("customer_id", customerId).maybeSingle(),
    supabase.from("customer_memory").select("id,customer_id,memory_key,memory_value,source_type,source_id,confidence,observed_at,superseded_at").eq("tenant_id", tenantId).eq("customer_id", customerId).is("superseded_at", null).order("observed_at", { ascending: false }),
    supabase.from("customer_state_history").select("id,customer_id,from_state,to_state,reason_code,actor_type,actor_id,correlation_id,causation_id,triggering_event,triggering_event_id,state_change_event_id,occurred_at,created_at").eq("tenant_id", tenantId).eq("customer_id", customerId).order("created_at", { ascending: false }),
    supabase.from("domain_events").select("id,customer_id,event_type,event_version,actor_type,producer,authority,correlation_id,causation_id,payload,occurred_at,recorded_at").eq("tenant_id", tenantId).eq("customer_id", customerId).order("recorded_at", { ascending: false }).limit(100),
    supabase.from("customer_state_transition_attempts").select("id,customer_id,expected_from_state,observed_from_state,to_state,reason_code,result,rejection_code,correlation_id,triggering_event,created_at").eq("tenant_id", tenantId).eq("customer_id", customerId).order("created_at", { ascending: false }).limit(100),
  ]);
  const failure = [customerResult, identityResult, profileResult, memoryResult, historyResult, eventResult, transitionResult].find((result) => result.error);
  if (failure?.error) throw new Error("CUSTOMER_READ_FAILED");
  if (!customerResult.data) throw new Error("CUSTOMER_NOT_FOUND");
  return { customer: customerResult.data as CustomerRow, identities: (identityResult.data ?? []) as IdentityRow[], profile: (profileResult.data ?? null) as ProfileRow | null, memory: (memoryResult.data ?? []) as MemoryRow[], state_history: (historyResult.data ?? []) as StateHistoryRow[], events: (eventResult.data ?? []) as EventRow[], transition_attempts: (transitionResult.data ?? []) as TransitionAttemptRow[] };
}

export async function getEventDiagnostics() {
  const { tenantId } = await requireCustomerTenant(["super_admin", "manager"]);
  const supabase = await createSupabaseServerClient();
  const [eventResult, outboxResult] = await Promise.all([
    supabase.from("domain_events").select("id,customer_id,event_type,event_version,actor_type,producer,authority,correlation_id,causation_id,payload,occurred_at,recorded_at").eq("tenant_id", tenantId).order("recorded_at", { ascending: false }).limit(200),
    supabase.from("event_outbox").select("id,event_id,status,attempts,max_attempts,available_at,last_error_code,last_error_message,completed_at,dead_lettered_at,updated_at").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(200),
  ]);
  if (eventResult.error || outboxResult.error) throw new Error("EVENT_DIAGNOSTICS_READ_FAILED");
  return { events: (eventResult.data ?? []) as EventRow[], outbox: (outboxResult.data ?? []) as OutboxRow[] };
}
