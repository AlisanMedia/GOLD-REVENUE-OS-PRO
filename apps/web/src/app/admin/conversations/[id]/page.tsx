import { T, OperatorText, AdminDate, AdminEnum, AdminNumber } from "../../../../components/admin-i18n";
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

  return <main className="admin-main case-workspace">
    <Link className="back-link" href="/admin/conversations"><T k="← Görüşmeler"/></Link>
    <div className="page-heading"><div>
      <p className="eyebrow"><T k="TELEGRAM GÖRÜŞMESİ"/></p>
      <h1>{contact?.username ? `@${contact.username}` : <T k="Müşteri eşleştirmesi bekleniyor"/>}</h1>
      <p className="lede"><T k="Müşteri mesajlarını ve güncel görüşme durumunu buradan inceleyin."/></p>
    </div></div>
    {hasAdminCapability(context.role,"agents.read")&&<Link className="secondary-button" href={`/admin/polat-operations?conversation=${conversation.id}`}><T k="Polat AI Operations"/></Link>}
    <div className="detail-grid">
      <section className="detail-card"><h2><T k="Müşteri bağlantısı"/></h2><dl>
        <div><dt><T k="İletişim izni"/></dt><dd>{contact?.contactability === "user_initiated" ? <T k="Müşteri görüşmeyi başlattı"/> : contact?.contactability === "allowed" ? <T k="İletişim izni var"/> : contact?.contactability === "blocked" ? <T k="İletişim engellendi"/> : <T k="İzin doğrulanmadı"/>}</dd></div>
        <div><dt><T k="Kimlik eşleştirmesi"/></dt><dd>{["exact_match", "manual"].includes(contact?.identity_resolution ?? "") ? <T k="Müşteriyle eşleştirildi"/> : contact?.identity_resolution === "unmatched" ? <T k="Eşleştirme bekleniyor"/> : <T k="İnceleme gerekiyor"/>}{contact?.review_required ? <T k=" · insan incelemesi gerekiyor"/> : ""}</dd></div>
        <div><dt><T k="Müşteri"/></dt><dd>{conversation.customer_id ? <Link className="table-link" href={`/admin/customers/${conversation.customer_id}`}><T k="Müşteri Kaydını Aç"/></Link> : <T k="Henüz eşleştirilmedi"/>}</dd></div>
      </dl><details className="case-technical"><summary><T k="Teknik kimlikler"/></summary><dl><div><dt><T k="Telegram kullanıcı kimliği"/></dt><dd>{contact?.provider_user_id ?? "—"}</dd></div><div><dt><T k="Telegram sohbet kimliği"/></dt><dd>{contact?.provider_chat_id ?? "—"}</dd></div></dl></details></section>
      <section className="detail-card"><h2><T k="Görüşme durumu"/></h2><dl>
        <div><dt><T k="Durum"/></dt><dd>{conversation.status === "open" ? <T k="Açık"/> : conversation.status === "closed" ? <T k="Kapalı"/> : conversation.status === "archived" ? <T k="Arşivde"/> : <T k="Durum bilinmiyor"/>}</dd></div>
        <div><dt><T k="Okunmamış"/></dt><dd>{<AdminNumber value={conversation.unread_count}/>}</dd></div>
        <div><dt><T k="İnceleme gerekiyor"/></dt><dd>{conversation.attention_required ? <T k="Evet"/> : <T k="Hayır"/>}</dd></div>
        <div><dt><T k="Son mesaj"/></dt><dd>{conversation.last_message_at ? operatorDate(conversation.last_message_at) : "—"}</dd></div>
      </dl></section>
    </div>
    <section className="case-panel"><h2><T k="Yönetici incelemesi"/></h2><p>{<OperatorText value={conversationAutomationLabel(conversation)}/>}</p>{escalations.cases.map(c => <p key={c.id}><Link className="table-link" href={`/admin/attention/${c.id}`}>{<OperatorText value={severityLabel(c.severity)}/>} · {<OperatorText value={categoryLabel(c.category)}/>} · {<OperatorText value={caseStage(c)}/>}</Link><br/>{<OperatorText value={managerLabel(c.assigned_to, context.userId)}/>} · {<OperatorText value={notificationLabel(c.notification?.status)}/>}</p>)}{!escalations.cases.length && <p><T k="Bu görüşmede yönetici incelemesi gereken vaka yok."/></p>}</section>
    {hasAdminCapability(context.role, "messaging.send") && ["super_admin", "manager"].includes(context.role) ? <section className="form-panel">
      <h2><T k="Yapay zekâ kontrolü"/></h2><p>{<OperatorText value={conversationAutomationLabel(conversation)}/>}</p>
      {activeCase ? <p className="warning-box"><T k="Açık vaka için işlemleri"/> <Link href={`/admin/attention/${activeCase.id}`}><T k="vaka ekranından"/></Link> <T k="yürütün. İnceleme tamamlanmadan otomatik yanıtları açmayın."/></p> : <ConversationAutomationControl conversationId={conversation.id} active={conversation.automatic_replies_enabled && conversation.runtime_mode === "AI_ACTIVE"}/>}
      <p className="muted"><T k="Yalnızca bu görüşme ve yeni mesajlar için geçerlidir. Marka gönderim kısıtları ve yanıt kalite kontrolleri korunur."/></p>
    </section> : null}
    {canReply ? <section className="form-panel" id="customer-reply"><h2><T k="Müşteriye Yanıt Ver"/></h2><p className="muted"><T k="Gönderim izni, vaka sahipliği ve müşteriyle iletişim izni backend tarafından yeniden doğrulanır."/></p><ManualMessageReply conversationId={conversation.id} /></section> : null}
    <section className="detail-card full-width-card"><h2><T k="Müşteri mesajları"/></h2>
      <ul>{messages.map((message) => <li key={message.id}>
        <strong>{message.direction === "inbound" ? <T k="Müşteri"/> : <T k="Temsilci"/>} · {<OperatorText value={messageDeliveryLabel(message.status)}/>}</strong>
        <span>{message.content}</span>
        <small>{<AdminDate value={message.occurred_at}/>}{message.failure_code ? ` · ${message.failure_code}` : ""}</small>
      </li>)}{messages.length === 0 ? <li className="empty-state"><T k="Henüz mesaj yok."/></li> : null}</ul>
    </section>
    <details className="case-panel case-technical"><summary><T k="Satış önerisi ve müşteri analizi · Teknik ayrıntılar"/></summary>
    {commercial?<section className="detail-card"><h2><T k="Commercial recommendation"/></h2><p>{<AdminEnum value={commercial.status}/>}{commercial.failure?" · Attention: "+commercial.failure:""}</p><p>{commercial.result?.action} · {commercial.result?.reason}</p><p><T k="Plan version:"/> {commercial.result?.plan_version_id??<T k="No eligible plan selected"/>} · {commercial.result?.offer_id?<Link href="/admin/offers"><T k="Offer proposal"/></Link>:<T k="No offer prepared"/>}</p>{commercial.run_id&&<Link href={"/admin/agent-runs/"+commercial.run_id}><T k="Source and task evidence"/></Link>}<p><T k="Follow-up:"/> {commercial.result?.follow_up?.action??<T k="WAIT"/>} · {commercial.result?.follow_up?.reason??<T k="No follow-up proposed"/>}<T k=". No independent delivery."/></p></section>:null}
    {lead ? <section className="table-card table-scroll">
      <h2><T k="Lead qualification"/></h2>
      <p>{<AdminEnum value={lead.status}/>}{lead.failure ? ` · Attention required: ${lead.failure}` : ""} · {lead.runId ? <Link href={`/admin/agent-runs/${lead.runId}`}><T k="Task / run evidence"/></Link> : <T k="No completed run"/>}</p>
      {lead.result ? <>
        <p>{lead.result.identity === "unmatched" ? <T k="Unmatched identity — conversation evidence only; no customer profile linked."/> : <T k="Verified customer linkage"/>}</p>
        <p><T k="Completeness:"/> {Math.round(lead.result.completeness*100)}<T k="% · Missing / unconfirmed:"/> {lead.result.missing_fields.join(", ") || <T k="None"/>}</p>
        <p><T k="Recommended next action:"/> <strong>{lead.result.next_action.action}</strong> · {lead.result.next_action.reason}</p>
        <p>{lead.result.next_action.question ?? <T k="No qualification question proposed."/>} <T k="· Delivery remains separately controlled."/></p>
        <table><thead><tr><th><T k="Field"/></th><th><T k="Value"/></th><th><T k="Evidence class"/></th><th><T k="Source / time"/></th></tr></thead><tbody>
          {lead.result.fields.map(field=><tr key={field.key}><td>{field.key}</td><td>{field.value ?? <T k="Unknown"/>}</td><td>{field.classification} · {Math.round(field.confidence*100)}%</td><td>{field.source ? <><small>{field.source.id} · {<AdminDate value={field.source.observed_at}/>}</small><small>{field.source.quote}</small></> : <T k="No evidence"/>}</td></tr>)}
        </tbody></table>
      </> : <p><T k="No validated qualification result. Review the task status above."/></p>}
    </section> : null}

    </details>
  </main>;
}
