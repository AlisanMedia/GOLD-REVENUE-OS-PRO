"use client";
import { T, OperatorText } from "./admin-i18n";

import { useState } from "react";

type Props = { batchId: string; rowId: string; classification: string; candidateId: string | null; normalized: unknown; reviewStatus: string };

export default function ImportRowReview({ batchId, rowId, classification, candidateId, normalized, reviewStatus }: Props) {
  const [status, setStatus] = useState(reviewStatus);
  const [busy, setBusy] = useState(false);
  async function review(resolution: "exact_match" | "new_customer") {
    setBusy(true);
    try {
    const response = await fetch(`/api/v1/imports/${batchId}/rows/${rowId}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolution, candidate_customer_id: resolution === "exact_match" ? candidateId : null }) });
    if (response.ok) setStatus("approved"); else setStatus("The operation could not be confirmed. Check the latest state.");
    } catch { setStatus("The operation could not be confirmed. Check the latest state."); } finally { setBusy(false); }
  }
  return <div className="review-row"><div><span className="state-pill">{classification}</span><small>{<OperatorText value={status}/>}</small><pre>{JSON.stringify(normalized, null, 2)}</pre></div>{(classification === "probable_match" || classification === "ambiguous") && <div className="review-actions"><button className="secondary-button" disabled={busy || !candidateId} onClick={() => { void review("exact_match"); }}><T k="Link candidate"/></button><button className="secondary-button" disabled={busy} onClick={() => { void review("new_customer"); }}><T k="Create new"/></button></div>}</div>;
}
