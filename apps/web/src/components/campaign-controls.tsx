"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { CampaignOptions, CampaignWorkspace } from "@gold-revenue-os/contracts";
import { AdminNumber, useAdminI18n } from "./admin-i18n";
import { authorizeCampaignImport, saveCampaign, changeCampaignState, type CampaignActionState } from "../app/admin/polat-operations/campaigns/actions";

const initial: CampaignActionState = { state: "IDLE" };
function Feedback({ state }: { state: CampaignActionState }) {
  const { locale } = useAdminI18n(), tr = locale === "tr-TR";
  const copy = { SAVED: ["Kaydedildi. Görünümü yenileyerek güncel durumu kontrol edin.", "Saved. Refresh to inspect the committed state."], MFA_REQUIRED: ["Yetkili kurucu oturumu ve güncel MFA doğrulaması gerekli.", "An authorized founder session and current MFA verification are required."], INVALID: ["Alanları kontrol edin; işlem uygulanmadı.", "Check the fields; no operation was applied."], BLOCKED: ["Hazırlık koşulları eksik. Engelleri kontrol edin.", "Readiness prerequisites are missing. Inspect the blockers."], CHANGED: ["Kayıt değişti. Yenileyip tekrar kontrol edin.", "The record changed. Refresh before continuing."], UNAVAILABLE: ["İşlem doğrulanamadı. Yenileyerek mevcut kaydı kontrol edin; tekrarlanmış başarı varsayılmaz.", "The operation could not be confirmed. Refresh the current record; success is not assumed."] };
  return state.state === "IDLE" ? null : <p role="status" className={state.state === "SAVED" ? "info-box" : "warning-box"}>{copy[state.state][tr ? 0 : 1]}</p>;
}
export function CampaignBatchAuthorization({ batchId, source, hash, completed, reconciliation }: { batchId: string; source: string; hash: string | null; completed: boolean; reconciliation: { imported_rows: number; unique_customers: number; pending_identity_review: number } | null }) {
  const { locale } = useAdminI18n(), tr = locale === "tr-TR";
  const [state, action, pending] = useActionState(authorizeCampaignImport, initial);
  return <section className="detail-card"><h2>{tr ? "Toplu müşteri izni ve aktarım" : "Batch permission and import"}</h2>
    {reconciliation && <dl className="polat-facts"><div><dt>{tr ? "Aktarılan satır" : "Imported rows"}</dt><dd><AdminNumber value={reconciliation.imported_rows}/></dd></div><div><dt>{tr ? "Tekil müşteri" : "Unique customers"}</dt><dd><AdminNumber value={reconciliation.unique_customers}/></dd></div><div><dt>{tr ? "Kimlik incelemesinde" : "Identity exceptions"}</dt><dd><AdminNumber value={reconciliation.pending_identity_review}/></dd></div></dl>}
    <p>{tr ? "Tek beyan, bu dosyanın uygun satırlarını kapsar. İzin kurucu beyanı olarak kaydedilir; bağımsız bireysel rıza sayılmaz. Belirsiz kimlikler incelemede kalır. Aktarım mesaj göndermez." : "One declaration covers eligible rows in this file. It records founder-attested permission, not independently verified individual consent. Ambiguous identities remain held. Import sends no messages."}</p>
    {completed ? <p role="status">{tr ? "Aktarım tamamlandı. Kampanya yapılandırmasına geçebilirsiniz." : "Import completed. You can configure the campaign."}</p> : <form action={action} className="form-stack">
      <input type="hidden" name="batch_id" value={batchId}/><input type="hidden" name="source" value={source}/><input type="hidden" name="dataset_hash" value={hash ?? ""}/>
      <label>{tr ? "Veri sürümü" : "Dataset version"}<input name="dataset_version" required maxLength={80} placeholder="historical-customers-v1"/></label>
      <label>{tr ? "İzin/kaynak referansı" : "Permission/source reference"}<input name="reference" required maxLength={160}/></label>
      <label>{tr ? "İletişim kanalı" : "Communication channel"}<select name="channel"><option value="TELEGRAM_BOT">Telegram Bot</option><option value="TELEGRAM_BUSINESS">Telegram Business</option></select></label>
      <label>{tr ? "İzin kapsamındaki ülke kodları (virgülle)" : "Permitted country codes (comma separated)"}<input name="markets" required placeholder="GB, DE"/></label>
      <label><input name="attested" type="checkbox" value="yes" required/>{tr ? "Bu dosya ve belirtilen kanaldaki mevcut müşteri iletişim izinlerini kurucu olarak beyan ediyorum." : "As founder, I attest the existing customer communication permissions for this file and channel."}</label>
      <button className="primary-button" disabled={pending || !hash}>{tr ? "BEYANI KAYDET VE UYGUN SATIRLARI AKTAR" : "RECORD DECLARATION AND IMPORT ELIGIBLE ROWS"}</button>
    </form>}<Feedback state={state}/><Link href="/admin/polat-operations/campaigns" className="text-button">{tr ? "Kampanya merkezi" : "Campaign center"}</Link>
  </section>;
}

