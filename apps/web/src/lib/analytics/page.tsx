import {AnalyticsDashboard,AnalyticsUnavailable} from "@/components/analytics/dashboard";
import {analyticsFilters,analyticsSources,analyticsWorkspace} from "./server";
import {hasAdminCapability} from "@/lib/admin/permissions";
import {requireAdminCapability} from "@/lib/admin/server";
import type {AnalyticsSection} from "@gold-revenue-os/domain";
export async function analyticsPage(section:AnalyticsSection,raw:Record<string,string|string[]|undefined>){
 await requireAdminCapability("analytics.read");
 let filters;try{filters=analyticsFilters(raw);}catch{return <AnalyticsUnavailable invalid/>;}
 const {context,data}=await analyticsWorkspace(filters,typeof raw.cost_after==="string"?raw.cost_after:undefined);
 const kind=typeof raw.source==="string"?raw.source:undefined;
 const sources=kind&&typeof raw.fp==="string"?await analyticsSources(filters,kind,raw.fp,typeof raw.after==="string"?raw.after:undefined):null;
 return <AnalyticsDashboard data={data} section={section} canManage={hasAdminCapability(context.role,"analytics.manage")&&context.tenantSlug.startsWith("phase15-sandbox-")&&data.mode==="SANDBOX"} sources={sources} {...(kind?{sourceKind:kind}:{})} sourceRequested={Boolean(kind)}/>;
}
