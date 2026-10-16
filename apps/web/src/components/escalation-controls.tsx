"use client";
import { T, useAdminI18n, OperatorText } from "./admin-i18n";
import { useActionState } from "react";
import { controlEscalation } from "@/app/admin/attention/actions";
import { availableEscalationActions, managerLabel, type EscalationAction } from "@/lib/escalations/presentation";
import type { EscalationCase } from "@/lib/escalations/admin";

function CaseAction({ c, action, children }: { c: EscalationCase; action: EscalationAction; children: React.ReactNode }) {
  const [state, formAction, pending] = useActionState(controlEscalation, { kind: "idle" as const, message: "" });
  return <form action={formAction} className="case-action-form">
    <input type="hidden" name="case_id" value={c.id}/><input type="hidden" name="revision" value={c.revision}/>
    <input type="hidden" name="action" value={action}/>
    <fieldset disabled={pending}>{children}</fieldset>
    {pending ? <p role="status"><T k="İşlem kaydediliyor…"/></p> : null}
    {state.message ? <p role={state.kind === "error" ? "alert" : "status"} className={state.kind === "error" ? "error-banner" : "form-message"}>{<OperatorText value={state.message}/>}</p> : null}
  </form>;
}
export function EscalationControls({ c, managers, userId, canManage }: { c: EscalationCase; managers: { id: string; role: string }[]; userId: string; canManage: boolean }) {
 const { t } = useAdminI18n();
  const actions = availableEscalationActions(c, userId, canManage);
  if (!actions.length) return null;
  return <section className="case-panel" aria-labelledby="case-actions-heading"><h2 id="case-actions-heading"><T k="Vaka işlemleri"/></h2>
    {actions.includes("takeover") ? <CaseAction c={c} action="takeover">
      <p><T k="Üstlendiğinizde görüşme size atanır ve yapay zekâ yanıtları duraklatılır."/></p>
      {c.assigned_to && c.assigned_to !== userId ? <label className="case-confirm"><input type="checkbox" required/><T k="Bu vaka başka bir yöneticiye atanmış. Devralmayı onaylıyorum."/></label> : null}
      <button className="primary-button" type="submit"><T k="Vakayı Üstlen"/></button>
    </CaseAction> : null}
    {actions.includes("resolve") ? <CaseAction c={c} action="resolve">
      <label><T k="Çözüm notu"/><textarea name="note" required maxLength={1000} rows={3} placeholder={t("Ne incelendi ve nasıl sonuçlandı? Gerçekleşmemiş bir işlemi yazmayın.")}/></label>
      <p className="muted"><T k="Bu not yalnızca yöneticiler içindir; müşteriye gönderilmez. Vaka çözümü ödeme, iade veya erişim işlemi yapmaz."/></p>
      <button className="primary-button" type="submit"><T k="Çözüldü Olarak İşaretle"/></button>
    </CaseAction> : null}
    {actions.includes("return") ? <CaseAction c={c} action="return">
      <p><T k="Yapay zekâ yalnızca bundan sonra gelen müşteri mesajlarında devam eder. Eski taslaklar yeniden gönderilmez."/></p>
      <label className="case-confirm"><input type="checkbox" required/><T k="İnceleme tamamlandı; yeni mesajlarda yapay zekânın devam etmesini onaylıyorum."/></label>
      <button className="primary-button" type="submit"><T k="Yapay Zekâya Devret"/></button>
    </CaseAction> : null}
    {actions.includes("assign") ? <details className="case-assignment"><summary><T k="Başka yöneticiye ata"/></summary><CaseAction c={c} action="assign">
      <label><T k="Yönetici"/><select name="assignee" required defaultValue=""><option value="" disabled><T k="Yönetici seçin"/></option>{[...managers].sort((a, b) => a.id.localeCompare(b.id)).map(m => <option key={m.id} value={m.id}>{<OperatorText value={managerLabel(m.id, userId)}/>}</option>)}</select></label>
      <p className="muted"><T k="Atama tek başına görüşmeyi devralmaz. Yönetici görüşmeyi ayrıca üstlenir."/></p>
      <button className="secondary-button" type="submit"><T k="Yönetici Ata"/></button>
    </CaseAction></details> : null}
  </section>;
}
