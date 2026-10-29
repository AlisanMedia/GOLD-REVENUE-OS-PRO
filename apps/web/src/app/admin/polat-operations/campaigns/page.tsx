import { randomUUID } from "node:crypto";
import { z } from "zod";
import { campaignOptionsSchema, campaignWorkspaceSchema } from "@gold-revenue-os/contracts";
import { CampaignCenter } from "@/components/campaign-controls";
import { requireCustomerTenant } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function CampaignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireCustomerTenant(["super_admin", "manager"]), raw = await searchParams;
  const cursor = z.uuid().optional().safeParse(raw.after);
  const db = await createSupabaseServerClient();
  const [result, choices] = await Promise.all([
    cursor.success ? db.rpc("admin_campaign_workspace_v1", { target_tenant_id: context.tenantId, after_value: cursor.data ?? null }) : null,
    db.rpc("admin_campaign_options_v1", { target_tenant_id: context.tenantId }),
  ]);
  const parsed = result && !result.error ? campaignWorkspaceSchema.safeParse(result.data) : null;
  const starts = new Date(), expires = new Date(+starts + 30 * 86400000);
  const options = choices.error ? null : campaignOptionsSchema.safeParse(choices.data);
  return <CampaignCenter workspace={parsed?.success ? parsed.data : null} options={options?.success ? options.data : null} owner={context.role === "super_admin"} commandId={randomUUID()} starts={starts.toISOString()} expires={expires.toISOString()}/>;
}
