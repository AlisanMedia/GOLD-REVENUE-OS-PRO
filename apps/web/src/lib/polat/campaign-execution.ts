import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { campaignBusinessScopeSchema } from "@gold-revenue-os/contracts";
import { polatCampaignSourceSchema } from "@gold-revenue-os/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTelegramText } from "../messaging/telegram-adapter";
import { consumePrivateBetaBusinessSendPermit, verifyPrivateBetaBusinessSend } from "./private-beta-business";

export async function campaignRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await createSupabaseAdminClient().rpc(name, args);
  if (result.error) throw Error("CAMPAIGN_DB_UNAVAILABLE");
  return result.data;
}
export async function campaignScope(tenantId: string, conversationId: string) {
  return z.strictObject({ bound: z.boolean(), campaign_id: z.uuid().nullable(), genuine_executor_accepted: z.boolean(), reason: z.string() }).parse(
    await campaignRpc("campaign_runtime_scope_v1", { target_tenant_id: tenantId, target_conversation_id: conversationId }));
}
export async function readCampaignSource(tenantId: string, conversationId: string, eventId: string) {
  return polatCampaignSourceSchema.parse(await campaignRpc("campaign_source_scope_v1", {
    target_tenant_id: tenantId, target_conversation_id: conversationId, target_event_id: eventId,
  }));
}
export async function holdCampaignSource(tenantId: string, campaignId: string, conversationId: string, eventId: string, reason: "MODEL_UNAVAILABLE" | "QA_HELD" | "DELIVERY_UNKNOWN" | "SOURCE_CHANGED") {
  await campaignRpc("campaign_hold_source_v1", { target_tenant_id: tenantId, campaign_id_value: campaignId,
    target_conversation_id: conversationId, target_event_id: eventId, reason_value: reason });
}
export async function campaignTransportScope(tenantId: string, campaignId: string) {
  const scope = campaignBusinessScopeSchema.parse(await campaignRpc("campaign_transport_scope_v1", { target_tenant_id: tenantId, campaign_id_value: campaignId }));
  if (scope.tenant_id !== tenantId || scope.campaign_id !== campaignId || process.env.VERCEL_GIT_COMMIT_SHA !== scope.repository_sha) throw Error("CAMPAIGN_TRANSPORT_SCOPE_DENIED");
  return scope;
}
const claimed = z.strictObject({ dispatch: z.literal(true), message_id: z.uuid(), campaign_id: z.uuid(), bot_id: z.string(),
  chat_id: z.string().regex(/^[1-9][0-9]{0,15}$/u), body: z.string().min(1).max(4096), reply_to_provider_message_id: z.string().nullable(),
  business_connection_id: z.string(), business_generation: z.string() });

