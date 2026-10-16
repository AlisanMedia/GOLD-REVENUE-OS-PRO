import "server-only";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dashboardSchema,successDetailSchema,successListSchema } from "./types";
export async function successList(filters:{kind?:string|undefined;status?:string|undefined;customer?:string|undefined;search?:string|undefined;assignee?:string|undefined;page?:number|undefined}={}) {
 const context=await requireAdminCapability("success.read"),db=await createSupabaseServerClient();
 const {data,error}=await db.rpc("admin_success_list",{target_tenant_id:context.tenantId,kind_value:filters.kind||null,status_value:filters.status||null,customer_value:filters.customer||null,search_value:filters.search||null,assignee_value:filters.assignee||null,page_value:filters.page??1});if(error)throw Error("SUCCESS_READ_FAILED");return {context,...successListSchema.parse(data)};
}
export async function successDetail(id:string) {const context=await requireAdminCapability("success.read"),db=await createSupabaseServerClient();const {data,error}=await db.rpc("admin_success_detail",{target_tenant_id:context.tenantId,task_value:id});if(error)throw Error("SUCCESS_READ_FAILED");return {context,data:data?successDetailSchema.parse(data):null};}
export async function operationalDashboard(days:number) {const context=await requireAdminCapability("dashboard.read"),db=await createSupabaseServerClient();const {data,error}=await db.rpc("admin_operational_dashboard",{target_tenant_id:context.tenantId,days_value:days});if(error)throw Error("DASHBOARD_UNAVAILABLE");return {context,data:dashboardSchema.parse(data)};}
