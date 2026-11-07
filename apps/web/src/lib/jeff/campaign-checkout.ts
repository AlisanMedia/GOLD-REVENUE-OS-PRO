import "server-only";
import { z } from "zod";
import type { BackendEvidence } from "@gold-revenue-os/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createStarsCommerce } from "../payments/telegram-stars-commerce";

/** An exact customer command is purchase intent, never payment authority. Ordinary
 * dialogue cannot invoke checkout through model output, tools or guessed intent. */
export async function prepareCampaignCheckoutEvidence(input: {
  tenantId: string; campaignId: string; jobId: string; conversationId: string;
  sourceEventId: string; sourceText: string; boundary: string; language: string;
}): Promise<BackendEvidence[]> {
  if (!/^(?:\/buy|\/subscribe)$/iu.test(input.sourceText.trim())) return [];
  const db = createSupabaseAdminClient();
  const result = await db.rpc("campaign_prepare_purchase_v1", {
    target_tenant_id: input.tenantId, campaign_id_value: input.campaignId,
    job_id_value: input.jobId, source_event_id_value: input.sourceEventId,
  });
  if (result.error) throw Error("CAMPAIGN_PURCHASE_SOURCE_OR_AUTHORITY_BLOCKED");
  const prepared = z.strictObject({ offer_id: z.uuid().nullable() }).parse(result.data);
  if (!prepared.offer_id) return []; // Present the approved price through QA first.
  const commerce = await createStarsCommerce({ tenantId: input.tenantId });
  const purchase = await commerce.preparePurchase(prepared.offer_id, "campaign:" + input.jobId, input.sourceEventId);
  return [{ id: "stars:checkout:" + purchase.invoice_id, tenantId: input.tenantId,
    conversationId: input.conversationId, occurredAt: z.iso.datetime({offset:true}).parse(purchase.observed_at), category: "fact", status: "completed",
    statement: input.language === "tr"
      ? `Telegram Stars ödeme bağlantısı: ${purchase.checkout_url} Ödemeden sonra fatura botuna /vip yaz; ödeme ve VIP erişimi henüz doğrulanmadı.`
      : `Telegram Stars checkout: ${purchase.checkout_url} After payment, send /vip to the invoice bot; payment and VIP access are not yet confirmed.` }];
}
