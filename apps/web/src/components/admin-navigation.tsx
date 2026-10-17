"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { useAdminI18n } from "./admin-i18n";
import { hasAdminCapability, type AdminCapability } from "../lib/admin/permissions";
import type { AppRole } from "@gold-revenue-os/contracts";
import type { CopyKey } from "../lib/i18n/core";
const groups: { label: CopyKey; items: { href: string; label: CopyKey; capability: AdminCapability; icon: string }[] }[] = [
 { label:"Overview",items:[{href:"/admin",label:"Overview",capability:"dashboard.read",icon:"◈"}] },
 { label:"Customer OS",items:[{href:"/admin/customers",label:"Customers",capability:"customers.list",icon:"◎"},{href:"/admin/conversations",label:"Conversations",capability:"messaging.read",icon:"◫"},{href:"/admin/customer-success",label:"Customer Success",capability:"success.read",icon:"↗"},{href:"/admin/attention",label:"Attention",capability:"attention.read",icon:"◇"}] },
 { label:"Feedback intelligence",items:[{href:"/admin/surveys",label:"Surveys",capability:"surveys.read",icon:"▤"},{href:"/admin/feedback",label:"Feedback intelligence",capability:"surveys.read",icon:"◉"},{href:"/admin/insights",label:"Improvement queue",capability:"surveys.read",icon:"↗"}] },
 { label:"Commerce",items:[{href:"/admin/catalog",label:"Products & Pricing",capability:"commercial.read",icon:"▧"},{href:"/admin/knowledge",label:"Knowledge Base",capability:"commercial.read",icon:"≡"},{href:"/admin/offers",label:"Offers",capability:"commercial.read",icon:"↗"}] },
 { label:"Payments & Subscriptions",items:[{href:"/admin/payments",label:"Payments",capability:"payments.read",icon:"▱"},{href:"/admin/subscriptions",label:"Subscriptions",capability:"entitlements.read",icon:"↻"},{href:"/admin/channel-access",label:"Channel Access",capability:"entitlements.read",icon:"▣"}] },
 { label:"AI Operations",items:[{href:"/admin/agents",label:"AI Operations",capability:"agents.read",icon:"✦"},{href:"/admin/agent-quality",label:"Quality evidence",capability:"agents.read",icon:"◉"}] },
 { label:"System & Settings",items:[{href:"/admin/system",label:"Control-plane health",capability:"health.read",icon:"⚙"},{href:"/admin/events",label:"Event timeline",capability:"events.read",icon:"≋"},{href:"/admin/audit",label:"Audit",capability:"audit.read",icon:"▤"},{href:"/admin/imports",label:"Import batches",capability:"imports.read",icon:"⇥"}] },
];
function NavigationPending() {
 const {pending}=useLinkStatus(),{t}=useAdminI18n();
 return pending?<span className="navigation-pending" role="status"><span aria-hidden="true">…</span><span className="sr-only">{t("Loading your workspace…")}</span></span>:null;
}
export function NavigationItems({ role, onNavigate }: { role: AppRole; onNavigate?: () => void }) {
 const {t,locale}=useAdminI18n(),pathname=usePathname(); const [search,setSearch]=useState("");
 const visible=groups.map(g=>({...g,items:g.items.filter(i=>hasAdminCapability(role,i.capability)&&t(i.label).toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)))})).filter(g=>g.items.length);
 return <><label className="nav-search"><span className="sr-only">{t("Search navigation")}</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={t("Search navigation")}/></label><nav aria-label={t("Yönetim menüsü")}>{visible.map(g=><section className="nav-group" key={g.label}><h2>{t(g.label)}</h2>{g.items.map(i=>{const active=i.href==="/admin"?pathname===i.href:pathname===i.href||pathname.startsWith(i.href+"/");return <Link key={i.href} href={i.href} className="nav-item" aria-current={active?"page":undefined} {...(onNavigate ? { onClick: onNavigate } : {})}><span aria-hidden="true">{i.icon}</span>{t(i.label)}<NavigationPending/></Link>;})}</section>)}{!visible.length&&<p className="muted">{t("No navigation matches.")}</p>}</nav></>;
}
export function MobileNavigation({role,tenantName}:{role:AppRole;tenantName:string}) {
 const {t}=useAdminI18n(),dialog=useRef<HTMLDialogElement>(null);
 return <><button type="button" className="mobile-menu secondary-button" aria-label={t("Open navigation")} onClick={()=>dialog.current?.showModal()}><span aria-hidden="true">☰</span></button><dialog ref={dialog} className="mobile-nav-dialog" aria-label={t("Yönetim menüsü")} onKeyDownCapture={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();dialog.current?.close();}}} onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close();}}><div className="mobile-nav-content"><div className="card-heading"><strong>Gold Revenue OS</strong><button className="secondary-button" type="button" onClick={()=>dialog.current?.close()} aria-label={t("Close navigation")}>×</button></div><p className="muted">{tenantName}</p><NavigationItems role={role} onNavigate={()=>dialog.current?.close()}/></div></dialog></>;
}
