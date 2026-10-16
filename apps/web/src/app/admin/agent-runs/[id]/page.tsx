import { T, AdminEnum } from "../../../../components/admin-i18n";
import { getAgentRunDetail } from "@/lib/admin/server";
import { notFound } from "next/navigation";
import { reviewProposal, sendApprovedProposal } from "./actions";

export default async function AgentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getAgentRunDetail(id);
  if (!detail) notFound();
  const run = detail.run;
  const proposal = detail.proposal;
  const originalResponse = proposal && typeof proposal.original_payload.proposed_response === "string"
    ? proposal.original_payload.proposed_response : "";
  return <main className="admin-main">
    <div className="page-heading"><div><p className="eyebrow"><T k="AGENT RUN"/></p><h1><T k="Execution evidence"/></h1><p className="lede"><T k="Context is bounded; credentials and raw provider secrets are never retained here."/></p></div></div>
    <section className="detail-grid"><article className="info-card"><span><T k="Status"/></span><strong>{String(run.status ?? "unknown")}</strong><p><T k="Mode:"/> {String(run.execution_mode ?? "—")}</p><p><T k="Attempt:"/> {String(run.attempt_number ?? "—")}</p></article><article className="info-card"><span><T k="Model"/></span><strong>{String(run.model_provider ?? "—")}/{String(run.model_name ?? "—")}</strong><p><T k="Latency:"/> {String(run.latency_ms ?? "—")} <T k="ms"/></p><p><T k="Tokens:"/> {String(run.total_tokens ?? "not reported")}</p></article></section>
    <section className="info-card"><h2><T k="Bounded context manifest"/></h2><p className="muted"><T k="This is the explicit record of what the agent knew, did not know and was permitted to retrieve."/></p><pre>{JSON.stringify(detail.context_manifest, null, 2)}</pre></section>
    <section className="info-card"><h2><T k="Conversation Director and QA"/></h2>{detail.quality_evaluation ? <pre>{JSON.stringify(detail.quality_evaluation, null, 2)}</pre> : <p><T k="No Phase 7 quality evidence for this legacy run."/></p>}</section>
    <section className="info-card"><h2><T k="Proposal"/></h2>{proposal ? <><span className="state-pill">{<AdminEnum value={proposal.approval_status}/>}</span>{proposal.customer_facing_blocked ? <p className="muted"><T k="Customer-facing approval blocked:"/> {proposal.block_reason ?? <T k="quality policy"/>}</p> : null}<p>{originalResponse}</p><small><T k="Confidence:"/> {proposal.confidence ?? <T k="not reported"/>}</small>{proposal.approval_status === "pending" ? <form action={reviewProposal} className="stacked-form"><input name="proposal_id" type="hidden" value={proposal.id}/><input name="run_id" type="hidden" value={id}/><label><T k="Edited response"/><textarea name="edited_content" defaultValue={originalResponse}/></label><label><T k="Review reason"/><input name="reason" /></label><div className="button-row">{proposal.customer_facing_blocked ? null : <><button name="decision" value="approve" type="submit"><T k="Approve draft"/></button><button className="secondary-button" name="decision" value="edit" type="submit"><T k="Save edited"/></button></>}<button className="text-button" name="decision" value="reject" type="submit"><T k="Reject"/></button></div><small><T k="Approval preserves human-decision evidence and never sends automatically."/></small></form> : null}{["approved","edited"].includes(proposal.approval_status) && !proposal.sent_message_id && !proposal.customer_facing_blocked ? <form action={sendApprovedProposal} className="stacked-form"><input name="proposal_id" type="hidden" value={proposal.id}/><input name="run_id" type="hidden" value={id}/><button type="submit"><T k="Send approved draft"/></button><small><T k="This separate human action re-checks contactability, kill switch, human takeover and idempotency before Telegram."/></small></form> : null}{proposal.sent_message_id ? <small><T k="Queued/sent message:"/> {proposal.sent_message_id}</small> : null}</> : <p><T k="No proposal exists for this run."/></p>}</section>
    <section className="info-card"><h2><T k="Human decision evidence"/></h2><pre>{JSON.stringify(detail.review_evidence, null, 2)}</pre></section>
    <section className="info-card"><h2><T k="Model invocations"/></h2><pre>{JSON.stringify(detail.model_invocations, null, 2)}</pre></section>
    <section className="info-card"><h2><T k="Tool proposals"/></h2><pre>{JSON.stringify(detail.tool_calls, null, 2)}</pre></section>
    <section className="info-card"><h2><T k="Attempts"/></h2><pre>{JSON.stringify(detail.attempts, null, 2)}</pre></section>
  </main>;
}
