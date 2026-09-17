import Link from "next/link";
import { notFound } from "next/navigation";
import { ManualMessageReply } from "@/components/manual-message-reply";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { requireAdminCapability } from "@/lib/admin/server";
import { getConversationDetail, getConversationMessages } from "@/lib/messaging/server";

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireAdminCapability("messaging.read");
  const [conversation, messages] = await Promise.all([
    getConversationDetail(id),
    getConversationMessages(id),
  ]);
  if (!conversation) notFound();
  const contact = conversation.messaging_contacts;

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
    {hasAdminCapability(context.role, "messaging.send") ? <section className="form-panel"><h2>Manual reply</h2><p className="muted">The tenant kill switch and Telegram contactability are enforced again by the backend.</p><ManualMessageReply conversationId={conversation.id} /></section> : null}
  </main>;
}