function CampaignStateControl({ id, revision, state: current }: { id: string; revision: number; state: string }) {
  const { locale } = useAdminI18n(), tr = locale === "tr-TR";
  const [state, action, pending] = useActionState(changeCampaignState, initial);
  return <><form action={action} className="polat-actions"><input type="hidden" name="campaign_id" value={id}/><input type="hidden" name="revision" value={revision}/>
    {current !== "ACTIVE" && current !== "STOPPED" && <button className="primary-button" name="action" value="START" disabled={pending}>{tr ? "KAMPANYAYI BAŞLAT" : "START CAMPAIGN"}</button>}
    {current === "ACTIVE" && <button className="secondary-button" name="action" value="PAUSE" disabled={pending}>{tr ? "DURAKLAT" : "PAUSE CAMPAIGN"}</button>}
    {current !== "STOPPED" && <button className="secondary-button" name="action" value="STOP" disabled={pending}>{tr ? "DURDUR" : "STOP CAMPAIGN"}</button>}
  </form><Feedback state={state}/></>;
}

export function CampaignCenter({ workspace, options, owner, commandId, starts, expires }: { workspace: CampaignWorkspace | null; options: CampaignOptions | null; owner: boolean; commandId: string; starts: string; expires: string }) {
  const { locale } = useAdminI18n(), tr = locale === "tr-TR", say = (a: string, b: string) => tr ? a : b;
  const [state, action, pending] = useActionState(saveCampaign, initial);
  const labels: Record<string, string> = { CONFIGURING: say("Yapılandırılıyor", "Configuring"), READY: say("Yapılandırma hazır", "Configuration ready"), ACTIVE: say("Etkin", "Active"), PAUSED: say("Duraklatıldı", "Paused"), STOPPED: say("Durduruldu", "Stopped") };
  return <main className="admin-main polat-operations"><Link className="back-link" href="/admin/polat-operations">{say("← Polat İşlemleri", "← Polat Operations")}</Link>
    <h1>{say("Kampanya merkezi", "Campaign center")}</h1><p className="lede">{say("Kitle, fiyat ve sınırlar bir kez belirlenir; rutin mesajlar ayrıca kurucu onayına gönderilmez.", "Configure audience, price and limits once; routine messages require no further founder approval.")}</p>
    <p className="warning-box">{say("Kampanya aktivasyonu tek başına gerçek gönderim, model hesabı veya ödeme yetkisi sağlamaz. Mevcut yayında gerçek kampanya yürütücüsü henüz kabul edilmedi. Sentetik onay gerçek teslimat değildir.", "Campaign activation alone grants no real dispatch, model account or payment authority. The current release has no accepted genuine campaign executor. Synthetic acknowledgement is not real delivery.")}</p>
    {!workspace && <p role="status" className="warning-box">{say("Veri okunamadı. Yetkili hesapta MFA doğrulayın; veritabanı sürümünü kontrol edin.", "Data unavailable. Verify MFA on an authorized account and check the database version.")}</p>}
    {workspace?.items.map(c => <section key={c.id} className="table-card"><div className="card-heading"><h2>{c.name}</h2><span className="state-pill">{labels[c.state]} · {c.mode === "SYNTHETIC" ? say("SENTETİK", "SYNTHETIC") : say("TİCARİ YAPILANDIRMA", "COMMERCIAL CONFIGURATION")}</span></div>
      <div className="metric-grid">{([
        ["imported", "Aktarılan tekil müşteri", "Imported unique customers"], ["eligible", "Uygun", "Eligible"], ["reachable", "Ulaşılabilir", "Reachable"],
        ["active_conversations", "Açık konuşma", "Open conversations"], ["awaiting_responses", "Yanıt bekleyen", "Awaiting response"], ["scheduled", "Planlanan takip", "Scheduled follow-ups"],
        ["interested", "İlgilenen", "Interested"], ["pending_payments", "Ödeme bekleyen", "Pending payments"], ["verified_sales", "Doğrulanmış satış", "Verified sales"],
        ["active_vip", "Doğrulanmış VIP", "Verified VIP"], ["unknown", "Başarısız / inceleme", "Failed / review"], ["suppressed", "İletişim engelli", "Suppressed"],
      ] as const).map(([key, a, b]) => <article className="metric-card" key={key}><span>{say(a, b)}</span><strong><AdminNumber value={c[key]}/></strong></article>)}</div>
      <p>{say("Gelir ve gerçek maliyet: BİLİNMİYOR. Ayrılan azami yükümlülük fatura değildir.", "Revenue and actual cost: UNKNOWN. Reserved maximum liability is not billed cost.")}</p>
      {c.blockers.length > 0 && <details open><summary>{say("Yürütme engelleri", "Execution blockers")}</summary><ul>{c.blockers.map(reason => <li key={reason}><code>{reason}</code></li>)}</ul></details>}
      {owner && <CampaignStateControl id={c.id} revision={c.revision} state={c.state}/>}
      <Link href={`/admin/imports/${c.configuration.batch_id}`}>{say("Aktarım uzlaştırması", "Import reconciliation")}</Link>
    </section>)}
    {workspace?.next_after && <Link className="secondary-button" href={`?after=${workspace.next_after}`}>{say("Sonraki 25 kampanya", "Next 25 campaigns")}</Link>}
    {owner && <section className="detail-card"><h2>{say("Yeni kampanya", "New campaign")}</h2><p><Link href="/admin/imports">{say("Önce müşteri dosyasını aktarın ve toplu beyanı kaydedin.", "First import the customer file and record its batch declaration.")}</Link></p>
      <form action={action} className="form-stack"><input type="hidden" name="campaign_id" value={commandId}/><input type="hidden" name="revision" value="0"/>
        <label>{say("Kampanya adı", "Campaign name")}<input name="name" required maxLength={120}/></label>
        <label>{say("Çalışma kapsamı", "Execution scope")}<select name="mode"><option value="COMMERCIAL">{say("Ticari yapılandırma — gerçek gönderim kapalı", "Commercial configuration — real dispatch disabled")}</option><option value="SYNTHETIC">{say("Yalıtılmış sentetik test", "Isolated synthetic test")}</option></select></label>
        <label>{say("İşlenmiş müşteri kitlesi", "Processed customer audience")}<select name="batch_id" required defaultValue=""><option value="" disabled>{say("Kitle seçin", "Choose audience")}</option>{options?.batches.map(b => <option key={b.id} value={b.id}>{b.source} · {b.unique_customers}</option>)}</select></label>
        <label>{say("Yayınlanmış fiyat/plan", "Published price/plan")}<select name="plan_version_id" required defaultValue=""><option value="" disabled>{say("Plan seçin", "Choose plan")}</option>{options?.plans.map(p => <option key={p.id} value={p.id}>{p.title} · {p.amount} {p.currency}{p.test_only ? say(" · TEST", " · TEST") : ""}</option>)}</select></label>
        <label>{say("Hedef ülke kodları", "Target country codes")}<input name="markets" required placeholder="GB, DE"/></label>
        <label>{say("Başlangıç (UTC ISO)", "Starts (UTC ISO)")}<input name="starts_at" defaultValue={starts} required/></label>
        <label>{say("Bitiş (UTC ISO)", "Expires (UTC ISO)")}<input name="expires_at" defaultValue={expires} required/></label>
        {([
          ["maximum_messages", "Toplam mesaj sınırı", "Total message ceiling", 100], ["maximum_per_customer", "Kişi başına toplam", "Lifetime per customer", 3],
          ["maximum_per_day", "Kişi başına günlük", "Per customer per day", 1], ["minimum_interval_seconds", "Asgari aralık (saniye)", "Minimum interval (seconds)", 86400],
          ["follow_up_after_seconds", "Takip aralığı (saniye)", "Follow-up interval (seconds)", 86400], ["maximum_model_calls", "Başlatılan model çağrısı sınırı", "Initiated model-call ceiling", 100],
          ["maximum_output_tokens", "Azami çıktı tokenı", "Maximum output tokens", 512], ["window_start", "Yerel iletişim başlangıç saati", "Local contact start hour", 9],
          ["window_end", "Yerel iletişim bitiş saati", "Local contact end hour", 18],
        ] as const).map(([key, a, b, value]) => <label key={key}>{say(a, b)}<input type="number" name={key} defaultValue={value} min={key.startsWith("window_") ? 0 : 1} step="1" required/></label>)}
        <label>{say("Bütçe tavanı (USD; aktivasyon izni değildir)", "Budget ceiling (USD; not execution permission)")}<input name="budget_amount" inputMode="decimal" required/></label>
        <label>{say("Çağrı başına azami yükümlülük (USD)", "Maximum liability per call (USD)")}<input name="maximum_liability_per_call" inputMode="decimal" required/></label>
        <label>{say("İletişim saat dilimi", "Contact timezone")}<input name="timezone" defaultValue="UTC" required/></label>
        <button className="primary-button" disabled={pending}>{say("YAPILANDIRMAYI KAYDET", "SAVE CONFIGURATION")}</button>
      </form><Feedback state={state}/></section>}
  </main>;
}
