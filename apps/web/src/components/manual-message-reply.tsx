"use client";

import { useState } from "react";

export function ManualMessageReply({ conversationId }: { conversationId: string }) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setStatus(null);
    const key = crypto.randomUUID();
    const response = await fetch(`/api/v1/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ content, correlation_id: crypto.randomUUID() }),
    });
    const result = await response.json() as { status?: string; error?: string };
    setStatus(response.ok ? `Message status: ${result.status ?? "queued"}` : `Send denied: ${result.error ?? "unknown"}`);
    if (response.ok) setContent("");
    setSending(false);
  }

  return <form className="transition-form" onSubmit={submit}>
    <label>Manual reply<textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={4096} rows={4} required /></label>
    <button className="primary-button" disabled={sending || content.trim().length === 0} type="submit">{sending ? "Sending…" : "Send via Telegram"}</button>
    {status ? <p className="form-message" role="status">{status}</p> : null}
  </form>;
}
