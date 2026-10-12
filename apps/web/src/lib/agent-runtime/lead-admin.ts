import "server-only";
import { leadIntelligenceSchema, type LeadIntelligence } from "@gold-revenue-os/domain";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getLeadIntelligence(conversationId: string): Promise<{ runId: string | null; status: string; failure: string | null; result: LeadIntelligence | null } | null> {
  const context=await requireAdminCapability("agents.read");
  const supabase=await createSupabaseServerClient();
  const {data,error}=await supabase.rpc("admin_lead_intelligence",{target_tenant_id:context.tenantId,target_conversation_id:conversationId});
  if(error) throw new Error("LEAD_ADMIN_READ_FAILED");
  if(!data) return null;
  const parsed=leadIntelligenceSchema.safeParse(data.result);
  return {runId:data.run_id as string|null,status:String(data.status),failure:data.failure_code as string|null,result:parsed.success?parsed.data:null};
}
