import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTelegramText } from "../messaging/telegram-adapter";

export const privateBetaSourceSchema = z.strictObject({ program_id: z.uuid(), participant_id: z.uuid(), tenant_id: z.uuid(), conversation_id: z.uuid(), source_message_id: z.uuid(), revision: z.number().int().positive(), boundary: z.iso.datetime({ offset: true }) });
export type PrivateBetaSource = z.infer<typeof privateBetaSourceSchema>;
export async function privateBetaRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await createSupabaseAdminClient().rpc(name, args);
  if (error) throw Error("PRIVATE_BETA_DB_UNAVAILABLE");
  return data;
}
export async function readPrivateBetaSource(tenantId: string, conversationId: string, eventId: string) {
  return privateBetaSourceSchema.parse(await privateBetaRpc("private_beta_source_scope_v1", { target_tenant_id: tenantId, target_conversation_id: conversationId, target_event_id: eventId }));
}
const conversationScope = z.object({ program_id: z.uuid(), participant_id: z.uuid(), tenant_id: z.uuid(), conversation_id: z.uuid(), stage: z.enum(["DRAFT", "CANARY", "FOUNDER", "FRIENDS", "STOPPED"]), participation: z.enum(["PENDING_NOTICE", "ACTIVE", "REVOKED"]), ownership: z.enum(["AI_ACTIVE", "HUMAN_TAKEOVER", "PAUSED"]), generation: z.string(), window_active: z.boolean(), bot_id: z.string().nullable(), provider_user_id: z.string(), provider_chat_id: z.string(), kind: z.enum(["FOUNDER", "FRIEND"]), maximum_requests: z.number().int(), request_count: z.number().int(), last_inbound_id: z.uuid().nullable(), financial_authority: z.literal("NONE") }).strict();
export async function privateBetaConversation(tenantId: string, conversationId: string) {
  const raw = await privateBetaRpc("private_beta_conversation_scope_v1", { target_tenant_id: tenantId, target_conversation_id: conversationId });
  return raw === null ? null : conversationScope.parse(raw);
}
const transportConfig = z.strictObject({ version: z.literal(1), program_id: z.uuid(), tenant_id: z.uuid(), bot_id: z.string().regex(/^[1-9][0-9]{0,18}$/u), api_environment: z.literal("production"), credential_sha256: z.string().regex(/^[a-f0-9]{64}$/u), repository_sha: z.string().regex(/^[a-f0-9]{40}$/u) });
export async function privateBetaTransportScope(tenantId: string, programId: string) {
  const scope = transportConfig.parse(await privateBetaRpc("private_beta_transport_config_v1", { target_tenant_id: tenantId, program_id_value: programId }));
  if (scope.tenant_id !== tenantId || scope.program_id !== programId) throw Error("PRIVATE_BETA_BOT_SCOPE_DENIED");
  if (process.env.POLAT_UAT_RELEASE_SHA !== scope.repository_sha || process.env.VERCEL_GIT_COMMIT_SHA !== undefined && process.env.VERCEL_GIT_COMMIT_SHA !== scope.repository_sha) throw Error("PRIVATE_BETA_RELEASE_SCOPE_DENIED");
  return scope;
}
async function privateBetaBot(tenantId: string, programId: string) {
  const scope = await privateBetaTransportScope(tenantId, programId);
  const key = process.env.POLAT_UAT_TELEGRAM_BOT_TOKEN;
  if (!key || createHash("sha256").update(key, "utf8").digest("hex") !== scope.credential_sha256 || key.split(":")[0] !== scope.bot_id) throw Error("PRIVATE_BETA_BOT_CREDENTIAL_UNVERIFIED");
  return { scope, key };
}
const claim = z.discriminatedUnion("dispatch", [z.strictObject({ dispatch: z.literal(false) }), z.strictObject({ dispatch: z.literal(true), message_id: z.uuid(), program_id: z.uuid(), bot_id: z.string(), chat_id: z.string().regex(/^[1-9][0-9]{0,18}$/u), body: z.string().min(1).max(4096), reply_to_provider_message_id: z.string().nullable() })]);
export async function dispatchPrivateBetaMessage(tenantId: string, programId: string, messageId: string) {
  const bot = await privateBetaBot(tenantId, programId);
  const prepared = claim.parse(await privateBetaRpc("private_beta_claim_reply_v1", { target_tenant_id: tenantId, target_message_id: messageId }));
  if (!prepared.dispatch) return { status: "blocked" as const, message_id: messageId };
  if (prepared.program_id !== programId || prepared.bot_id !== bot.scope.bot_id || prepared.message_id !== messageId) throw Error("PRIVATE_BETA_DISPATCH_SCOPE_DENIED");
  const provider = await sendTelegramText({ botToken: bot.key, chatId: prepared.chat_id, text: prepared.body, replyToProviderMessageId: prepared.reply_to_provider_message_id });
  const result = provider.result;
  const mapped = result.kind === "sent" ? { result: "sent", providerId: result.providerMessageId, error: null, retryAfter: null }
    : result.kind === "retry" ? { result: "retry_scheduled", providerId: null, error: result.errorCode, retryAfter: result.retryAfterSeconds }
    : result.kind === "blocked" ? { result: "blocked", providerId: null, error: result.errorCode, retryAfter: null }
    : { result: "failed", providerId: null, error: result.errorCode, retryAfter: null };
  await privateBetaRpc("record_outbound_message_result", { target_tenant_id: tenantId, target_message_id: messageId, result_value: mapped.result, provider_message_id_value: mapped.providerId, provider_status_value: provider.providerStatus, error_code_value: mapped.error, retry_after_seconds_value: mapped.retryAfter });
  return { status: mapped.error === "TELEGRAM_DELIVERY_UNCERTAIN" ? "unknown" as const : mapped.result, message_id: messageId };
}
export async function dispatchPrivateBetaProposal(tenantId: string, programId: string, proposalId: string) {
  const queued = z.object({ queued: z.boolean(), message_id: z.uuid().optional(), duplicate: z.boolean().optional() }).strict().parse(await privateBetaRpc("private_beta_queue_reply_v1", { target_tenant_id: tenantId, target_proposal_id: proposalId }));
  if (!queued.queued || !queued.message_id) throw Error("PRIVATE_BETA_REPLY_HELD");
  if (queued.duplicate) return;
  await dispatchPrivateBetaMessage(tenantId, programId, queued.message_id);
}

