import { AdminCount } from "@/components/admin-i18n";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { successList } from "@/lib/customer-success/server";
import { getAdminI18n } from "@/lib/i18n/server";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { SuccessFilters,SuccessTaskCards } from "@/components/customer-success-views";
import { SuccessQueueHealth, SuccessRefresh } from "@/components/customer-success-controls";
import { z } from "zod";
export default async function CustomerSuccessPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const raw=await searchParams,query=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]));
 const {t}=await getAdminI18n(),page=Math.max(1,parseInt(query.page??"1",10)||1);
 const result=await successList({kind:query.kind,status:query.status,search:query.q,customer:z.uuid().safeParse(query.customer).success?query.customer:undefined,assignee:z.uuid().safeParse(query.assignee).success?query.assignee:undefined,page});
 const href=(p:number)=>{const q=new URLSearchParams(Object.entries(query).flatMap(([k,v])=>v?[[k,v]]:[]));q.set("page",String(p));return `/admin/customer-success?${q}`;};const pages=Math.max(1,Math.ceil(result.total/25));
 return <main className="admin-main"><div className="page-heading"><div><p className="eyebrow">GOLD REVENUE OS</p><h1>{t("Customer Success")}</h1><p className="lede">{t("Every customer, a clear next step. Review onboarding, support and renewal needs from verified records.")}</p></div>{hasAdminCapability(result.context.role,"success.manage")&&<SuccessRefresh request={randomUUID()} sandboxEnabled={result.sandbox_enabled}/>}</div><div className="data-boundary"><span className="environment-badge">{t("PREVIEW ONLY")}</span><p>{t("No campaigns, automatic charges or entitlement changes. Processing is limited to authorized synthetic staging customers.")}</p></div><SuccessQueueHealth health={result.queue_health} canManage={hasAdminCapability(result.context.role,"success.manage")&&result.sandbox_enabled}/><SuccessFilters query={query} managers={result.managers}/><p className="result-count"><AdminCount value={result.total} kind="tasks"/></p><SuccessTaskCards items={result.items} managers={result.managers}/><nav className="pagination" aria-label={t("Task pages")}><Link href={href(Math.max(1,page-1))} aria-disabled={page<=1}>{t("Previous")}</Link><span>{t("Page")} {page} / {pages}</span><Link href={href(Math.min(pages,page+1))} aria-disabled={page>=pages}>{t("Next")}</Link></nav></main>;
}
