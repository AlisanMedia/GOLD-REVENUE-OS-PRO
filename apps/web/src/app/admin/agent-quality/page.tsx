import Link from "next/link";
import { getAgentQualitySummary, getAgentVersions } from "@/lib/admin/server";

const scoreLabel = (key: string) => key.replaceAll("_", " ");

export default async function AgentQualityPage() {
  const [summary, versions] = await Promise.all([getAgentQualitySummary(), getAgentVersions()]);
  return <main className="admin-main">
    <div className="page-heading"><div>
      <p className="eyebrow">PHASE 7 · CONVERSATION QUALITY</p>
      <h1>Agent quality evidence</h1>
      <p className="lede">Versioned drafts, QA evidence and human decisions. No synthetic intelligence score and no autonomous sending.</p>
    </div><span className="environment-badge">SHADOW</span></div>
    <section className="metric-grid">
      <article className="metric-card"><span>Approval rate</span><strong>{summary.approval_rate}%</strong></article>
      <article className="metric-card"><span>Edit rate</span><strong>{summary.edit_rate}%</strong></article>
      <article className="metric-card"><span>Rejection rate</span><strong>{summary.rejection_rate}%</strong></article>
      <article className="metric-card"><span>Policy blocked</span><strong>{summary.blocked}</strong></article>
    </section>
    <section className="detail-grid">
      <article className="info-card"><h2>Usage and reliability</h2><dl>
        <div><dt>Total proposals</dt><dd>{summary.total_proposals}</dd></div>
        <div><dt>Pending review</dt><dd>{summary.pending}</dd></div>
        <div><dt>Average latency</dt><dd>{summary.average_latency_ms === null ? "Not reported" : `${summary.average_latency_ms} ms`}</dd></div>
        <div><dt>Input tokens</dt><dd>{summary.input_tokens || "Not reported"}</dd></div>
        <div><dt>Output tokens</dt><dd>{summary.output_tokens || "Not reported"}</dd></div>
        <div><dt>Failure rate</dt><dd>{summary.failure_rate}%</dd></div>
      </dl></article>
      <article className="info-card"><h2>Average QA dimensions</h2><dl>
        {Object.entries(summary.average_qa ?? {}).map(([key, value]) => <div key={key}><dt>{scoreLabel(key)}</dt><dd>{value ?? "No evidence"}</dd></div>)}
        {Object.keys(summary.average_qa ?? {}).length === 0 ? <div><dt>Evidence</dt><dd>No Phase 7 runs yet</dd></div> : null}
      </dl></article>
    </section>
    <section className="table-card table-scroll"><table><thead><tr><th>Agent version</th><th>Model</th><th>Quality lineage</th><th>Status</th></tr></thead><tbody>
      {versions.map((version) => <tr key={version.id}>
        <td><Link className="table-link" href={`/admin/agents/versions/${version.id}`}>{version.agent_name} · v{version.version}</Link><small>{version.agent_type} · {version.execution_mode}</small></td>
        <td>{version.model_provider}/{version.model_name}</td>
        <td><small>{version.prompt_version}</small><small>{version.renderer_version ?? "renderer unavailable"} · {version.qa_version ?? "QA unavailable"}</small><small>{version.evaluation_set_version ?? "evaluation set unavailable"}</small></td>
        <td><span className="state-pill">{version.superseded_at ? "SUPERSEDED" : "ACTIVE"}</span></td>
      </tr>)}{versions.length === 0 ? <tr><td colSpan={4} className="empty-state">No agent versions.</td></tr> : null}
    </tbody></table></section>
  </main>;
}
