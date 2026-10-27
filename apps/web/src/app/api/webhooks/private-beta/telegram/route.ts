import { after, NextResponse } from "next/server";
import { z } from "zod";
import { polatIntent } from "@gold-revenue-os/domain";
import { authenticatePrivateBetaIngress } from "@/lib/polat/private-beta-webhook";
import { privateBetaBusinessUpdateId } from "@/lib/polat/private-beta-business";
import { queuePrivateBetaNotice, dispatchPrivateBetaMessage, privateBetaRpc, privateBetaTransportScope } from "@/lib/polat/private-beta-runtime";
import { runDeterministicWorker } from "@/lib/agent-runtime/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const participant = z.strictObject({ status: z.enum(["UNINVITED", "NOTICE_REQUIRED", "ACTIVE", "REVOKED", "DELETE_REQUESTED"]), program_id: z.uuid().nullable(), participant_id: z.uuid().nullable(), notice_version: z.string().nullable(), notice_text: z.string().nullable() });
const ingest = z.object({ conversation_id: z.uuid(), message_id: z.uuid(), event_id: z.uuid().nullable().optional(), duplicate: z.boolean() });
const ok = (duplicate = false) => NextResponse.json({ ok: true, duplicate }, { headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  let verified: Awaited<ReturnType<typeof authenticatePrivateBetaIngress>>;
  try {
    verified = await authenticatePrivateBetaIngress(request, { tenantId: process.env.POLAT_UAT_TENANT_ID, programId: process.env.POLAT_UAT_PROGRAM_ID, releaseSha: process.env.POLAT_UAT_RELEASE_SHA, webhookSecret: process.env.POLAT_UAT_TELEGRAM_WEBHOOK_SECRET, relaySecret: process.env.POLAT_UAT_RELAY_SECRET });
  } catch { return NextResponse.json({ error: "PRIVATE_BETA_INGRESS_DENIED" }, { status: 401 }); }
  const { config } = verified;
  try {
    const scope = await privateBetaTransportScope(config.tenantId, config.programId);
    let envelope: Extract<Awaited<ReturnType<typeof authenticatePrivateBetaIngress>>, { kind: "BOT" }>["envelope"];
    let unsupported: boolean, providerUpdateId: string;
    if (verified.kind === "BUSINESS") {
      if (scope.version !== 2) return ok();
      const e = verified.event;
      if (e.connectionId !== scope.business_connection_id || (e.providerChatId !== null && e.providerChatId !== scope.founder_chat_id)
        || (e.kind === "CONNECTION" && e.providerUserId !== scope.representative_user_id)) return ok();
      let kind: "INBOUND" | "HUMAN_REPLY" | "BOT_ECHO" | "EDIT" | "DELETE" | "CONNECTION_DISABLED" | "CONNECTION_OBSERVED";
      if (e.kind === "CONNECTION") kind = e.restrictionObserved ? "CONNECTION_DISABLED" : "CONNECTION_OBSERVED";
      else if (e.kind === "DELETE") kind = "DELETE";
      else if (e.botEcho) kind = "BOT_ECHO";
      else if (e.kind === "EDIT") kind = "EDIT";
      else if (e.providerUserId === scope.representative_user_id) kind = "HUMAN_REPLY";
      else if (e.providerUserId === scope.founder_chat_id && e.providerUserId === e.providerChatId) kind = "INBOUND";
      else return ok();
      const controlResult = z.strictObject({ accepted: z.boolean(), duplicate: z.boolean(), action: z.enum(["INBOUND", "HELD", "IGNORED"]), business_generation: z.string().regex(/^(0|[1-9][0-9]{0,18})$/u) });
      let proceed = false, duplicate = false;
      // Each deletion has a distinct update/message identity; bounded partial
      // processing is replayable rather than losing an interrupted obligation.
      for (const messageId of e.providerMessageIds.length ? e.providerMessageIds : [null]) {
        const saved = controlResult.parse(await privateBetaRpc("private_beta_business_event_v1", { target_tenant_id: config.tenantId, program_id_value: config.programId, event_value: JSON.stringify({
          version: 1, kind, update_id: e.updateId, business_connection_id: e.connectionId, provider_user_id: e.providerUserId, provider_chat_id: e.providerChatId,
          provider_message_id: messageId, source_hash: e.sourceHash, occurred_at: e.occurredAt, content: kind === "HUMAN_REPLY" ? e.envelope?.text ?? null : null,
        }) }));
        duplicate ||= saved.duplicate;
        proceed = saved.accepted && saved.action === "INBOUND" && saved.business_generation === scope.business_generation;
      }
      if (!proceed || kind !== "INBOUND" || !e.envelope) return ok(duplicate);
      envelope = e.envelope; unsupported = e.unsupported;
      providerUpdateId = privateBetaBusinessUpdateId(e.connectionId, e.updateId);
    } else {
      // A BUSINESS program cannot silently accept the same bot's ordinary DMs.
      if (scope.version === 2) return ok();
      envelope = verified.envelope; unsupported = verified.unsupported; providerUpdateId = envelope.updateId;
    }
    const common = { target_tenant_id: config.tenantId, bot_id_value: scope.bot_id, provider_user_id_value: envelope.providerUserId, provider_chat_id_value: envelope.providerChatId };
    const text = envelope.text.trim();
    // Only a matching numeric identity and a committed, one-use invitation can enter.
    const naturalOptOut = polatIntent(text) === "OPT_OUT";
    const control = /^\/(?:start(?:\s+[a-f0-9]{48})?|agree|stop|delete)$/u.test(text) || naturalOptOut;
    const accepted = participant.parse(await privateBetaRpc(control ? "private_beta_invite_accept_v1" : "private_beta_participant_for_chat_v1", { ...common, ...(control ? { command_value: naturalOptOut ? "/stop" : text } : {}) }));
    if (accepted.status === "UNINVITED" || accepted.program_id !== config.programId || !accepted.participant_id) return ok();
    const source = ingest.parse(await privateBetaRpc("ingest_telegram_message", { target_tenant_id: config.tenantId, provider_update_id_value: providerUpdateId, provider_message_id_value: envelope.providerMessageId, provider_chat_id_value: envelope.providerChatId, provider_user_id_value: envelope.providerUserId,
      username_value: null, first_name_value: null, last_name_value: null,
      // Invitation bearer material never enters ordinary message history or model context.
      content_value: /^\/start\s/u.test(text) ? "/start [invitation redacted]" : text,
      reply_to_provider_message_id_value: envelope.replyToProviderMessageId, occurred_at_value: envelope.occurredAt }));
    // Control replay repairs an interrupted queue/bind transaction; delivery is
    // still claimed once. Ordinary duplicate sources already have durable tasks.
    let notice: Parameters<typeof queuePrivateBetaNotice>[0]["kind"] | null = null;
    if (accepted.status === "NOTICE_REQUIRED") notice = "NOTICE";
    else if (text === "/delete" && accepted.status === "DELETE_REQUESTED") notice = "DELETE_REQUESTED";
    else if ((text === "/stop" || naturalOptOut) && accepted.status === "REVOKED") notice = "STOPPED";
    else if (accepted.status === "ACTIVE") {
      await privateBetaRpc("private_beta_bind_conversation_v1", { target_tenant_id: config.tenantId, participant_id_value: accepted.participant_id, target_conversation_id: source.conversation_id });
      await privateBetaRpc("private_beta_track_source_v1", { target_tenant_id: config.tenantId, target_conversation_id: source.conversation_id, source_message_id_value: source.message_id });
      // The common durable source tracker records unsupported input in the
      // existing human-attention workflow, including a crash/replay after bind.
      if (unsupported) return ok(source.duplicate);
      if (source.duplicate && !control && !text.startsWith("/feedback")) return ok(true);
      if (text === "/agree") notice = "AGREED";
      const feedback = /^\/feedback ([1-5]) ([1-5]) ([1-5]) ([1-5])$/u.exec(text);
      if (feedback) {
        await privateBetaRpc("private_beta_feedback_v1", { target_tenant_id: config.tenantId, participant_id_value: accepted.participant_id, source_message_id_value: source.message_id, useful_value: Number(feedback[1]), natural_value: Number(feedback[2]), correct_value: Number(feedback[3]), satisfied_value: Number(feedback[4]) });
        notice = "FEEDBACK_RECORDED";
      }
    }
    const participantId = accepted.participant_id;
    if (notice) {
      // Persist the fixed-body obligation before acknowledging the webhook.
      const messageId = await queuePrivateBetaNotice({ tenantId: config.tenantId, programId: config.programId, participantId, conversationId: source.conversation_id, sourceMessageId: source.message_id, kind: notice });
      if (messageId) after(() => dispatchPrivateBetaMessage(config.tenantId, config.programId, messageId).catch(() => undefined));
    } else if (accepted.status === "ACTIVE" && !text.startsWith("/")) {
      after(async () => { await runDeterministicWorker({ deploymentRef: config.releaseSha, conversation: { tenantId: config.tenantId, conversationId: source.conversation_id }, polatUat: { programId: config.programId } }).catch(() => undefined); });
    }
    return ok(source.duplicate);
  } catch { return NextResponse.json({ error: "PRIVATE_BETA_PROCESSING_UNAVAILABLE" }, { status: 503 }); }
}
