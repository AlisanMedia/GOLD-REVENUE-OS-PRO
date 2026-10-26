import "server-only";
import { z } from "zod";
import { paymentInvoiceSchema, providerSnapshotSchema } from "@gold-revenue-os/domain";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const paymentAdminInvoiceSchema = paymentInvoiceSchema.extend({
  created_at: z.string(), quote_snapshot: z.record(z.string(), z.unknown()),
  last_evidence_at: z.string().nullable(), confirmed_at: z.string().nullable(),
  reconciliation_count: z.number().int(), idempotency_key: z.string(), created_by: z.uuid(),
});
export const starsAdminEvidenceSchema = z.strictObject({
  version: z.literal(1), invoice_id: z.uuid(), mode: z.literal("test"), origin: z.literal("TELEGRAM_DEDICATED_TEST"), financial_authority: z.literal("NONE"),
  receipts: z.array(z.strictObject({ id: z.uuid(), kind: z.enum(["PAYMENT", "REFUND"]), amount_units: z.string().regex(/^[1-9][0-9]{0,29}$/u), currency: z.literal("XTR"), recorded_at: z.iso.datetime({ offset: true }), source_time: z.iso.datetime({ offset: true }), source_hash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(), ledger_hash: z.string().regex(/^[a-f0-9]{64}$/u).nullable() })).max(25),
  subscription: z.strictObject({ id: z.uuid(), state: z.enum(["ACTIVE", "RENEWAL_DUE", "EXPIRED", "HOLD", "SUSPENDED", "CANCELLED"]), mode: z.literal("test") }).nullable(),
  jobs: z.array(z.strictObject({ operation: z.enum(["invite", "join", "revoke", "reconcile"]), status: z.enum(["PENDING", "RUNNING", "DONE", "FAILED", "STALE"]) })).max(25),
  page_size: z.literal(25), has_more_receipts: z.boolean(), has_more_jobs: z.boolean(),
});
export type StarsAdminEvidence = z.infer<typeof starsAdminEvidenceSchema>;
export async function paymentList() {
  const c = await requireAdminCapability("payments.read"), db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("admin_payment_list", { target_tenant_id: c.tenantId });
  if (error) throw new Error("PAYMENTS_UNAVAILABLE");
  return { context: c, invoices: z.array(paymentAdminInvoiceSchema).parse(data) };
}
export async function paymentDetail(id: string) {
  const c = await requireAdminCapability("payments.read"), db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("admin_payment_detail", { target_tenant_id: c.tenantId, target_invoice_id: z.uuid().parse(id) });
  if (error) throw new Error("PAYMENT_UNAVAILABLE");
  if (!data) return null;
  const parsed = z.object({
    invoice: paymentAdminInvoiceSchema,
    observations: z.array(z.object({ id: z.uuid(), event_id: z.string(), method: z.string(), proposed_state: z.string(), resulting_state: z.string(), reason: z.string(), raw_body_hash: z.string(), created_at: z.string(), evidence: providerSnapshotSchema }).passthrough()),
    transactions: z.array(z.object({ provider_id: z.string(), transaction_reference: z.string(), network: z.string(), created_at: z.string() }).passthrough()),
  }).parse(data);
  let starsEvidence: z.infer<typeof starsAdminEvidenceSchema> | null = null;
  if (parsed.invoice.quote_snapshot.origin === "TELEGRAM_DEDICATED_TEST") {
    try {
      const result = await db.rpc("admin_private_beta_stars_evidence_v1", { target_tenant_id: c.tenantId, target_invoice_id: parsed.invoice.id });
      if (!result.error) {
        const evidence = starsAdminEvidenceSchema.parse(result.data);
        const technical = ["super_admin", "manager"].includes(c.role);
        if (evidence.invoice_id !== parsed.invoice.id || !technical && evidence.receipts.some(receipt => receipt.source_hash !== null || receipt.ledger_hash !== null)) throw new Error("STARS_ADMIN_EVIDENCE_SCOPE");
        starsEvidence = evidence;
      }
    } catch { starsEvidence = null; }
  }
  return { context: c, ...parsed, starsEvidence };
}
