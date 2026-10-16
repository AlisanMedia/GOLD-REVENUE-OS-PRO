"use client";
import Link from "next/link";
import type { CustomerListItem } from "../lib/admin/server";
import { useAdminI18n } from "./admin-i18n";
import { enumLabel } from "../lib/i18n/labels";
import { formatDate } from "../lib/i18n/core";
export function CustomerRecordCards({items}:{items:CustomerListItem[]}) {const {locale,t}=useAdminI18n();return <div className="customer-mobile-cards">{items.map(c=><article className="success-task-card" key={c.id}><div className="case-card-heading"><span className="state-pill">{enumLabel(c.state,locale)}</span><small className="muted">{enumLabel(c.risk_level,locale)}</small></div><h2><Link href={`/admin/customers/${c.id}`}>{c.display_name??t("Unnamed customer")}</Link></h2><p className="muted">{c.primary_identity_value??t("Restricted / unavailable")}</p><dl className="case-card-facts"><div><dt>{t("Next best action")}</dt><dd>{c.next_best_action??"—"}</dd></div><div><dt>{t("Updated")}</dt><dd>{formatDate(locale,c.updated_at)}</dd></div></dl><Link className="secondary-button" href={`/admin/customers/${c.id}`}>{t("Open Customer 360")} →</Link></article>)}{!items.length&&<p className="muted">{t("No customer records match these filters.")}</p>}</div>;}
