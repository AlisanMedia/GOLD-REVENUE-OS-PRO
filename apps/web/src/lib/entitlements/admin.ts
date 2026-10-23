import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { jobHealthSchema } from "./job-health";
import { decodeEntitlementCursor, entitlementPageSchema, rowSchemas, subscriptionDetailSchema,
  type EntitlementCollection, type EntitlementPage, type EntitlementRows } from "./read-model";

// Request-local memoization only; no shared Next cache of privileged data.
const readContext = cache(async () => ({ context: await requireAdminCapability("entitlements.read"), db: await createSupabaseServerClient() }));
export type EntitlementReadFailure = "cursor" | "unavailable";
export async function requireEntitlementRead() { return (await readContext()).context; }

export async function entitlementPage<K extends EntitlementCollection>(collection: K, input: {
  customer?: string | undefined; subscription?: string | undefined; size?: number | undefined; cursor?: string | undefined;
} = {}) {
  const { context, db } = await readContext();
  let cursor = null;
  try { cursor = input.cursor ? decodeEntitlementCursor(input.cursor) : null; }
  catch { return { context, page: null, error: "cursor" as const }; }
  const { data, error } = await Promise.resolve(db.rpc("admin_entitlement_page_v1", {
    target_tenant_id: context.tenantId, collection_value: collection,
    target_customer_id: input.customer ? z.uuid().parse(input.customer) : null,
    target_subscription_id: input.subscription ? z.uuid().parse(input.subscription) : null,
    page_size_value: z.number().int().min(1).max(100).parse(input.size ?? 25), cursor_value: cursor,
  })).catch(() => ({ data: null, error: { code: "READ_UNAVAILABLE" } }));
  if (error) return { context, page: null, error: error.code === "22023" ? "cursor" as const : "unavailable" as const };
  const parsed = entitlementPageSchema(rowSchemas[collection]).safeParse(data);
  if (!parsed.success || parsed.data.collection !== collection) return { context, page: null, error: "unavailable" as const };
  return { context, page: parsed.data as EntitlementPage<EntitlementRows[K]>, error: null };
}

export async function subscriptionDetail(id: string) {
  const { context, db } = await readContext();
  if (!z.uuid().safeParse(id).success) return { context, detail: null, error: null };
  const { data, error } = await Promise.resolve(db.rpc("admin_subscription_detail_v1", { target_tenant_id: context.tenantId, target_subscription_id: id }))
    .catch(() => ({ data: null, error: { code: "READ_UNAVAILABLE" } }));
  if (error) return { context, detail: null, error: "unavailable" as const };
  if (data === null) return { context, detail: null, error: null };
  const parsed = subscriptionDetailSchema.safeParse(data);
  return parsed.success ? { context, detail: parsed.data, error: null } : { context, detail: null, error: "unavailable" as const };
}

// One bounded query for the already-loaded jobs, never a per-card RPC or shared cache.
export async function entitlementJobHealth(subscription: string, ids: string[]) {
  const { db, context } = await readContext();
  if (!z.uuid().safeParse(subscription).success || !z.array(z.uuid()).max(100).safeParse(ids).success || new Set(ids).size !== ids.length)
    return { data: null, error: "unavailable" as const };
  const { data, error } = await Promise.resolve(db.rpc("admin_entitlement_job_health_v1", { target_tenant_id: context.tenantId, target_subscription_id: subscription, job_ids_value: ids }))
    .catch(() => ({ data: null, error: { code: "READ_UNAVAILABLE" } }));
  if (error) return { data: null, error: "unavailable" as const };
  const result = jobHealthSchema.safeParse(data);
  if (!result.success || result.data.subscription_id !== subscription || result.data.items.length !== ids.length || new Set(result.data.items.map(r=>r.job_id)).size!==ids.length || result.data.items.some(r=>!ids.includes(r.job_id)))
    return { data: null, error: "unavailable" as const };
  if (context.role === "analyst" && result.data.items.some(r=>r.reason!=="RESTRICTED"||r.claims!==null||r.reclaims!==null||r.provider_failures!==null||r.effect_state!=="RESTRICTED"||r.lease_state!=="RESTRICTED"))
    return { data: null, error: "unavailable" as const };
  return { data: result.data, error: null };
}