export async function queuePrivateBetaNotice(input: { tenantId: string; programId: string; participantId: string; conversationId: string; sourceMessageId: string; kind: "NOTICE" | "AGREED" | "STOPPED" | "DELETE_REQUESTED" | "FEEDBACK_RECORDED" }) {
  const queued = z.strictObject({ queued: z.boolean(), duplicate: z.boolean().optional(), message_id: z.uuid().optional() }).parse(await privateBetaRpc("private_beta_queue_notice_v1", { target_tenant_id: input.tenantId, program_id_value: input.programId, participant_id_value: input.participantId, target_conversation_id: input.conversationId, source_message_id_value: input.sourceMessageId, kind_value: input.kind }));
  return queued.queued && queued.message_id ? queued.message_id : null;
}
export async function dispatchPrivateBetaNotice(input: Parameters<typeof queuePrivateBetaNotice>[0]) {
  const messageId = await queuePrivateBetaNotice(input);
  if (messageId) await dispatchPrivateBetaMessage(input.tenantId, input.programId, messageId);
}

/** At most one conversation/task and one known-not-sent delivery per recovery cycle. */
export async function drainPrivateBetaRecovery() {
  const tenantId = z.uuid().parse(process.env.POLAT_UAT_TENANT_ID), programId = z.uuid().parse(process.env.POLAT_UAT_PROGRAM_ID);
  const targets = z.array(z.strictObject({ conversation_id: z.uuid() })).max(1).parse(await privateBetaRpc("private_beta_recovery_targets_v1", { target_tenant_id: tenantId, program_id_value: programId }));
  const { runDeterministicWorker } = await import("../agent-runtime/worker");
  let claimed = 0;
  for (const target of targets) {
    const result = await runDeterministicWorker({ deploymentRef: process.env.POLAT_UAT_RELEASE_SHA ?? "unconfigured", conversation: { tenantId, conversationId: target.conversation_id }, polatUat: { programId } });
    claimed += result.tasksClaimed;
    const pending = z.strictObject({ message_id: z.uuid().nullable() }).parse(await privateBetaRpc("private_beta_recover_delivery_v1", { target_tenant_id: tenantId, program_id_value: programId, target_conversation_id: target.conversation_id }));
    if (pending.message_id) await dispatchPrivateBetaMessage(tenantId, programId, pending.message_id);
  }
  return { conversations: targets.length, tasks_claimed: claimed };
}
export async function holdPrivateBetaSource(tenantId: string, conversationId: string, eventId: string, reason: "MODEL_UNAVAILABLE" | "QA_HELD" | "SOURCE_CHANGED" | "DELIVERY_UNKNOWN" | "UNSUPPORTED_INPUT") {
  await privateBetaRpc("private_beta_hold_source_v1", { target_tenant_id: tenantId, target_conversation_id: conversationId, target_event_id: eventId, reason_value: reason });
}
