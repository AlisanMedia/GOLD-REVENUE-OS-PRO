import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { escalationList } from "@/lib/escalations/admin";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { ManualMessageReply } from "@/components/manual-message-reply";
import { controlEscalation } from "../actions";

export default async function EscalationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!z.uuid().safeParse(id).success) notFound();
  const data = await escalationList(id); const c = data.cases[0]; if (!c) notFound();
  const manage = hasAdminCapability(data.context.role, "escalations.manage");
  return <main className="admin-main"><Link href="/admin/attention">← Needs attention</Link>
    <p className="eyebrow">HUMAN ESCALATION</p><h1>{c.severity} · {c.category.replaceAll("_", " ")}</h1>
    <section className="detail-card"><h2>Case status</h2><p>{c.id} · {c.status} · revision {c.revision}</p>
      <p>Waiting for acknowledgment: {c.waiting_seconds}s · Owner: {c.assigned_to ?? "Unassigned"}</p>
      <p>Acknowledged: {c.acknowledged_at ?? "Not yet"} · First delivered human response: {c.first_response_at ?? "Not yet"}</p>
      <p><Link href={`/admin/conversations/${c.conversation_id}`}>Conversation and source messages</Link></p>
      <p>Notification: {c.notification?.status ?? "Not required"} · attempts {c.notification?.attempts ?? 0}</p>
      <p>{c.notification?.last_error} {c.notification?.status === "SENT" ? `Provider message ${c.notification.provider_message_id} · ${c.notification.sent_at}` : "No successful manager notification recorded."}</p>
      {c.resolution_note && <p>Resolution: {c.resolution_note}</p>}<p>Returned to AI: {c.returned_to_ai_at ?? "No"}</p>
    </section>
    {manage && <section className="form-panel"><h2>Manager controls</h2><form action={controlEscalation}>
      <input type="hidden" name="case_id" value={c.id}/><input type="hidden" name="revision" value={c.revision}/>
      <label>Action <select name="action">{(c.status === "RESOLVED" ? ["return"] : ["acknowledge", "assign", "takeover", "resolve"]).map(action => <option key={action}>{action}</option>)}</select></label>
      <label>Manager <select name="assignee"><option value="">Choose for assignment</option>{data.managers.map(m => <option key={m.id} value={m.id}>{m.id} · {m.role}</option>)}</select></label>
      <label>Resolution note <textarea name="note" maxLength={1000}/></label><button>Apply control</button>
    </form><p>Resolution requires a note. Return applies only to new inbound messages; historical drafts are never resent.</p></section>}
    {manage && c.status === "IN_PROGRESS" && c.assigned_to === data.context.userId && <section className="form-panel"><h2>Manual reply</h2><ManualMessageReply conversationId={c.conversation_id}/></section>}
    <section className="detail-card"><h2>Source evidence</h2><ul>{data.evidence.map(e => <li key={e.id}>{e.category} · {e.source_kind} · message {e.message_id} · source {e.source_id} · {e.created_at}</li>)}</ul></section>
    <section className="detail-card"><h2>Audit history</h2><ul>{data.history.map(h => <li key={h.id}>{h.created_at} · {h.action} · {h.actor_id ?? "System"}</li>)}</ul></section>
  </main>;
}
