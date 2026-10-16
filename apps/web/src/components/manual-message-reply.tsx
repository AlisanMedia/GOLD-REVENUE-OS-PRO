"use client";
import { T, OperatorText } from "./admin-i18n";

import { useRef, useState } from "react";
import { manualReplyResult } from "../lib/escalations/manual-reply";

export function ManualMessageReply({ conversationId }: { conversationId: string }) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef<{ content: string; key: string; correlationId: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !content.trim()) return;
    inFlight.current = true;
    setSending(true);
    setStatus(null);
    if (attempt.current?.content !== content) attempt.current = { content, key: crypto.randomUUID(), correlationId: crypto.randomUUID() };
    try {
      const response = await fetch(`/api/v1/conversations/${conversationId}/messages`, {
        method: "POST",
      signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/json", "idempotency-key": attempt.current.key },
        body: JSON.stringify({ content, correlation_id: attempt.current.correlationId }),
      });
      const result = await response.json() as { status?: string; error?: string };
      setStatus(manualReplyResult(response.ok, result));
      if (response.ok && ["sent", "pending", "queued", "sending", "retry_scheduled"].includes(result.status ?? "")) { setContent(""); attempt.current = null; }
    } catch {
      setStatus("Gönderim sonucu doğrulanamadı. Görüşmeyi kontrol edin. Aynı taslağı tekrar denerseniz aynı gönderim anahtarı kullanılır.");
    } finally { setSending(false); inFlight.current = false; }
  }

  return <form className="transition-form" onSubmit={submit}>
    <label><T k="Müşteriye yanıt · Varsayılan dil: İngilizce"/><textarea lang="en" placeholder="Write a short, professional reply in English…" value={content} onChange={(event) => setContent(event.target.value)} maxLength={4096} rows={4} required disabled={sending} aria-describedby={`reply-language-${conversationId}`}/></label>
    <p className="muted" id={`reply-language-${conversationId}`}><T k="Bu metin müşteriye gönderilir. Panelin Türkçe olması yanıt dilini değiştirmez. Müşterinin açık dil tercihi varsa ona uyun; metin otomatik çevrilmez."/></p>
    <button className="primary-button" disabled={sending || content.trim().length === 0} type="submit">{sending ? <T k="Gönderiliyor…"/> : <T k="Müşteriye Gönder"/>}</button>
    {status ? <p className="form-message" role="status">{<OperatorText value={status}/>}</p> : null}
  </form>;
}
