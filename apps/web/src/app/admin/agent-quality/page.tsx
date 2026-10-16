import { T, AdminEnum } from "../../../components/admin-i18n";
import Link from "next/link";
import { getAgentQualitySummary, getAgentVersions } from "@/lib/admin/server";

const scoreLabel = (key: string) => key.replaceAll("_", " ");

export default async function AgentQualityPage() {
  const [summary, versions] = await Promise.all([getAgentQualitySummary(), getAgentVersions()]);
  return <main className="admin-main">
    <div className="page-heading"><div>
      <p className="eyebrow"><T k="PHASE 7 · CONVERSATION QUALITY"/></p>
      <h1><T k="Agent quality evidence"/></h1>
      <p className="lede"><T k="Versioned drafts, QA evidence and human decisions. No synthetic intelligence score and no autonomous sending."/></p>
    </div><span className="environment-badge"><T k="SHADOW"/></span></div>
    <section className="metric-grid">
      <article className="metric-card"><span><T k="Approval rate"/></span><strong>{summary.approval_rate}%</strong></article>
      <article className="metric-card"><span><T k="Edit rate"/></span><strong>{summary.edit_rate}%</strong></article>
      <article className="metric-card"><span><T k="Rejection rate"/></span><strong>{summary.rejection_rate}%</strong></article>
      <article className="metric-card"><span><T k="Policy blocked"/></span><strong>{summary.blocked}</strong></article>
    </section>
    <section className="detail-grid">
      <article className="info-card"><h2><T k="Usage and reliability"/></h2><dl>
        <div><dt><T k="Total proposals"/></dt><dd>{summary.total_proposals}</dd></div>
        <div><dt><T k="Pending review"/></dt><dd>{summary.pending}</dd></div>
        <div><dt><T k="Average latency"/></dt><dd>{summary.average_latency_ms === null ? <T k="Not reported"/> : `${summary.average_latency_ms} ms`}</dd></div>
        <div><dt><T k="Input tokens"/></dt><dd>{summary.input_tokens || <T k="Not reported"/>}</dd></div>
        <div><dt><T k="Output tokens"/></dt><dd>{summary.output_tokens || <T k="Not reported"/>}</dd></div>
        <div><dt><T k="Failure rate"/></dt><dd>{summary.failure_rate}%</dd></div>
      </dl></article>
      <article className="info-card"><h2><T k="Average QA dimensions"/></h2><dl>
        {Object.entries(summary.average_qa ?? {}).map(([key, value]) => <div key={key}><dt>{scoreLabel(key)}</dt><dd>{value ?? <T k="No evidence"/>}</dd></div>)}
        {Object.keys(summary.average_qa ?? {}).length === 0 ? <div><dt><T k="Evidence"/></dt><dd><T k="No Phase 7 runs yet"/></dd></div> : null}
      </dl></article>
    </section>
    <section className="table-card table-scroll"><table><thead><tr><th><T k="Agent version"/></th><th><T k="Model"/></th><th><T k="Quality lineage"/></th><th><T k="Status"/></th></tr></thead><tbody>
      {versions.map((version) => <tr key={version.id}>
        <td><Link className="table-link" href={`/admin/agents/versions/${version.id}`}>{version.agent_name} <T k="· v"/>{version.version}</Link><small>{version.agent_type} · {<AdminEnum value={version.execution_mode}/>}</small></td>
        <td>{version.model_provider}/{version.model_name}</td>
        <td><small>{version.prompt_version}</small><small>{version.renderer_version ?? <T k="renderer unavailable"/>} · {version.qa_version ?? <T k="QA unavailable"/>}</small><small>{version.evaluation_set_version ?? <T k="evaluation set unavailable"/>}</small></td>
        <td><span className="state-pill">{version.superseded_at ? <T k="SUPERSEDED"/> : <T k="ACTIVE"/>}</span></td>
      </tr>)}{versions.length === 0 ? <tr><td colSpan={4} className="empty-state"><T k="No agent versions."/></td></tr> : null}
    </tbody></table></section>
  </main>;
}
