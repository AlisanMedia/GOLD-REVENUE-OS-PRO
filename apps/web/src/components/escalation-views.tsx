import Link from "next/link";
import { escalationDuration, escalationReference } from "@gold-revenue-os/domain";
import { ManualMessageReply } from "./manual-message-reply";
import { EscalationControls } from "./escalation-controls";
import type { EscalationCase, EscalationReadModel } from "@/lib/escalations/admin";
import { availableEscalationActions, caseStage, categoryLabel, categorySummary, conversationAutomationLabel, historyLabel, managerLabel, nextCaseAction, notificationHelp, notificationLabel, operatorDate, severityLabel } from "@/lib/escalations/presentation";

export function CasePriority({ value }: { value: string }) {
  return <span className={`case-priority case-priority-${value.toLowerCase()}`}>{severityLabel(value)}</span>;
}
export function EscalationQueue({ cases, userId }: { cases: EscalationCase[]; userId: string }) {
  const open = cases.filter(c => c.status !== "RESOLVED");
  return <section className="case-section" aria-labelledby="case-queue-heading">
    <div className="case-section-heading"><div><h2 id="case-queue-heading">Yönetici incelemesi</h2><p className="muted">{open.length} açık vaka · Öncelik ve ilk inceleme sırasına göre</p></div></div>
    <div className="case-list">{cases.map(c => <article className="case-card" key={c.id}>
      <div className="case-card-heading"><CasePriority value={c.severity}/><span className="case-reference">{escalationReference(c.id)}</span></div>
      <h3><Link href={`/admin/attention/${c.id}`}>{categoryLabel(c.category)}</Link></h3><p>{categorySummary(c.category)}</p>
      <dl className="case-card-facts"><div><dt>Durum</dt><dd>{caseStage(c)}</dd></div><div><dt>Sorumlu</dt><dd>{managerLabel(c.assigned_to, userId)}</dd></div>
        <div><dt>İlk inceleme beklemesi</dt><dd>{escalationDuration(c.waiting_seconds)}</dd></div><div><dt>Yönetici bildirimi</dt><dd>{notificationLabel(c.notification?.status)}</dd></div></dl>
      <Link className="secondary-button" href={`/admin/attention/${c.id}`}>Vakayı İncele<span className="sr-only">: {categoryLabel(c.category)} · {escalationReference(c.id)}</span></Link>
    </article>)}</div>
    {!cases.length ? <div className="case-panel case-empty"><h3>İnceleme bekleyen vaka yok</h3><p>Yeni bir vaka oluştuğunda önceliği ve sonraki adımı burada görünecek.</p></div> : null}
  </section>;
}

