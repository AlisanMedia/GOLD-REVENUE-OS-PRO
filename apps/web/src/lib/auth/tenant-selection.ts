import type { TenantSummary } from "@gold-revenue-os/contracts";
import { z } from "zod";
export const ADMIN_TENANT_COOKIE = "gold_admin_workspace_v1";
const selection = z.strictObject({ user_id: z.uuid(), tenant_id: z.uuid() });
export function tenantSelectionValue(userId: string, tenantId: string) { return JSON.stringify(selection.parse({ user_id: userId, tenant_id: tenantId })); }
/** Preference only. Current authenticated membership, never the cookie, grants authority. */
export function selectAuthorizedTenant(tenants: TenantSummary[], userId: string, raw?: string) {
  if (!raw || raw.length > 240) return tenants;
  try {
    const value = selection.parse(JSON.parse(raw));
    if (value.user_id !== userId) return tenants;
    const chosen = tenants.find(t => t.id === value.tenant_id);
    return chosen ? [chosen, ...tenants.filter(t => t.id !== chosen.id)] : tenants;
  } catch { return tenants; }
}
