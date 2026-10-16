"use client";
import { T, useAdminI18n, OperatorText, AdminDuration, AdminDate, AdminEnum } from "./admin-i18n";
import Link from "next/link";
import { escalationReference } from "@gold-revenue-os/domain";
import { ManualMessageReply } from "./manual-message-reply";
import { EscalationControls } from "./escalation-controls";
import type { EscalationCase, EscalationReadModel } from "@/lib/escalations/admin";
import { availableEscalationActions, caseStage, categoryLabel, categorySummary, conversationAutomationLabel, historyLabel, managerLabel, nextCaseAction, notificationHelp, notificationLabel, severityLabel } from "@/lib/escalations/presentation";

export function CasePriority({ value }: { value: string }) {
  return <span className={`case-priority case-priority-${value.toLowerCase()}`}>{<OperatorText value={severityLabel(value)}/>}</span>;
}
export function EscalationQueue({ cases, userId }: { cases: EscalationCase[]; userId: string }) {
  const open = cases.filter(c => c.status !== "RESOLVED");
  return <section className="case-section" aria-labelledby="case-queue-heading">
    <div className="case-section-heading"><div><h2 id="case-queue-heading"><T k="Yönetici incelemesi"/></h2><p className="muted">{open.length} <T k="açık vaka · Öncelik ve ilk inceleme sırasına göre"/></p></div></div>
    <div className="case-list">{cases.map(c => <article className="case-card" key={c.id}>
      <div className="case-card-heading"><CasePriority value={c.severity}/><span className="case-reference">{escalationReference(c.id)}</span></div>
      <h3><Link href={`/admin/attention/${c.id}`}>{<OperatorText value={categoryLabel(c.category)}/>}</Link></h3><p>{<OperatorText value={categorySummary(c.category)}/>}</p>
      <dl className="case-card-facts"><div><dt><T k="Durum"/></dt><dd>{<OperatorText value={caseStage(c)}/>}</dd></div><div><dt><T k="Sorumlu"/></dt><dd>{<OperatorText value={managerLabel(c.assigned_to, userId)}/>}</dd></div>
        <div><dt><T k="İlk inceleme beklemesi"/></dt><dd>{<AdminDuration seconds={c.waiting_seconds}/>}</dd></div><div><dt><T k="Yönetici bildirimi"/></dt><dd>{<OperatorText value={notificationLabel(c.notification?.status)}/>}</dd></div></dl>
      <Link className="secondary-button" href={`/admin/attention/${c.id}`}><T k="Vakayı İncele"/><span className="sr-only">: {<OperatorText value={categoryLabel(c.category)}/>} · {escalationReference(c.id)}</span></Link>
    </article>)}</div>
    {!cases.length ? <div className="case-panel case-empty"><h3><T k="İnceleme bekleyen vaka yok"/></h3><p><T k="Yeni bir vaka oluştuğunda önceliği ve sonraki adımı burada görünecek."/></p></div> : null}
  </section>;
}

