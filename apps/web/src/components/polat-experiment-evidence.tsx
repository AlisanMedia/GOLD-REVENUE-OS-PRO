"use client";
import Link from "next/link";
import { AdminDate, AdminDecimal, AdminNumber, useAdminI18n } from "./admin-i18n";
import { polatHref, type PolatSearch } from "../lib/polat/read-model";
import type { ExperimentPage } from "../lib/polat/experiment-read";

export function PolatExperimentFilters({search}:{search:PolatSearch}){
  const{t}=useAdminI18n();return <form method="get" className="filter-panel"><input type="hidden" name="view" value="experiments"/><label>{t("polat.pageSize")}<select name="size" defaultValue={search.size}>{["25","50","100"].map(size=><option key={size} value={size}>{size}</option>)}</select></label><button className="secondary-button" type="submit">{t("Apply filters")}</button><Link className="text-button" href={polatHref({...search,cursor:undefined})}>{t("polat.refresh")}</Link></form>;
}

export function PolatExperimentEvidence({ page, search, invalid }: { page: ExperimentPage | null; search: PolatSearch; invalid: boolean }) {
  const { t } = useAdminI18n();
  return <section aria-labelledby="polat-experiment-heading"><h2 id="polat-experiment-heading">{t("polat.experiment.title")}</h2>
    <p className="warning-box">{t("polat.experiment.disabled")}</p><p className="muted">{t("polat.experiment.basis")}</p>
    {!page ? <p role="status" className="warning-box">{t(invalid ? "polat.cursorError" : "polat.unavailable")}</p> : <>
      <p className="muted"><AdminDate value={page.observed_at}/> · {t("polat.experiment.refresh")}</p>
      {!page.items.length && <p className="empty-state">{t("polat.experiment.empty")}</p>}
      <div className="polat-work-list">{page.items.map(run => <article key={run.id} className="table-card polat-record">
        <div className="card-heading"><h3>{t(run.corpus_version === "polat-claude-canary-v1" ? "polat.experiment.canary" : "polat.experiment.full")}</h3><span className="state-pill">{t("polat.experiment.simulated")}</span></div>
        <p>{t(run.stop_reason?.includes("UNKNOWN") ? "polat.experiment.unknown" : run.stop_reason?.includes("QA") ? "polat.experiment.held" : run.stop_reason ? "polat.experiment.billing" : "polat.experiment.pending")}</p>
        <dl className="polat-facts"><div><dt>{t("polat.experiment.requests")}</dt><dd><AdminNumber value={run.request_count}/> / <AdminNumber value={run.maximum_requests}/></dd></div>
          <div><dt>{t("polat.experiment.evidence")}</dt><dd><AdminNumber value={run.evidence_count}/></dd></div>
          <div><dt>{t("polat.model.cost")}</dt><dd>{t("polat.model.unknown")}</dd></div>
          <div><dt>{t("polat.experiment.reserved")}</dt><dd>{page.billing_readable && run.reserved_liability !== null ? <><AdminDecimal value={run.reserved_liability}/> {run.currency}</> : t("polat.model.restricted")}</dd></div>
          <div><dt>{t("polat.received")}</dt><dd><AdminDate value={run.created_at}/></dd></div>
        </dl><p><strong>{t("polat.next")}: </strong>{t("polat.experiment.next")}</p>
        <details><summary>{t("polat.evidence")}</summary><dl className="polat-facts"><div><dt>{t("polat.model.versions")}</dt><dd><code>{run.model}</code></dd></div><div><dt>{t("polat.experiment.commit")}</dt><dd><code>{run.repository_sha}</code></dd></div></dl></details>
      </article>)}</div>
      <nav className="pagination" aria-label={t("polat.experiment.title")}><Link href={polatHref({ ...search, cursor: undefined })}>{t("polat.refresh")}</Link>{page.next_cursor ? <Link href={polatHref(search, page.next_cursor)}>{t("polat.more")}</Link> : <span>{t("polat.end")}</span>}</nav>
    </>}
  </section>;
}
