import type { AppRole, TenantSummary } from "@gold-revenue-os/contracts";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type MembershipRow = { tenant_id: string; role: AppRole; status: string };
type TenantRow = { id: string; name: string; slug: string };

export async function getUserContext() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const { data: membershipData, error: membershipError } = await supabase
    .from("tenant_members").select("tenant_id, role, status").eq("user_id", user.id).eq("status", "active");
  if (membershipError) throw new Error("Unable to load memberships");
  const memberships = (membershipData ?? []) as MembershipRow[];
  const tenantIds = memberships.map(({ tenant_id }) => tenant_id);
  if (tenantIds.length === 0) return { user, tenants: [] as TenantSummary[] };

  const { data: tenantData, error: tenantError } = await supabase
    .from("tenants").select("id, name, slug").in("id", tenantIds).eq("status", "active");
  if (tenantError) throw new Error("Unable to load tenants");
  const roleByTenant = new Map(memberships.map(({ tenant_id, role }) => [tenant_id, role]));
  const tenants = ((tenantData ?? []) as TenantRow[]).flatMap((tenant) => {
    const role = roleByTenant.get(tenant.id);
    return role ? [{ ...tenant, role }] : [];
  });
  return { user, tenants };
}

export async function requireUserContext() {
  const context = await getUserContext();
  if (!context) redirect("/login");
  if (context.tenants.length === 0) redirect("/access-pending");
  return context;
}
