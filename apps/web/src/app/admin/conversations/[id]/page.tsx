import Link from "next/link";
import { setAutomaticReplies } from "./actions";
import { notFound } from "next/navigation";
import { ManualMessageReply } from "@/components/manual-message-reply";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { requireAdminCapability } from "@/lib/admin/server";
import { getConversationDetail, getConversationMessages } from "@/lib/messaging/server";
import { getLeadIntelligence } from "@/lib/agent-runtime/lead-admin";
import {conversationCommercial} from "@/lib/commercial/admin";

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireAdminCapability("messaging.read");
  const [conversation, messages] = await Promise.all([
    getConversationDetail(id),
    getConversationMessages(id),
  ]);
  if (!conversation) notFound();
  const contact = conversation.messaging_contacts;
  const lead = hasAdminCapability(context.role,"agents.read") ? await getLeadIntelligence(id) : null;
  const commercial=hasAdminCapability(context.role,"commercial.read")?await conversationCommercial(id):null;

  return <main className="admin-main">
    <Link className="back-link" href="/admin/conversations">← Conversations</Link>
    <div className="page-heading"><div>
      <p className="eyebrow">TELEGRAM CONVERSATION</p>
      <h1>{contact?.username ? `@${contact.username}` : "Unmatched contact"}</h1>
      <p className="lede">Provider content remains in the controlled messaging store; event payloads contain references only.</p>
    </div></div>
    <div className="detail-grid">
      <section className="detail-card"><h2>Contactability</h2><dl>
        <div><dt>Status</dt><dd>{contact?.contactability ?? "unknown"}</dd></div>
        <div><dt>Identity resolution</dt><dd>{contact?.identity_resolution ?? "unmatched"}{contact?.review_required ? " · manual review required" : ""}</dd></div>
        <div><dt>Telegram user ID</dt><dd>{contact?.provider_user_id ?? "—"}</dd></div>
        <div><dt>Telegram chat ID</dt><dd>{contact?.provider_chat_id ?? "—"}</dd></div>
        <div><dt>Customer</dt><dd>{conversation.customer_id ? <Link className="table-link" href={`/admin/customers/${conversation.customer_id}`}>{conversation.customer_id}</Link> : "Not linked"}</dd></div>
      </dl></section>
      <section className="detail-card"><h2>Conversation state</h2><dl>
        <div><dt>Status</dt><dd>{conversation.status}</dd></div>
        <div><dt>Unread</dt><dd>{conversation.unread_count}</dd></div>
        <div><dt>Needs attention</dt><dd>{conversation.attention_required ? "Yes" : "No"}</dd></div>
        <div><dt>Last message</dt><dd>{conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleString("en-GB") : "—"}</dd></div>
      </dl></section>
    </div>
    <section className="detail-card full-width-card"><h2>Messages</h2>
      <ul>{messages.map((message) => <li key={message.id}>
        <strong>{message.direction} · {message.status}</strong>
        <span>{message.content}</span>
        <small>{new Date(message.occurred_at).toLocaleString("en-GB")}{message.failure_code ? ` · ${message.failure_code}` : ""}</small>
      </li>)}{messages.length === 0 ? <li className="empty-state">No messages.</li> : null}</ul>
    </section>
    {commercial?<section className="detail-card"><h2>Commercial recommendation</h2><p>{commercial.status}{commercial.failure?" · Attention: "+commercial.failure:""}</p><p>{commercial.result?.action} · {commercial.result?.reason}</p><p>Plan version: {commercial.result?.plan_version_id??"No eligible plan selected"} · {commercial.result?.offer_id?<Link href="/admin/offers">Offer proposal</Link>:"No offer prepared"}</p>{commercial.run_id&&<Link href={"/admin/agent-runs/"+commercial.run_id}>Source and task evidence</Link>}<p>Follow-up remains WAIT; no independent delivery.</p></section>:null}
    {lead ? <section className="table-card table-scroll">
      <h2>Lead qualification</h2>
      <p>{lead.status}{lead.failure ? ` · Attention required: ${lead.failure}` : ""} · {lead.runId ? <Link href={`/admin/agent-runs/${lead.runId}`}>Task / run evidence</Link> : "No completed run"}</p>
      {lead.result ? <>
        <p>{lead.result.identity === "unmatched" ? "Unmatched identity — conversation evidence only; no customer profile linked." : "Verified customer linkage"}</p>
        <p>Completeness: {Math.round(lead.result.completeness*100)}% · Missing / unconfirmed: {lead.result.missing_fields.join(", ") || "None"}</p>
        <p>Recommended next action: <strong>{lead.result.next_action.action}</strong> · {lead.result.next_action.reason}</p>
        <p>{lead.result.next_action.question ?? "No qualification question proposed."} · Delivery remains separately controlled.</p>
        <table><thead><tr><th>Field</th><th>Value</th><th>Evidence class</th><th>Source / time</th></tr></thead><tbody>
          {lead.result.fields.map(field=><tr key={field.key}><td>{field.key}</td><td>{field.value ?? "Unknown"}</td><td>{field.classification} · {Math.round(field.confidence*100)}%</td><td>{field.source ? <><small>{field.source.id} · {field.source.observed_at}</small><small>{field.source.quote}</small></> : "No evidence"}</td></tr>)}
        </tbody></table>
      </> : <p>No validated qualification result. Review the task status above.</p>}
    </section> : null}
    {hasAdminCapability(context.role, "messaging.send") && ["super_admin", "manager"].includes(context.role) ? <section className="form-panel">
      <h2>Automatic replies</h2><p>{conversation.automatic_replies_enabled && conversation.runtime_mode === "AI_ACTIVE" ? "Enabled — new messages receive replies after quality checks." : "Disabled — replies require operator review."}</p>
      <form action={setAutomaticReplies}>
        <input type="hidden" name="conversation_id" value={conversation.id} />
        <input type="hidden" name="enabled" value={conversation.automatic_replies_enabled && conversation.runtime_mode === "AI_ACTIVE" ? "false" : "true"} />
        <button type="submit">{conversation.automatic_replies_enabled && conversation.runtime_mode === "AI_ACTIVE" ? "Disable automatic replies / Human takeover" : "Enable automatic replies"}</button>
      </form><p className="muted">Applies only to this conversation and future messages. Blocked answers stay for review. The outbound switch still applies.</p>
    </section> : null}
    {hasAdminCapability(context.role, "messaging.send") ? <section className="form-panel"><h2>Manual reply</h2><p className="muted">The tenant kill switch and Telegram contactability are enforced again by the backend.</p><ManualMessageReply conversationId={conversation.id} /></section> : null}
  </main>;
}