export function EscalationCaseView({ data, userId, canManage, conversation }: { data: EscalationReadModel; userId: string; canManage: boolean; conversation?: { runtime_mode: string; automatic_replies_enabled: boolean } | null }) {
 const { t } = useAdminI18n();
  const c = data.cases[0]!;
  const stage = caseStage(c);
  const steps = ["İnceleme Bekliyor", "Yönetici Atandı", "Görüşme Devralındı", "Çözüldü", "Yapay Zekâya Devredildi"];
  const currentStep = steps.indexOf(stage);
  const canReply = availableEscalationActions(c, userId, canManage).includes("resolve");
  return <main className="admin-main case-workspace">
    <Link className="back-link" href="/admin/attention"><T k="← İnceleme Merkezi"/></Link>
    <header className="case-header"><div><p className="eyebrow"><T k="YÖNETİCİ İNCELEMESİ ·"/> {escalationReference(c.id)}</p>
      <h1>{<OperatorText value={categoryLabel(c.category)}/>}</h1><p className="lede">{<OperatorText value={categorySummary(c.category)}/>}</p></div><CasePriority value={c.severity}/></header>
    <ol className="case-progress" aria-label={t("Vaka ilerlemesi")}>{steps.map((step, index) => <li key={step} aria-current={index === currentStep ? "step" : undefined} data-reached={index <= currentStep}><span aria-hidden="true">{index + 1}</span>{<OperatorText value={step}/>}</li>)}</ol>
    <div className="case-layout"><div className="case-main-column">
      <section className="case-panel case-next"><h2><T k="Şimdi ne yapmalısınız?"/></h2><p>{<OperatorText value={nextCaseAction(c, userId, canManage)}/>}</p>
        <div className="case-links">{canReply ? <a className="primary-button" href="#customer-reply"><T k="Müşteriye Yanıt Ver"/></a> : null}<Link className="secondary-button" href={`/admin/conversations/${c.conversation_id}`}><T k="Görüşmeyi Aç"/></Link></div>
      </section>
      <section className="case-panel"><h2><T k="Vaka özeti"/></h2><dl className="case-facts">
        <div><dt><T k="Durum"/></dt><dd>{<OperatorText value={stage}/>}</dd></div><div><dt><T k="Sorumlu yönetici"/></dt><dd>{<OperatorText value={managerLabel(c.assigned_to, userId)}/>}</dd></div>
        <div><dt><T k="İlk inceleme beklemesi"/></dt><dd>{<AdminDuration seconds={c.waiting_seconds}/>}</dd></div><div><dt><T k="Yapay zekâ"/></dt><dd>{<OperatorText value={conversationAutomationLabel(conversation)}/>}</dd></div>
        <div><dt><T k="Açılış"/></dt><dd>{<AdminDate value={c.created_at}/>}</dd></div><div><dt><T k="İlk inceleme"/></dt><dd>{<AdminDate value={c.acknowledged_at}/>}</dd></div>
        <div><dt><T k="İlk teslim edilmiş insan yanıtı"/></dt><dd>{<AdminDate value={c.first_response_at}/>}</dd></div><div><dt><T k="Çözüm"/></dt><dd>{<AdminDate value={c.resolved_at}/>}</dd></div>
      </dl>{c.resolution_note ? <div className="case-resolution"><h3><T k="Yönetici çözüm notu"/></h3><p>{c.resolution_note}</p></div> : null}</section>
      {canReply ? <section className="case-panel" id="customer-reply"><h2><T k="Müşteriye Yanıt Ver"/></h2><ManualMessageReply conversationId={c.conversation_id}/></section> : null}
      <EscalationControls c={c} managers={data.managers} userId={userId} canManage={canManage}/>
    </div><aside className="case-side-column">
      <section className="case-panel"><h2><T k="Yönetici bildirimi"/></h2><p className="case-delivery">{<OperatorText value={notificationLabel(c.notification?.status)}/>}</p><p className="muted">{<OperatorText value={notificationHelp(c.notification?.status)}/>}</p>
        {c.notification?.sent_at ? <p><T k="Gönderim kaydı:"/> {<AdminDate value={c.notification.sent_at}/>}</p> : null}</section>
      <section className="case-panel"><h2><T k="Kaynak kanıtları"/></h2>{data.evidence.length ? <ul className="case-timeline">{data.evidence.map(e => <li key={e.id}><strong>{<OperatorText value={categoryLabel(e.category)}/>}</strong><span>{e.source_kind === "inbound" ? <T k="Müşteri mesajı"/> : <T k="Yanıt kalite değerlendirmesi"/>}</span><time dateTime={e.created_at}>{<AdminDate value={e.created_at}/>}</time></li>)}</ul> : <p><T k="Görüntülenebilir ek kanıt yok."/></p>}</section>
      <section className="case-panel"><h2><T k="İşlem geçmişi"/></h2>{data.history.length ? <ol className="case-timeline">{data.history.map(h => <li key={h.id}><strong>{<OperatorText value={historyLabel(h.action)}/>}</strong><span>{h.actor_id ? managerLabel(h.actor_id, userId) : <T k="Sistem"/>}</span><time dateTime={h.created_at}>{<AdminDate value={h.created_at}/>}</time></li>)}</ol> : <p><T k="Görüntülenebilir işlem kaydı yok."/></p>}</section>
    </aside></div>
    <details className="case-panel case-technical"><summary><T k="Teknik kayıtlar ve teslim kanıtı"/></summary>
      <dl><div><dt><T k="Vaka kimliği"/></dt><dd>{c.id}</dd></div><div><dt><T k="Veritabanı durumu / revizyon"/></dt><dd>{<AdminEnum value={c.status}/>} / {c.revision}</dd></div><div><dt><T k="Yönetici kimliği"/></dt><dd>{c.assigned_to ?? <T k="Atanmadı"/>}</dd></div>
        <div><dt><T k="Bildirim durumu / deneme"/></dt><dd>{c.notification?.status ?? "—"} / {c.notification?.attempts ?? 0}</dd></div><div><dt><T k="Provider mesaj kimliği"/></dt><dd>{c.notification?.provider_message_id ?? "—"}</dd></div><div><dt><T k="Teknik hata kodu"/></dt><dd>{c.notification?.last_error ?? "—"}</dd></div></dl>
      <h3><T k="Kaynak referansları"/></h3><pre>{JSON.stringify(data.evidence, null, 2)}</pre><h3><T k="Audit ayrıntıları"/></h3><pre>{JSON.stringify(data.history, null, 2)}</pre>
    </details>
  </main>;
}
