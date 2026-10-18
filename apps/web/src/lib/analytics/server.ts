import "server-only";
import { z } from "zod";
import { analyticsDefaultPeriod,analyticsFilterSchema,analyticsWorkspaceSchema,type AnalyticsFilter } from "@gold-revenue-os/domain";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export function analyticsFilters(raw:Record<string,string|string[]|undefined>):AnalyticsFilter{
 const defaults=analyticsDefaultPeriod();const parsed=analyticsFilterSchema.safeParse({mode:raw.mode??defaults.mode,start:raw.start??defaults.start,end:raw.end??defaults.end});
 if(!parsed.success)throw Error("ANALYTICS_FILTER_INVALID");return parsed.data;
}
export async function analyticsWorkspace(filters:AnalyticsFilter,after?:string){
 const context=await requireAdminCapability("analytics.read"),db=await createSupabaseServerClient();
 if(after&&!z.uuid().safeParse(after).success)throw Error("ANALYTICS_FILTER_INVALID");
 const {data,error}=await db.rpc("admin_analytics_workspace",{target_tenant_id:context.tenantId,start_value:filters.start,end_value:filters.end,mode_value:filters.mode,cost_after:after??null});
 if(error)throw Error("ANALYTICS_UNAVAILABLE");return {context,data:analyticsWorkspaceSchema.parse(data)};
}
export const analyticsSourcesSchema=z.object({rows:z.array(z.object({id:z.uuid(),at:z.string(),source:z.string(),state:z.string()})),more:z.boolean(),fingerprint:z.string()});
export type AnalyticsSources=z.infer<typeof analyticsSourcesSchema>;
export async function analyticsSources(filters:AnalyticsFilter,kind:string,fingerprint:string,after?:string):Promise<AnalyticsSources|null>{
 const context=await requireAdminCapability("analytics.read");if(!["invocations","invoices","subscriptions","cases","offers"].includes(kind)||!/^[a-f0-9]{64}$/.test(fingerprint)||after&&!z.uuid().safeParse(after).success)return null;
 const db=await createSupabaseServerClient();const {data,error}=await db.rpc("admin_analytics_sources",{target_tenant_id:context.tenantId,start_value:filters.start,end_value:filters.end,mode_value:filters.mode,kind_value:kind,fingerprint_value:fingerprint,after_value:after??null});
 if(error)return null;return analyticsSourcesSchema.parse(data);
}
