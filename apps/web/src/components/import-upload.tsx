"use client";

import { useState } from "react";

type Report = { batch_id: string; total_rows: number; exact_match_count: number; probable_match_count: number; ambiguous_count: number; new_customer_count: number; rejected_count: number; validation_error_count: number; planned_mutation_count: number };

export default function ImportUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("historical_signal_customers");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setReport(null);
    if (!file) { setError("Select a CSV or XLSX file."); return; }
    setBusy(true);
    try {
      const body = new FormData(); body.set("file", file); body.set("source_name", source);
      const response = await fetch("/api/v1/customers/import", { method: "POST", body });
      const payload = await response.json() as { report?: Report; error?: { message?: string } };
      if (!response.ok || !payload.report) throw new Error(payload.error?.message ?? "Dry-run failed");
      setReport(payload.report);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Dry-run failed"); }
    finally { setBusy(false); }
  }
  return <section className="form-panel"><form onSubmit={(event) => { void submit(event); }} className="form-stack"><label>Source name<input value={source} onChange={(event) => setSource(event.target.value)} maxLength={160} required /></label><label>Customer file<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /></label><p className="muted">Maximum 4 MB / 5,000 rows. The file is parsed in memory and is never committed to GitHub.</p><button className="primary-button" type="submit" disabled={busy}>{busy ? "Running dry-run…" : "Run dry-run"}</button></form>{error && <p className="error-banner">{error}</p>}{report && <div className="reconciliation"><p className="eyebrow">RECONCILIATION READY</p><h2>Review before import</h2><div className="metric-grid">{[["Total rows",report.total_rows],["Exact match",report.exact_match_count],["Probable",report.probable_match_count],["Ambiguous",report.ambiguous_count],["New customer",report.new_customer_count],["Rejected",report.rejected_count],["Validation errors",report.validation_error_count],["Planned mutations",report.planned_mutation_count]].map(([label,value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><a className="secondary-button" href={`/admin/imports/${report.batch_id}`}>Open dedup review</a></div>}</section>;
}
