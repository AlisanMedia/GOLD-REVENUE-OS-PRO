"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type TransitionOption = { state: string; triggeringEvent: string };

export default function ManualStateTransition({ customerId, currentState, options }: { customerId: string; currentState: string; options: readonly TransitionOption[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (options.length === 0) return <p className="muted">No safe manual transition is available. Financial, access and subscription edges require trusted deterministic events.</p>;
  return <form className="transition-form" onSubmit={async (event) => {
    event.preventDefault(); setPending(true); setMessage(null);
    const form = new FormData(event.currentTarget);
    const selected = options.find((option) => option.state === form.get("to_state"));
    if (!selected) { setMessage("Select a valid transition."); setPending(false); return; }
    try {
      const correlationId = crypto.randomUUID();
      const response = await fetch(`/api/v1/customers/${customerId}/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_from_state: currentState, to_state: selected.state, reason_code: form.get("reason"), correlation_id: correlationId, triggering_event: selected.triggeringEvent, idempotency_key: `admin:${customerId}:${correlationId}` }) });
      const payload = await response.json() as { accepted?: boolean; error?: { message?: string }; rejection_code?: string };
      if (response.ok && payload.accepted) {
        setMessage("Transition accepted.");
        router.refresh();
      } else {
        setMessage(payload.rejection_code ?? payload.error?.message ?? "Transition rejected.");
      }
    } catch {
      setMessage("Transition request failed safely. No state change was assumed.");
    } finally {
      setPending(false);
    }
  }}><label>Target state<select name="to_state" required defaultValue=""><option value="" disabled>Select allowed state</option>{options.map((option) => <option key={option.state} value={option.state}>{option.state}</option>)}</select></label><label>Reason<input name="reason" required minLength={3} maxLength={120} placeholder="Operational reason code or concise reason" /></label><button className="secondary-button" disabled={pending} type="submit">{pending ? "Submitting…" : "Request transition"}</button>{message ? <p className="form-message" role="status">{message}</p> : null}</form>;
}
