"use server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decimalToAtomic, paymentChannelSchema } from "@gold-revenue-os/domain";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reconcileTestPayment } from "@/lib/payments/service";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export async function createTestInvoice(f: FormData) {
  const c = await requireAdminCapability("payments.test");
  let invoiceId: string | undefined;
  try {
    const channel = paymentChannelSchema.parse(field(f, "channel")), asset = channel === "telegram_stars" ? "XTR" : z.enum(["USDT", "USDC"]).parse(field(f, "asset"));
    const db = await createSupabaseServerClient();
    const { data, error } = await db.rpc("admin_create_test_payment_invoice", {
      target_tenant_id: c.tenantId, target_offer_id: z.uuid().parse(field(f, "offer_id")),
      channel_value: channel, asset_value: asset,
      amount_units_value: decimalToAtomic(field(f, "amount"), channel === "telegram_stars" ? 0 : 6),
      idempotency_key_value: z.uuid().parse(field(f, "request_id")),
    });
    if (error) throw new Error("TEST_INVOICE_REJECTED");
    invoiceId = z.uuid().parse(data);
  } catch { redirect("/admin/payments?error=invoice"); }
  revalidatePath("/admin/payments"); redirect("/admin/payments/" + invoiceId);
}
export async function simulatePayment(f: FormData) {
  const c = await requireAdminCapability("payments.test");
  const id = z.uuid().parse(field(f, "invoice_id")), db = await createSupabaseServerClient();
  try {
    const { data, error } = await db.rpc("admin_simulate_test_payment", {
      target_tenant_id: c.tenantId, target_invoice_id: id,
      scenario_value: z.enum(["pending", "settled", "insufficient_confirmations", "underpaid", "overpaid", "wrong_asset", "wrong_network", "wrong_recipient", "failed", "refunded", "reorg", "late"]).parse(field(f, "scenario")),
      request_key_value: z.uuid().parse(field(f, "request_id")),
    });
    if (error) throw new Error("SIMULATION_REJECTED");
    await reconcileTestPayment(id, z.uuid().parse(data), c.tenantId);
  } catch { redirect("/admin/payments/" + id + "?error=simulation"); }
  revalidatePath("/admin/payments"); redirect("/admin/payments/" + id);
}
export async function reconcilePayment(f: FormData) {
  const c = await requireAdminCapability("payments.test"), id = z.uuid().parse(field(f, "invoice_id")), db = await createSupabaseServerClient();
  try {
    const { data, error } = await db.rpc("admin_request_test_reconciliation", { target_tenant_id: c.tenantId, target_invoice_id: id, request_key_value: randomUUID() });
    if (error || !data) throw new Error("NO_PROVIDER_EVIDENCE");
    await reconcileTestPayment(id, z.uuid().parse(data), c.tenantId);
  } catch { redirect("/admin/payments/" + id + "?error=reconciliation"); }
  revalidatePath("/admin/payments"); redirect("/admin/payments/" + id);
}
