import Link from "next/link";
import { ConversationAutomationControl } from "@/components/conversation-automation-control";
import { messageDeliveryLabel } from "@/lib/escalations/manual-reply";
import { caseStage, categoryLabel, conversationAutomationLabel, managerLabel, notificationLabel, operatorDate, severityLabel } from "@/lib/escalations/presentation";
import { notFound } from "next/navigation";
import { ManualMessageReply } from "@/components/manual-message-reply";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { requireAdminCapability } from "@/lib/admin/server";
import { getConversationDetail, getConversationMessages } from "@/lib/messaging/server";
import { getLeadIntelligence } from "@/lib/agent-runtime/lead-admin";
import { escalationList } from "@/lib/escalations/admin";
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
  const escalations = await escalationList(undefined, id);
  const activeCase = escalations.cases.find(c => c.status !== "RESOLVED");
  const canReply = hasAdminCapability(context.role, "messaging.send") && (!activeCase || hasAdminCapability(context.role, "escalations.manage") && activeCase.status === "IN_PROGRESS" && activeCase.assigned_to === context.userId);
  const lead = hasAdminCapability(context.role,"agents.read") ? await getLeadIntelligence(id) : null;
  const commercial=hasAdminCapability(context.role,"commercial.read")?await conversationCommercial(id):null;

  return <main className="admin-main case-workspace" lang="tr">
    <Link className="back-link" href="/admin/conversations">← Görüşmeler</Link>
    <div className="page-heading"><div>
      <p className="eyebrow">TELEGRAM GÖRÜŞMESİ</p>
      <h1>{contact?.username ? `@${contact.username}` : "Müşteri eşleştirmesi bekleniyor"}</h1>
      <p className="lede">Müşteri mesajlarını ve güncel görüşme durumunu buradan inceleyin.</p>
    </div></div>
    <div className="detail-grid">
      <section className="detail-card"><h2>Müşteri bağlantısı</h2><dl>
        <div><dt>İletişim izni</dt><dd>{contact?.contactability === "user_initiated" ? "Müşteri görüşmeyi başlattı" : contact?.contactability === "allowed" ? "İletişim izni var" : contact?.contactability === "blocked" ? "İletişim engellendi" : "İzin doğrulanmadı"}</dd></div>
        <div><dt>Kimlik eşleştirmesi</dt><dd>{contact?.identity_resolution === "matched" ? "Müşteriyle eşleştirildi" : contact?.identity_resolution === "unmatched" ? "Eşleştirme bekleniyor" : "İnceleme gerekiyor"}{contact?.review_required ? " · insan incelemesi gerekiyor" : ""}</dd></div>
        <div><dt>Müşteri</dt><dd>{conversation.customer_id ? <Link className="table-link" href={`/admin/customers/${conversation.customer_id}`}>Müşteri Kaydını Aç</Link> : "Henüz eşleştirilmedi"}</dd></div>
      </dl><details className="case-technical"><summary>Teknik kimlikler</summary><dl><div><dt>Telegram kullanıcı kimliği</dt><dd>{contact?.provider_user_id ?? "—"}</dd></div><div><dt>Telegram sohbet kimliği</dt><dd>{contact?.provider_chat_id ?? "—"}</dd></div></dl></details></section>
      <section className="detail-card"><h2>Görüşme durumu</h2><dl>
        <div><dt>Durum</dt><dd>{conversation.status === "open" ? "Açık" : conversation.status === "closed" ? "Kapalı" : conversation.status === "archived" ? "Arşivde" : "Durum bilinmiyor"}</dd></div>
        <div><dt>Okunmamış</dt><dd>{conversation.unread_count}</dd></div>
        <div><dt>İnceleme gerekiyor</dt><dd>{conversation.attention_required ? "Evet" : "Hayır"}</dd></div>
        <div><dt>Son mesaj</dt><dd>{conversation.last_message_at ? operatorDate(conversation.last_message_at) : "—"}</dd></div>
      </dl></section>
    </div>
    <section className="case-panel"><h2>Yönetici incelemesi</h2><p>{conversationAutomationLabel(conversation)}</p>{escalations.cases.map(c => <p key={c.id}><Link className="table-link" href={`/admin/attention/${c.id}`}>{severityLabel(c.severity)} · {categoryLabel(c.category)} · {caseStage(c)}</Link><br/>{managerLabel(c.assigned_to, context.userId)} · {notificationLabel(c.notification?.status)}</p>)}{!escalations.cases.length && <p>Bu görüşmede yönetici incelemesi gereken vaka yok.</p>}</section>
    {hasAdminCapability(context.role, "messaging.send") && ["super_admin", "manager"].includes(context.role) ? <section className="form-panel">
      <h2>Yapay zekâ kontrolü</h2><p>{conversationAutomationLabel(conversation)}</p>
      {activeCase ? <p className="warning-box">Açık vaka için işlemleri <Link href={`/admin/attention/${activeCase.id}`}>vaka ekranından</Link> yürütün. İnceleme tamamlanmadan otomatik yanıtları açmayın.</p> : <ConversationAutomationControl conversationId={conversation.id} active={conversation.automatic_replies_enabled && conversation.runtime_mode === "AI_ACTIVE"}/>}
      <p className="muted">Yalnızca bu görüşme ve yeni mesajlar için geçerlidir. Marka gönderim kısıtları ve yanıt kalite kontrolleri korunur.</p>
    </section> : null}
    {canReply ? <section className="form-panel" id="customer-reply"><h2>Müşteriye Yanıt Ver</h2><p className="muted">Gönderim izni, vaka sahipliği ve müşteriyle iletişim izni backend tarafından yeniden doğrulanır.</p><ManualMessageReply conversationId={conversation.id} /></section> : null}
    <section className="detail-card full-width-card"><h2>Müşteri mesajları</h2>
      <ul>{messages.map((message) => <li key={message.id}>
        <strong>{message.direction === "inbound" ? "Müşteri" : "Temsilci"} · {messageDeliveryLabel(message.status)}</strong>
        <span>{message.content}</span>
        <small>{operatorDate(message.occurred_at)}{message.failure_code ? ` · ${message.failure_code}` : ""}</small>
      </li>)}{messages.length === 0 ? <li className="empty-state">Henüz mesaj yok.</li> : null}</ul>
    </section>
    <details className="case-panel case-technical"><summary>Satış önerisi ve müşteri analizi · Teknik ayrıntılar</summary>
    {commercial?<section className="detail-card"><h2>Commercial recommendation</h2><p>{commercial.status}{commercial.failure?" · Attention: "+commercial.failure:""}</p><p>{commercial.result?.action} · {commercial.result?.reason}</p><p>Plan version: {commercial.result?.plan_version_id??"No eligible plan selected"} · {commercial.result?.offer_id?<Link href="/admin/offers">Offer proposal</Link>:"No offer prepared"}</p>{commercial.run_id&&<Link href={"/admin/agent-runs/"+commercial.run_id}>Source and task evidence</Link>}<p>Follow-up: {commercial.result?.follow_up?.action??"WAIT"} · {commercial.result?.follow_up?.reason??"No follow-up proposed"}. No independent delivery.</p></section>:null}
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

    </details>
  </main>;
}