export function EscalationCaseView({ data, userId, canManage, conversation }: { data: EscalationReadModel; userId: string; canManage: boolean; conversation?: { runtime_mode: string; automatic_replies_enabled: boolean } | null }) {
  const c = data.cases[0]!;
  const stage = caseStage(c);
  const steps = ["İnceleme Bekliyor", "Yönetici Atandı", "Görüşme Devralındı", "Çözüldü", "Yapay Zekâya Devredildi"];
  const currentStep = steps.indexOf(stage);
  const canReply = availableEscalationActions(c, userId, canManage).includes("resolve");
  return <main className="admin-main case-workspace" lang="tr">
    <Link className="back-link" href="/admin/attention">← İnceleme Merkezi</Link>
    <header className="case-header"><div><p className="eyebrow">YÖNETİCİ İNCELEMESİ · {escalationReference(c.id)}</p>
      <h1>{categoryLabel(c.category)}</h1><p className="lede">{categorySummary(c.category)}</p></div><CasePriority value={c.severity}/></header>
    <ol className="case-progress" aria-label="Vaka ilerlemesi">{steps.map((step, index) => <li key={step} aria-current={index === currentStep ? "step" : undefined} data-reached={index <= currentStep}><span aria-hidden="true">{index + 1}</span>{step}</li>)}</ol>
    <div className="case-layout"><div className="case-main-column">
      <section className="case-panel case-next"><h2>Şimdi ne yapmalısınız?</h2><p>{nextCaseAction(c, userId, canManage)}</p>
        <div className="case-links">{canReply ? <a className="primary-button" href="#customer-reply">Müşteriye Yanıt Ver</a> : null}<Link className="secondary-button" href={`/admin/conversations/${c.conversation_id}`}>Görüşmeyi Aç</Link></div>
      </section>
      <section className="case-panel"><h2>Vaka özeti</h2><dl className="case-facts">
        <div><dt>Durum</dt><dd>{stage}</dd></div><div><dt>Sorumlu yönetici</dt><dd>{managerLabel(c.assigned_to, userId)}</dd></div>
        <div><dt>İlk inceleme beklemesi</dt><dd>{escalationDuration(c.waiting_seconds)}</dd></div><div><dt>Yapay zekâ</dt><dd>{conversationAutomationLabel(conversation)}</dd></div>
        <div><dt>Açılış</dt><dd>{operatorDate(c.created_at)}</dd></div><div><dt>İlk inceleme</dt><dd>{operatorDate(c.acknowledged_at)}</dd></div>
        <div><dt>İlk teslim edilmiş insan yanıtı</dt><dd>{operatorDate(c.first_response_at)}</dd></div><div><dt>Çözüm</dt><dd>{operatorDate(c.resolved_at)}</dd></div>
      </dl>{c.resolution_note ? <div className="case-resolution"><h3>Yönetici çözüm notu</h3><p>{c.resolution_note}</p></div> : null}</section>
      {canReply ? <section className="case-panel" id="customer-reply"><h2>Müşteriye Yanıt Ver</h2><ManualMessageReply conversationId={c.conversation_id}/></section> : null}
      <EscalationControls c={c} managers={data.managers} userId={userId} canManage={canManage}/>
    </div><aside className="case-side-column">
      <section className="case-panel"><h2>Yönetici bildirimi</h2><p className="case-delivery">{notificationLabel(c.notification?.status)}</p><p className="muted">{notificationHelp(c.notification?.status)}</p>
        {c.notification?.sent_at ? <p>Gönderim kaydı: {operatorDate(c.notification.sent_at)}</p> : null}</section>
      <section className="case-panel"><h2>Kaynak kanıtları</h2>{data.evidence.length ? <ul className="case-timeline">{data.evidence.map(e => <li key={e.id}><strong>{categoryLabel(e.category)}</strong><span>{e.source_kind === "inbound" ? "Müşteri mesajı" : "Yanıt kalite değerlendirmesi"}</span><time dateTime={e.created_at}>{operatorDate(e.created_at)}</time></li>)}</ul> : <p>Görüntülenebilir ek kanıt yok.</p>}</section>
      <section className="case-panel"><h2>İşlem geçmişi</h2>{data.history.length ? <ol className="case-timeline">{data.history.map(h => <li key={h.id}><strong>{historyLabel(h.action)}</strong><span>{h.actor_id ? managerLabel(h.actor_id, userId) : "Sistem"}</span><time dateTime={h.created_at}>{operatorDate(h.created_at)}</time></li>)}</ol> : <p>Görüntülenebilir işlem kaydı yok.</p>}</section>
    </aside></div>
    <details className="case-panel case-technical"><summary>Teknik kayıtlar ve teslim kanıtı</summary>
      <dl><div><dt>Vaka kimliği</dt><dd>{c.id}</dd></div><div><dt>Veritabanı durumu / revizyon</dt><dd>{c.status} / {c.revision}</dd></div><div><dt>Yönetici kimliği</dt><dd>{c.assigned_to ?? "Atanmadı"}</dd></div>
        <div><dt>Bildirim durumu / deneme</dt><dd>{c.notification?.status ?? "—"} / {c.notification?.attempts ?? 0}</dd></div><div><dt>Provider mesaj kimliği</dt><dd>{c.notification?.provider_message_id ?? "—"}</dd></div><div><dt>Teknik hata kodu</dt><dd>{c.notification?.last_error ?? "—"}</dd></div></dl>
      <h3>Kaynak referansları</h3><pre>{JSON.stringify(data.evidence, null, 2)}</pre><h3>Audit ayrıntıları</h3><pre>{JSON.stringify(data.history, null, 2)}</pre>
    </details>
  </main>;
}
