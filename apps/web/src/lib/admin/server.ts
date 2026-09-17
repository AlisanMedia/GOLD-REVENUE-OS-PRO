import "server-only";

import type { AppRole } from "@gold-revenue-os/contracts";
import type { AdminCapability } from "@/lib/admin/permissions";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { getUserContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type AdminContext = {
  userId: string;
  email: string | null;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: AppRole;
};

export type CustomerListFilters = {
  search?: string;
  state?: string;
  segment?: string;
  risk?: string;
  source?: string;
  manager?: string;
  createdFrom?: string;
  createdTo?: string;
  page: number;
  pageSize: number;
};

export type CustomerListItem = {
  id: string;
  display_name: string | null;
  external_ref: string | null;
  state: string;
  segment: string | null;
  risk_level: string;
  source_type: string | null;
  source_name: string | null;
  assigned_manager_id: string | null;
  created_at: string;
  updated_at: string;
  next_best_action: string | null;
  primary_identity_type: string | null;
  primary_identity_value: string | null;
};

export type PagedResult<T> = { items: T[]; total: number; page: number; page_size: number };

export type DashboardMetrics = {
  total_customers: number;
  customers_by_state: Record<string, number>;
  recent_customers: Array<{ id: string; display_name: string | null; state: string; created_at: string }>;
  open_import_reviews: number;
  probable_identities: number;
  ambiguous_identities: number;
  recent_events: number;
  failed_events: number;
  scheduled_backlog: number;
  recent_audit: number;
};

export type AttentionItem = {
  category: string;
  severity: string;
  entity_id: string;
  customer_id: string | null;
  summary: string | null;
  created_at: string;
};

export type EventListItem = {
  id: string;
  customer_id: string | null;
  event_type: string;
  event_version: number;
  actor_type: string;
  producer: string;
  authority: string;
  correlation_id: string;
  causation_id: string | null;
  occurred_at: string;
  recorded_at: string;
  status: string | null;
  attempts: number | null;
  max_attempts: number | null;
  last_error_code: string | null;
  dead_lettered_at: string | null;
};

export type AuditItem = {
  id: number;
  actor_type: string;
  actor_id: string | null;
  role: AppRole | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  tenant_id: string;
  correlation_id: string | null;
  request_id: string | null;
  created_at: string;
  before_data: unknown;
  after_data: unknown;
};

export type SystemHealth = {
  environment: string;
  database: string;
  latest_migration: string;
  failed_events: number;
  dead_letter_count: number;
  pending_outbox_count: number;
  oldest_pending_outbox_at: string | null;
  scheduled_job_backlog: number;
  latest_successful_processing_at: string | null;
  checked_at: string;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ADMIN_READ_MODEL_INVALID");
  return value as Record<string, unknown>;
}

function paged<T>(value: unknown): PagedResult<T> {
  const data = record(value);
  return {
    items: Array.isArray(data.items) ? data.items as T[] : [],
    total: typeof data.total === "number" ? data.total : Number(data.total ?? 0),
    page: typeof data.page === "number" ? data.page : Number(data.page ?? 1),
    page_size: typeof data.page_size === "number" ? data.page_size : Number(data.page_size ?? 25),
  };
}

export async function requireAdminCapability(capability: AdminCapability): Promise<AdminContext> {
  const context = await getUserContext();
  if (!context) redirect("/login");
  if (context.tenants.length === 0) redirect("/access-pending");
  const tenant = context.tenants[0]!;
  if (!hasAdminCapability(tenant.role, capability)) redirect("/admin?access=forbidden");
  return {
    userId: context.user.id,
    email: context.user.email ?? null,
    tenantId: tenant.id,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    role: tenant.role,
  };
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name.toUpperCase()}_FAILED`);
  return data;
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const { tenantId } = await requireAdminCapability("dashboard.read");
  return record(await rpc("admin_dashboard_metrics", { target_tenant_id: tenantId })) as DashboardMetrics;
}

export async function getCustomerList(filters: CustomerListFilters): Promise<PagedResult<CustomerListItem>> {
  const { tenantId } = await requireAdminCapability("customers.list");
  return paged<CustomerListItem>(await rpc("admin_customer_list", {
    target_tenant_id: tenantId,
    search_value: filters.search || null,
    state_value: filters.state || null,
    segment_value: filters.segment || null,
    risk_value: filters.risk || null,
    source_value: filters.source || null,
    manager_value: filters.manager || null,
    created_from_value: filters.createdFrom || null,
    created_to_value: filters.createdTo || null,
    page_value: filters.page,
    page_size_value: filters.pageSize,
  }));
}

export async function getAttentionItems(): Promise<AttentionItem[]> {
  const { tenantId } = await requireAdminCapability("attention.read");
  const value = await rpc("admin_needs_attention", { target_tenant_id: tenantId });
  return Array.isArray(value) ? value as AttentionItem[] : [];
}

export async function getEventList(filters: Record<string, string | number | undefined>): Promise<PagedResult<EventListItem>> {
  const { tenantId } = await requireAdminCapability("events.read");
  return paged<EventListItem>(await rpc("admin_event_list", {
    target_tenant_id: tenantId,
    event_type_value: filters.type || null,
    status_value: filters.status || null,
    authority_value: filters.authority || null,
    customer_value: filters.customer || null,
    correlation_value: filters.correlation || null,
    date_from_value: filters.from || null,
    date_to_value: filters.to || null,
    page_value: filters.page || 1,
    page_size_value: filters.pageSize || 50,
  }));
}

export async function getAuditList(filters: Record<string, string | number | undefined>): Promise<PagedResult<AuditItem>> {
  const { tenantId } = await requireAdminCapability("audit.read");
  return paged<AuditItem>(await rpc("admin_audit_list", {
    target_tenant_id: tenantId,
    actor_value: filters.actor || null,
    role_value: filters.role || null,
    action_value: filters.action || null,
    entity_value: filters.entity || null,
    correlation_value: filters.correlation || null,
    date_from_value: filters.from || null,
    date_to_value: filters.to || null,
    page_value: filters.page || 1,
    page_size_value: filters.pageSize || 50,
  }));
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const { tenantId } = await requireAdminCapability("health.read");
  return record(await rpc("admin_system_health", { target_tenant_id: tenantId })) as SystemHealth;
}
