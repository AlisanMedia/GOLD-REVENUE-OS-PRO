import "server-only";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { surveyWorkspaceSchema } from "./types";
export async function surveyWorkspace(version?:string,month?:string,customer?:string){const context=await requireAdminCapability("surveys.read"),db=await createSupabaseServerClient();const response=await db.rpc("admin_survey_workspace",{target_tenant_id:context.tenantId,version_value:version??null,month_value:month??null,customer_value:customer??null});const data:unknown=response.data;const error=response.error;if(error)throw Error("SURVEY_WORKSPACE_UNAVAILABLE");return {context,data:surveyWorkspaceSchema.parse(data)};}