// Reuse the accepted one-use fresh Telegram permission probe only. These projected
// names do not create a beta grant or a participant; campaign DB owns recipient authority.
function permissionProbeScope(scope: z.infer<typeof campaignBusinessScopeSchema>, recipient: string) {
  return { version: 2, mode: "BUSINESS", program_id: scope.campaign_id, tenant_id: scope.tenant_id, bot_id: scope.bot_id,
    api_environment: "production", credential_sha256: scope.credential_sha256, repository_sha: scope.repository_sha,
    representative_user_id: scope.representative_user_id, business_connection_id: scope.business_connection_id,
    founder_chat_id: recipient, business_generation: scope.connection_generation, enabled: true, can_reply: true,
    observed_at: scope.observed_at, expires_at: scope.expires_at };
}
export async function dispatchCampaignMessage(tenantId: string, campaignId: string, messageId: string) {
  const scope = await campaignTransportScope(tenantId, campaignId);
  // Read a minimal server-owned target BEFORE a permission probe, claim it only AFTER that probe.
  const target = z.strictObject({ chat_id: z.string().regex(/^[1-9][0-9]{0,15}$/u) }).nullable().parse(await campaignRpc("campaign_reply_target_v1", {
    target_tenant_id: tenantId, campaign_id_value: campaignId, target_message_id: messageId,
  }));
  if (!target) return { status: "blocked" as const, message_id: messageId };
  const key = process.env.POLAT_UAT_TELEGRAM_BOT_TOKEN;
  if (!key || createHash("sha256").update(key).digest("hex") !== scope.credential_sha256 || key.split(":")[0] !== scope.bot_id) throw Error("CAMPAIGN_BOT_CUSTODY_UNVERIFIED");
  let permit;
  try { permit = await verifyPrivateBetaBusinessSend(permissionProbeScope(scope, target.chat_id), key); }
  catch {
    await campaignRpc("campaign_transport_hold_v1", { target_tenant_id: tenantId, campaign_id_value: campaignId, reason_value: "PERMISSION_READ_UNVERIFIED" });
    return { status: "blocked" as const, message_id: messageId };
  }
  const command = z.union([z.strictObject({ dispatch: z.literal(false) }), claimed]).parse(await campaignRpc("campaign_claim_reply_v1", {
    target_tenant_id: tenantId, campaign_id_value: campaignId, target_message_id: messageId,
  }));
  if (!command.dispatch) return { status: "blocked" as const, message_id: messageId };
  const common = { target_tenant_id: tenantId, target_message_id: messageId };
  try {
    if (command.campaign_id !== campaignId || command.message_id !== messageId || command.bot_id !== scope.bot_id) throw Error("scope");
    const current = await campaignTransportScope(tenantId, campaignId);
    consumePrivateBetaBusinessSendPermit(permit, permissionProbeScope(current, target.chat_id), command);
  } catch {
    await campaignRpc("record_outbound_message_result", { ...common, result_value: "blocked", provider_message_id_value: null,
      provider_status_value: 0, error_code_value: "CAMPAIGN_TRANSPORT_GENERATION_CHANGED", retry_after_seconds_value: null });
    return { status: "blocked" as const, message_id: messageId };
  }
  const sent = await sendTelegramText({ botToken: key, chatId: command.chat_id, text: command.body,
    businessConnectionId: command.business_connection_id, replyToProviderMessageId: command.reply_to_provider_message_id });
  const outcome = sent.result;
  const mapped = outcome.kind === "sent" ? { status: "sent", providerId: outcome.providerMessageId, error: null, retry: null }
    : outcome.kind === "retry" ? { status: "retry_scheduled", providerId: null, error: outcome.errorCode, retry: outcome.retryAfterSeconds }
    : outcome.kind === "blocked" ? { status: "blocked", providerId: null, error: outcome.errorCode, retry: null }
    : { status: "failed", providerId: null, error: outcome.errorCode, retry: null };
  await campaignRpc("record_outbound_message_result", { ...common, result_value: mapped.status, provider_message_id_value: mapped.providerId,
    provider_status_value: sent.providerStatus, error_code_value: mapped.error, retry_after_seconds_value: mapped.retry });
  return { status: mapped.error === "TELEGRAM_DELIVERY_UNCERTAIN" ? "unknown" : mapped.status, message_id: messageId };
}
export async function dispatchCampaignProposal(tenantId: string, campaignId: string, proposalId: string) {
  const queued = z.strictObject({ queued: z.boolean(), duplicate: z.boolean(), message_id: z.uuid().optional() }).parse(await campaignRpc("campaign_queue_reply_v1", {
    target_tenant_id: tenantId, campaign_id_value: campaignId, target_proposal_id: proposalId,
  }));
  if (!queued.queued || !queued.message_id) throw Error("CAMPAIGN_REPLY_HELD");
  if (!queued.duplicate) await dispatchCampaignMessage(tenantId, campaignId, queued.message_id);
}

/** Existing authenticated cron and webhook share this bounded, durable executor. */
export async function drainCampaignRecovery(scope?: { tenantId: string; conversationId: string }) {
  const targets = z.array(z.strictObject({ tenant_id: z.uuid(), conversation_id: z.uuid(), campaign_id: z.uuid() })).max(3).parse(await campaignRpc("campaign_recovery_targets_v1", {
    tenant_id_value: scope?.tenantId ?? null, conversation_id_value: scope?.conversationId ?? null,
  }));
  const { runDeterministicWorker } = await import("../agent-runtime/worker");
  let claimed = 0;
  for (const target of targets) {
    const pending = z.strictObject({ message_id: z.uuid().nullable() }).parse(await campaignRpc("campaign_recover_delivery_v1", {
      target_tenant_id: target.tenant_id, campaign_id_value: target.campaign_id, target_conversation_id: target.conversation_id,
    }));
    if (pending.message_id) await dispatchCampaignMessage(target.tenant_id, target.campaign_id, pending.message_id);
    const result = await runDeterministicWorker({ conversation: { tenantId: target.tenant_id, conversationId: target.conversation_id },
      polatCampaign: { campaignId: target.campaign_id }, deploymentRef: process.env.VERCEL_GIT_COMMIT_SHA ?? "unconfigured" });
    claimed += result.tasksClaimed;
  }
  return { conversations: targets.length, tasks_claimed: claimed };
}
