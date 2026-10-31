import { after, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateCampaignIngress } from "@/lib/polat/private-beta-webhook";
import { campaignRpc, campaignTransportScope, drainCampaignRecovery } from "@/lib/polat/campaign-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Dedicated relay-authenticated BUSINESS ingress; no provider/token/target from URL/body. */
export async function POST(request: Request) {
  let verified: Awaited<ReturnType<typeof authenticateCampaignIngress>>;
  try {
    verified = await authenticateCampaignIngress(request, {
      tenantId: process.env.POLAT_CAMPAIGN_TENANT_ID, programId: process.env.POLAT_CAMPAIGN_ID,
      releaseSha: process.env.VERCEL_GIT_COMMIT_SHA, webhookSecret: process.env.POLAT_CAMPAIGN_WEBHOOK_SECRET,
      relaySecret: process.env.POLAT_CAMPAIGN_RELAY_SECRET,
    });
  } catch { return NextResponse.json({ error: "CAMPAIGN_INGRESS_DENIED" }, { status: 401 }); }
  if (verified.kind !== "BUSINESS") return NextResponse.json({ ok: true });
  try {
    const { config, event: e } = verified;
    const scope = await campaignTransportScope(config.tenantId, config.programId);
    if (e.connectionId !== scope.business_connection_id) return NextResponse.json({ ok: true });
    const kind = e.kind === "CONNECTION" ? e.restrictionObserved ? "CONNECTION_DISABLED" : "CONNECTION_OBSERVED"
      : e.kind === "DELETE" ? "DELETE" : e.botEcho ? "BOT_ECHO" : e.kind === "EDIT" ? "EDIT"
      : e.providerUserId === scope.representative_user_id ? "HUMAN_REPLY" : "INBOUND";
    let duplicate = false;
    for (const messageId of e.providerMessageIds.length ? e.providerMessageIds : [null]) {
      const raw = await campaignRpc("campaign_ingest_business_v1", { target_tenant_id: config.tenantId, campaign_id_value: config.programId,
        event_value: JSON.stringify({ kind, update_id: e.updateId, connection_id: e.connectionId, source_hash: e.sourceHash,
          occurred_at: e.occurredAt, user_id: e.providerUserId, chat_id: e.providerChatId, message_id: messageId,
          text: e.envelope?.text ?? null, reply_to_id: e.envelope?.replyToProviderMessageId ?? null }) });
      const result = z.object({ accepted: z.boolean(), duplicate: z.boolean(), conversation_id: z.uuid().optional() }).parse(raw);
      duplicate ||= result.duplicate;
      if (result.accepted && result.conversation_id && kind === "INBOUND" && !e.unsupported) {
        const conversationId = result.conversation_id;
        // Duplicate callback can repair an interrupted wakeup; DB claims prevent another effect.
        after(() => drainCampaignRecovery({ tenantId: config.tenantId, conversationId }).catch(() => undefined));
      }
    }
    return NextResponse.json({ ok: true, duplicate }, { headers: { "cache-control": "no-store" } });
  } catch { return NextResponse.json({ error: "CAMPAIGN_PROCESSING_UNAVAILABLE" }, { status: 503 }); }
}
