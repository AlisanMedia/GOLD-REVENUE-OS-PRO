import "server-only";
import { randomBytes } from "node:crypto";
import { paymentInvoiceSchema, type PaymentInvoice } from "@gold-revenue-os/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { testPaymentAdapter, type VerifiedObservation } from "./adapters";

export async function getTestInvoice(id: string): Promise<PaymentInvoice> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("payment_get_test_invoice", { target_invoice_id: id });
  if (error || !data) throw new Error("PAYMENT_INVOICE_UNAVAILABLE");
  return paymentInvoiceSchema.parse(data);
}
export function configuredTestAdapter(provider: string) {
  return testPaymentAdapter(provider, async id => {
    const db = createSupabaseAdminClient();
    const { data, error } = await db.rpc("payment_get_test_snapshot", { target_snapshot_id: id });
    if (error) throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
    return data;
  }, process.env.PAYMENT_TEST_WEBHOOK_SECRET?.trim() || randomBytes(32).toString("hex"));
}
export async function recordVerifiedTestObservation(invoice: PaymentInvoice, verified: VerifiedObservation, method: "webhook" | "reconcile") {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("payment_record_test_observation", {
    target_tenant_id: invoice.tenant_id, target_invoice_id: invoice.id,
    target_snapshot_id: verified.snapshot.id, event_id_value: verified.eventId,
    raw_hash_value: verified.rawBodyHash, method_value: method,
  });
  if (error) throw new Error("PAYMENT_RECORD_REJECTED");
  return data;
}
export async function reconcileTestPayment(invoiceId: string, snapshotId: string, tenantId: string) {
  const invoice = await getTestInvoice(invoiceId);
  if (invoice.tenant_id !== tenantId) throw new Error("PAYMENT_SCOPE_DENIED");
  const result = await configuredTestAdapter(invoice.provider_id).reconcile(invoice, snapshotId);
  return recordVerifiedTestObservation(invoice, result, "reconcile");
}

export async function sandboxWebhookWindowActive(tenantId: string): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient().rpc("payment_test_webhook_window_active", { target_tenant_id: tenantId });
  if (error) throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
  return data === true;
}
