"use client";
import { T, OperatorText } from "./admin-i18n";
import { useActionState } from "react";
import { setAutomaticReplies } from "@/app/admin/conversations/[id]/actions";
export function ConversationAutomationControl({ conversationId, active }: { conversationId: string; active: boolean }) {
  const [state, action, pending] = useActionState(setAutomaticReplies, { kind: "idle" as const, message: "" });
  return <form action={action} className="case-action-form">
    <input type="hidden" name="conversation_id" value={conversationId}/><input type="hidden" name="enabled" value={active ? "false" : "true"}/>
    <fieldset disabled={pending}>{!active ? <label className="case-confirm"><input type="checkbox" required/><T k="Yalnızca yeni mesajlar için otomatik yanıtları açmayı onaylıyorum."/></label> : null}
      <button className="secondary-button" type="submit">{active ? <T k="Otomatik Yanıtları Durdur / Görüşmeyi Devral"/> : <T k="Yeni Mesajlarda Yapay Zekâyı Aç"/>}</button></fieldset>
    {pending ? <p role="status"><T k="İşlem kaydediliyor…"/></p> : null}
    {state.message ? <p role={state.kind === "error" ? "alert" : "status"} className={state.kind === "error" ? "error-banner" : "form-message"}>{<OperatorText value={state.message}/>}</p> : null}
  </form>;
}
