import { getAgentRunDetail } from "@/lib/admin/server";
import { notFound } from "next/navigation";
import { reviewProposal } from "./actions";

export default async function AgentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getAgentRunDetail(id);
  if (!detail) notFound();
  const run = detail.run;
  const proposal = detail.proposal;
  const originalResponse = proposal && typeof proposal.original_payload.proposed_response === "string"
    ? proposal.original_payload.proposed_response : "";
  return <main className="admin-main">
    <div className="page-heading"><div><p className="eyebrow">AGENT RUN</p><h1>Execution evidence</h1><p className="lede">Context is bounded; credentials and raw provider secrets are never retained here.</p></div></div>
    <section className="detail-grid"><article className="info-card"><span>Status</span><strong>{String(run.status ?? "unknown")}</strong><p>Mode: {String(run.execution_mode ?? "—")}</p><p>Attempt: {String(run.attempt_number ?? "—")}</p></article><article className="info-card"><span>Model</span><strong>{String(run.model_provider ?? "—")}/{String(run.model_name ?? "—")}</strong><p>Latency: {String(run.latency_ms ?? "—")} ms</p><p>Tokens: {String(run.total_tokens ?? "not reported")}</p></article></section>
    <section className="info-card"><h2>Bounded context manifest</h2><pre>{JSON.stringify(detail.context_manifest, null, 2)}</pre></section>
    <section className="info-card"><h2>Proposal</h2>{proposal ? <><span className="state-pill">{proposal.approval_status}</span><p>{originalResponse}</p><small>Confidence: {proposal.confidence ?? "not reported"}</small>{proposal.approval_status === "pending" ? <form action={reviewProposal} className="stacked-form"><input name="proposal_id" type="hidden" value={proposal.id}/><input name="run_id" type="hidden" value={id}/><label>Edited response<textarea name="edited_content" defaultValue={originalResponse}/></label><label>Review reason<input name="reason" /></label><div className="button-row"><button name="decision" value="approve" type="submit">Approve draft</button><button className="secondary-button" name="decision" value="edit" type="submit">Save edited</button><button className="text-button" name="decision" value="reject" type="submit">Reject</button></div><small>Approval records evidence only. It does not send a Telegram message.</small></form> : null}</> : <p>No proposal exists for this run.</p>}</section>
    <section className="info-card"><h2>Tool proposals</h2><pre>{JSON.stringify(detail.tool_calls, null, 2)}</pre></section>
    <section className="info-card"><h2>Attempts</h2><pre>{JSON.stringify(detail.attempts, null, 2)}</pre></section>
  </main>;
}
