"use client";
import { currentIdentityTag } from "@gold-revenue-os/contracts";
import Link from "next/link";
import { AdminDate, AdminDecimal, AdminNumber, useAdminI18n } from "./admin-i18n";
import { jeffHref, type JeffSearch } from "../lib/jeff/read-model";
import type { ExperimentPage } from "../lib/jeff/experiment-read";

export function JeffExperimentFilters({search}:{search:JeffSearch}){
  const{t}=useAdminI18n();return <form method="get" className="filter-panel"><input type="hidden" name="view" value="experiments"/><label>{t("jeff.pageSize")}<select name="size" defaultValue={search.size}>{["25","50","100"].map(size=><option key={size} value={size}>{size}</option>)}</select></label><button className="secondary-button" type="submit">{t("Apply filters")}</button><Link className="text-button" href={jeffHref({...search,cursor:undefined})}>{t("jeff.refresh")}</Link></form>;
}

export function JeffExperimentEvidence({ page, search, invalid }: { page: ExperimentPage | null; search: JeffSearch; invalid: boolean }) {
  const { t } = useAdminI18n();
  return <section aria-labelledby="jeff-experiment-heading"><h2 id="jeff-experiment-heading">{t("jeff.experiment.title")}</h2>
    <p className="warning-box">{t("jeff.experiment.disabled")}</p><p className="muted">{t("jeff.experiment.basis")}</p>
    {!page ? <p role="status" className="warning-box">{t(invalid ? "jeff.cursorError" : "jeff.unavailable")}</p> : <>
      <p className="muted"><AdminDate value={page.observed_at}/> · {t("jeff.experiment.refresh")}</p>
      {!page.items.length && <p className="empty-state">{t("jeff.experiment.empty")}</p>}
      <div className="jeff-work-list">{page.items.map(run => <article key={run.id} className="table-card jeff-record">
        <div className="card-heading"><h3>{t(currentIdentityTag(run.corpus_version) === "jeff-claude-canary-v1" ? "jeff.experiment.canary" : "jeff.experiment.full")}</h3><span className="state-pill">{t("jeff.experiment.simulated")}</span></div>
        <p>{t(run.stop_reason?.includes("UNKNOWN") ? "jeff.experiment.unknown" : run.stop_reason?.includes("QA") ? "jeff.experiment.held" : run.stop_reason ? "jeff.experiment.billing" : "jeff.experiment.pending")}</p>
        <dl className="jeff-facts"><div><dt>{t("jeff.experiment.requests")}</dt><dd><AdminNumber value={run.request_count}/> / <AdminNumber value={run.maximum_requests}/></dd></div>
          <div><dt>{t("jeff.experiment.evidence")}</dt><dd><AdminNumber value={run.evidence_count}/></dd></div>
          <div><dt>{t("jeff.model.cost")}</dt><dd>{t("jeff.model.unknown")}</dd></div>
          <div><dt>{t("jeff.experiment.reserved")}</dt><dd>{page.billing_readable && run.reserved_liability !== null ? <><AdminDecimal value={run.reserved_liability}/> {run.currency}</> : t("jeff.model.restricted")}</dd></div>
          <div><dt>{t("jeff.received")}</dt><dd><AdminDate value={run.created_at}/></dd></div>
        </dl><p><strong>{t("jeff.next")}: </strong>{t("jeff.experiment.next")}</p>
        <details><summary>{t("jeff.evidence")}</summary><dl className="jeff-facts"><div><dt>{t("jeff.model.versions")}</dt><dd><code>{currentIdentityTag(run.model)}</code></dd></div><div><dt>{t("jeff.experiment.commit")}</dt><dd><code>{run.repository_sha}</code></dd></div></dl></details>
      </article>)}</div>
      <nav className="pagination" aria-label={t("jeff.experiment.title")}><Link href={jeffHref({ ...search, cursor: undefined })}>{t("jeff.refresh")}</Link>{page.next_cursor ? <Link href={jeffHref(search, page.next_cursor)}>{t("jeff.more")}</Link> : <span>{t("jeff.end")}</span>}</nav>
    </>}
  </section>;
}
