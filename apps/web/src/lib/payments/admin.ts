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
  return { context: c, ...z.object({
    invoice: paymentAdminInvoiceSchema,
    observations: z.array(z.object({ id: z.uuid(), event_id: z.string(), method: z.string(), proposed_state: z.string(), resulting_state: z.string(), reason: z.string(), raw_body_hash: z.string(), created_at: z.string(), evidence: providerSnapshotSchema }).passthrough()),
    transactions: z.array(z.object({ provider_id: z.string(), transaction_reference: z.string(), network: z.string(), created_at: z.string() }).passthrough()),
  }).parse(data) };
}
