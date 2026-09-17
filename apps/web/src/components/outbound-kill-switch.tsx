"use client";

import { useState } from "react";

export function OutboundKillSwitch({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function update(next: boolean) {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/v1/messaging/kill-switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next, correlation_id: crypto.randomUUID() }),
    });
    const data = await response.json() as { outbound_messaging_enabled?: boolean; error?: string };
    if (response.ok) {
      setEnabled(data.outbound_messaging_enabled === true);
      setMessage(data.outbound_messaging_enabled ? "Outbound messaging enabled." : "Outbound messaging disabled.");
    } else {
      setMessage(`Change denied: ${data.error ?? "unknown"}`);
    }
    setBusy(false);
  }

  return <div className="warning-box">
    <strong>Outbound kill switch: {enabled ? "ENABLED" : "DISABLED"}</strong>
    <p>Inbound remains available. Disabling this switch prevents every provider send at the database boundary.</p>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => update(!enabled)}>
      {busy ? "Updating…" : enabled ? "Disable outbound" : "Enable outbound"}
    </button>
    {message ? <p className="form-message" role="status">{message}</p> : null}
  </div>;
}
