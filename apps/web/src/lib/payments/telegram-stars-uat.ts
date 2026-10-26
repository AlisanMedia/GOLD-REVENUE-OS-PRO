import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { financialSha256, financialTupleHash, canonicalFinancialJson } from "../../../../../packages/domain/src/financial-source-canonical";
import {
  STARS_UAT_ENVIRONMENT, telegramStarsUatInvoiceSchema, prepareTelegramStarsUatInvoice, parseTelegramStarsUatUpdate, parseTelegramStarsTestJson,
  parseTelegramStarsUatLedger, assessTelegramStarsUatEvidence,
  type TelegramStarsUatInvoice, type StarsUatUpdate, type StarsUatLedgerRead, type StarsUatHistory, type StarsUatAssessment,
} from "../../../../../packages/domain/src/telegram-stars-uat";

const numericId = z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(v => Number.isSafeInteger(Number(v)));
const operation = z.enum(["getMe", "sendInvoice", "answerPreCheckoutQuery", "getStarTransactions", "refundStarPayment", "getChat", "getChatMember", "createChatInviteLink", "revokeChatInviteLink", "approveChatJoinRequest", "banChatMember", "sendMessage"]);
type Operation = z.infer<typeof operation>;
const authoritySchema = z.strictObject({
  version: z.literal(1), scope: z.literal("TELEGRAM_STARS_PRIVATE_BETA_TEST"), environment: z.literal(STARS_UAT_ENVIRONMENT),
  program_id: z.uuid(), tenant_id: z.uuid(), bot_user_id: numericId, authority_record_id: z.uuid(), binding_revision: z.number().int().positive(),
  release_sha: z.string().regex(/^[a-f0-9]{40}$/u), expires_at: z.iso.datetime({ offset: true }),
  permitted_payers: z.array(numericId).max(12), revocable_payers: z.array(numericId).max(12).default([]), approved_test_amount_units: z.string().regex(/^[1-9][0-9]{0,15}$/u).nullable(),
  test_channel_id: z.string().regex(/^-[1-9][0-9]{0,15}$/u).nullable().default(null), allowed_operations: z.array(operation).min(1).max(12),
}).refine(v => v.permitted_payers.length + v.revocable_payers.length > 0);
const accessLease = z.strictObject({ version: z.literal(1), program_id: z.uuid(), tenant_id: z.uuid(), job_id: z.uuid(), lease_token: z.uuid(), operation: z.enum(["invite", "join", "revoke", "reconcile"]), revision: z.number().int().positive(),
  payer_user_id: numericId, channel_id: z.string().regex(/^-[1-9][0-9]{0,15}$/u), invite_reference: z.string().regex(/^https:\/\/t\.me\/\+[A-Za-z0-9_-]{1,200}$/u).nullable(), invite_expires_at: z.iso.datetime({ offset: true }), subscription_active: z.boolean() });

export interface StarsUatAttemptCustody {
  /** COMMITTED server-owned reservation+dispatch fencing. Deny replay, unresolved effects and exhausted limits across processes/restarts. */
  reserve(input: { program_id: string; tenant_id: string; binding_revision: number; operation: Operation; request_key: string; effect_key: string; request_hash: string }): Promise<{ attempt_id: string; dispatch: boolean }>;
  record(input: { attempt_id: string; state: "ACKNOWLEDGED" | "REJECTED" | "UNKNOWN"; provider_status: number; response_hash: string | null; financial_authority: "NONE" }): Promise<void>;
}
export interface StarsUatVerifiedUpdate { readonly kind: "AUTHENTICATED_STARS_TEST_UPDATE" }
export interface StarsUatVerifiedLedger { readonly kind: "AUTHENTICATED_STARS_TEST_LEDGER" }
export interface StarsUatVerifiedPayment { readonly kind: "CORROBORATED_STARS_TEST_PAYMENT" }
type Result<T> = { state: "ACKNOWLEDGED"; value: T } | { state: "BLOCKED" | "REJECTED" | "UNKNOWN"; reason: string };

/** No default fetch, environment loader, arbitrary host, public route or genuine payment writer.
 * readAuthenticatedBinding MUST read the existing authenticated, MFA/owner-reviewed server authority and current tester consent.
 * A JSON authority record by itself is not authenticated. A durable custody implementation is mandatory; local maps are only extra fencing.
 */
export async function connectTelegramStarsUat(deps: {
  readAuthenticatedBinding: () => Promise<unknown>;
  readProtectedCredential: () => Promise<{ bot_token: string; webhook_secret: string }>;
  custody: StarsUatAttemptCustody;
  transport: typeof fetch;
  readTestHistory?: (invoiceId: string) => Promise<readonly StarsUatHistory[]>;
  recordTestEvidence?: (input: { invoice_id: string; event: StarsUatUpdate; ledger: StarsUatLedgerRead; ledger_attempt_id: string }) => Promise<unknown>;
  claimTestAccess?: () => Promise<unknown>;
  recordTestAccess?: (input: { job_id: string; lease_token: string; outcome: { origin: "TELEGRAM_DEDICATED_TEST"; status: "INVITED" | "MEMBER" | "REVOKED" | "REVIEW" | "UNKNOWN"; primary_attempt_id: string | null; verification_attempt_id: string | null; invite_reference: string | null; expires_at: string | null; membership: string | null } }) => Promise<unknown>;
  recordTestJoinRequest?: (input: { user_id: string; channel_id: string; invite_hash: string; source_hash: string; source_time: string }) => Promise<unknown>;
  now?: () => number;
  signal?: AbortSignal;
}, connectionRequestKey: string) {
  const now = deps.now ?? Date.now;
  let initial: z.infer<typeof authoritySchema>, credentials: { bot_token: string; webhook_secret: string };
  try {
    initial = authoritySchema.parse(await deps.readAuthenticatedBinding());
    if (!Number.isFinite(now()) || Date.parse(initial.expires_at) <= now() || !initial.allowed_operations.includes("getMe")) throw Error();
    credentials = await deps.readProtectedCredential();
    if (!/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,200}$/u.test(credentials.bot_token) || credentials.bot_token.split(":")[0] !== initial.bot_user_id
      || !/^[A-Za-z0-9_-]{32,256}$/u.test(credentials.webhook_secret)) throw Error();
  } catch { return { state: "BLOCKED" as const, reason: "STARS_TEST_SERVER_AUTHORITY_UNAVAILABLE" }; }
  const bindingHash = financialSha256(canonicalFinancialJson(initial));
  const used = new Set<string>(), updates = new WeakMap<object, { event: StarsUatUpdate; receivedAt: number }>(), ledgers = new WeakMap<object, { read: StarsUatLedgerRead; attemptId: string }>(), payments = new WeakMap<object, { invoice: TelegramStarsUatInvoice; event: StarsUatUpdate }>();
  let uncertainMutation = false;
  const hash = (v: string) => createHash("sha256").update(v, "utf8").digest();
  const binding = async (method: Operation, payer?: string, repair = false) => {
    const current = authoritySchema.parse(await deps.readAuthenticatedBinding());
    if (!Number.isFinite(now()) || financialSha256(canonicalFinancialJson(current)) !== bindingHash || Date.parse(current.expires_at) <= now() || !current.allowed_operations.includes(method)
      || payer && !(repair ? [...current.revocable_payers, ...current.permitted_payers] : current.permitted_payers).includes(payer) || deps.signal?.aborted) throw Error("binding");
    return current;
  };
  const request = async (method: Operation, body: Record<string, unknown>, key: string, validate: (value: unknown, raw: string) => unknown, payer?: string, effectIdentity = key, repair = false): Promise<Result<{ result: unknown; attempt_id: string }>> => {
    const mutation = !["getMe", "getStarTransactions", "getChat", "getChatMember"].includes(method);
    let attempt: string;
    try {
      operation.parse(method); await binding(method, payer, repair);
      if (uncertainMutation && mutation || !/^[A-Za-z0-9:_-]{1,120}$/u.test(key) || used.has(key)) throw Error();
      used.add(key);
      const reserved = await deps.custody.reserve({ program_id: initial.program_id, tenant_id: initial.tenant_id, binding_revision: initial.binding_revision,
        operation: method, request_key: key, effect_key: financialTupleHash("telegram-stars-test-dispatch", [initial.program_id, initial.bot_user_id, method, effectIdentity]),
        request_hash: financialSha256(canonicalFinancialJson({ version: 1, environment: STARS_UAT_ENVIRONMENT, method, body, binding_hash: bindingHash })) });
      attempt = z.uuid().parse(reserved.attempt_id); if (!reserved.dispatch) throw Error();
    } catch { return { state: "BLOCKED", reason: "STARS_TEST_DISPATCH_DENIED" }; }
    let state: "ACKNOWLEDGED" | "REJECTED" | "UNKNOWN" = "UNKNOWN", providerStatus = 0, responseHash: string | null = null, result: unknown;
    const controller = new AbortController();
    const signal = deps.signal ? AbortSignal.any([controller.signal, deps.signal]) : controller.signal;
    let rejectDeadline: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = () => { controller.abort(); reject(Error("deadline")); }; });
    const timer = setTimeout(() => rejectDeadline?.(), 10000);
    try {
      const execute = async () => {
        const response = await deps.transport(`https://api.telegram.org/bot${credentials.bot_token}/test/${method}`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(body), cache: "no-store", redirect: "error", signal });
        providerStatus = response.status;
        if (response.redirected || !response.body) throw Error();
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 16384) throw Error(); chunks.push(part.value); }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        responseHash = financialSha256(raw); const parsed = parseTelegramStarsTestJson(raw);
        const envelope = z.object({ ok: z.boolean(), result: z.unknown().optional(), error_code: z.number().int().optional() }).parse(parsed);
        if (response.status >= 200 && response.status < 300 && envelope.ok === true && envelope.result !== undefined) {
          result = validate(envelope.result, raw); state = "ACKNOWLEDGED";
        } else if (response.status >= 400 && response.status < 500 && response.status !== 408 && envelope.ok === false && envelope.error_code === response.status) state = "REJECTED";
      };
      await Promise.race([execute(), deadline]);
    } catch { state = "UNKNOWN"; }
    finally { clearTimeout(timer); controller.abort(); }
    try { await deps.custody.record({ attempt_id: attempt, state, provider_status: providerStatus, response_hash: responseHash, financial_authority: "NONE" }); }
    catch { state = "UNKNOWN"; }
    if (state === "UNKNOWN") { if (mutation) uncertainMutation = true; return { state, reason: "STARS_TEST_RESULT_UNKNOWN_RECONCILE_REQUIRED" }; }
    if (state === "REJECTED") return { state, reason: "STARS_TEST_PROVIDER_REJECTED_NO_AUTOMATIC_RETRY" };
    return { state: "ACKNOWLEDGED", value: { result, attempt_id: attempt } };
  };
  const connected = await request("getMe", {}, connectionRequestKey, value => {
    const me = z.object({ id: z.number().int().positive().safe(), is_bot: z.literal(true) }).parse(value);
    if (String(me.id) !== initial.bot_user_id) throw Error();
    return { bot_user_id: String(me.id) };
  });
  if (connected.state !== "ACKNOWLEDGED") return connected;
  const invoice = (raw: unknown, repair = false) => {
    const value = telegramStarsUatInvoiceSchema.parse(raw);
    if (value.program_id !== initial.program_id || value.tenant_id !== initial.tenant_id || value.bot_user_id !== initial.bot_user_id
      || initial.approved_test_amount_units === null || value.amount_units !== initial.approved_test_amount_units || !(repair ? [...initial.revocable_payers, ...initial.permitted_payers] : initial.permitted_payers).includes(value.payer_user_id)) throw Error();
    return value;
  };
  return { state: "CONNECTED_TO_DEDICATED_TEST" as const, environment: STARS_UAT_ENVIRONMENT, bot_user_id: initial.bot_user_id, financial_authority: "NONE" as const,
    async sendInvoice(raw: unknown, key: string): Promise<Result<{ provider_message_id: string }>> {
      let value: TelegramStarsUatInvoice;
      try {
        value = invoice(raw); prepareTelegramStarsUatInvoice(value, now());
      } catch { return { state: "BLOCKED", reason: "STARS_TEST_INVOICE_NOT_AUTHORIZED" }; }
      const sent = await request("sendInvoice", prepareTelegramStarsUatInvoice(value, now()), key, result => {
        const r = z.object({ message_id: z.number().int().positive().safe(), chat: z.object({ id: z.number().int().positive().safe(), type: z.literal("private") }),
          invoice: z.object({ currency: z.literal("XTR"), total_amount: z.number().int().positive().safe() }) }).parse(result);
        if (String(r.chat.id) !== value.payer_user_id || String(r.invoice.total_amount) !== value.amount_units) throw Error();
        return { provider_message_id: String(r.message_id) };
      }, value.payer_user_id, value.invoice_id);
      if (sent.state !== "ACKNOWLEDGED") return sent;
      return { state: "ACKNOWLEDGED", value: z.object({ provider_message_id: z.string() }).parse(sent.value.result) };
    },
    authenticateWebhook(raw: string, secretHeader: string | null, expected: unknown): StarsUatVerifiedUpdate {
      try {
        if (!secretHeader || !timingSafeEqual(hash(secretHeader), hash(credentials.webhook_secret))) throw Error();
        const event = parseTelegramStarsUatUpdate(raw, telegramStarsUatInvoiceSchema.parse(expected), now());invoice(expected, event.kind === "REFUND");
        const cap = Object.freeze({ kind: "AUTHENTICATED_STARS_TEST_UPDATE" as const }); updates.set(cap, { event, receivedAt: now() }); return cap;
      } catch { throw Error("STARS_TEST_WEBHOOK_AUTH_OR_BINDING_INVALID"); }
    },
    readUpdate(cap: StarsUatVerifiedUpdate): StarsUatUpdate {
      const value = updates.get(cap); if (!value) throw Error("STARS_TEST_UPDATE_CAPABILITY_DENIED"); return value.event;
    },
    async answerPreCheckout(raw: unknown, cap: StarsUatVerifiedUpdate, key: string): Promise<Result<{ accepted_for_test_checkout_only: true }>> {
      try {
        const value = invoice(raw), accepted = updates.get(cap), event = accepted?.event;
        if (!event || !accepted || now() - accepted.receivedAt >= 9000 || now() < accepted.receivedAt || event.kind !== "PRE_CHECKOUT" || event.invoice_id !== value.invoice_id || !event.query_id || Date.parse(value.expires_at) <= now()) throw Error();
        const result = await request("answerPreCheckoutQuery", { pre_checkout_query_id: event.query_id, ok: true }, key, value => z.literal(true).parse(value), value.payer_user_id, event.query_id);
        if (result.state !== "ACKNOWLEDGED") return result;
        return { state: "ACKNOWLEDGED", value: { accepted_for_test_checkout_only: true } };
      } catch { return { state: "BLOCKED", reason: "STARS_TEST_PRECHECKOUT_DENIED" }; }
    },
    async readLedger(offset: number, limit: number, key: string): Promise<Result<StarsUatVerifiedLedger>> {
      if (!Number.isInteger(offset) || offset < 0 || offset > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 25) return { state: "BLOCKED", reason: "STARS_TEST_LEDGER_BOUNDS" };
      const read = await request("getStarTransactions", { offset, limit }, key, (_, raw) => parseTelegramStarsUatLedger(raw, initial.bot_user_id, offset, limit, new Date(now()).toISOString()));
      if (read.state !== "ACKNOWLEDGED") return read;
      try {
        const value = read.value.result as StarsUatLedgerRead;
        const cap = Object.freeze({ kind: "AUTHENTICATED_STARS_TEST_LEDGER" as const }); ledgers.set(cap, { read: value, attemptId: read.value.attempt_id }); return { state: "ACKNOWLEDGED", value: cap };
      } catch { return { state: "UNKNOWN", reason: "STARS_TEST_LEDGER_UNVERIFIABLE" }; }
    },
    assess(raw: unknown, eventCap: StarsUatVerifiedUpdate, ledgerCap: StarsUatVerifiedLedger, history: readonly StarsUatHistory[]): { assessment: StarsUatAssessment; payment: StarsUatVerifiedPayment | null } {
      const event = updates.get(eventCap)?.event, value = invoice(raw, event?.kind === "REFUND"), ledger = ledgers.get(ledgerCap)?.read;
      if (!event || !ledger) throw Error("STARS_TEST_EVIDENCE_CAPABILITY_DENIED");
      const assessment = assessTelegramStarsUatEvidence(value, event, ledger, history, now());
      let cap: StarsUatVerifiedPayment | null = null;
      if (assessment.state === "CORROBORATED_TEST_FACTS" && event.kind === "PAYMENT") { cap = Object.freeze({ kind: "CORROBORATED_STARS_TEST_PAYMENT" as const }); payments.set(cap, { invoice: value, event }); }
      return { assessment, payment: cap };
    },
    async recordTestEvidence(raw: unknown, eventCap: StarsUatVerifiedUpdate, ledgerCap: StarsUatVerifiedLedger): Promise<Result<{ receipt_id: string; subscription_id: string | null; replay: boolean }>> {
      try {
        const event = updates.get(eventCap)?.event, value = invoice(raw, event?.kind === "REFUND"), proof = ledgers.get(ledgerCap);
        if (!event || !proof || !deps.readTestHistory || !deps.recordTestEvidence) throw Error();
        await binding("getStarTransactions", value.payer_user_id, event.kind === "REFUND");
        const assessment = assessTelegramStarsUatEvidence(value, event, proof.read, await deps.readTestHistory(value.invoice_id), now());
        if (assessment.state !== "CORROBORATED_TEST_FACTS") return { state: "BLOCKED", reason: "STARS_TEST_RECEIPT_EVIDENCE_INCOMPLETE" };
        const recorded = z.strictObject({ recorded: z.literal(true), replay: z.boolean(), receipt_id: z.uuid(), subscription_id: z.uuid().nullable(), mode: z.literal("test"), origin: z.literal(STARS_UAT_ENVIRONMENT), financial_authority: z.literal("NONE") }).parse(
          await deps.recordTestEvidence({ invoice_id: value.invoice_id, event, ledger: proof.read, ledger_attempt_id: proof.attemptId }));
        return { state: "ACKNOWLEDGED", value: { receipt_id: recorded.receipt_id, subscription_id: recorded.subscription_id, replay: recorded.replay } };
      } catch { return { state: "BLOCKED", reason: "STARS_TEST_RECEIPT_STORE_UNAVAILABLE" }; }
    },
    async refund(cap: StarsUatVerifiedPayment, key: string): Promise<Result<{ refund_request_acknowledged_only: true }>> {
      const original = payments.get(cap);
      if (!original?.event.charge_id) return { state: "BLOCKED", reason: "STARS_TEST_ORIGINAL_PAYMENT_REQUIRED" };
      const result = await request("refundStarPayment", { user_id: Number(original.invoice.payer_user_id), telegram_payment_charge_id: original.event.charge_id }, key, value => z.literal(true).parse(value), original.invoice.payer_user_id, original.event.charge_id);
      if (result.state !== "ACKNOWLEDGED") return result;
      return { state: "ACKNOWLEDGED", value: { refund_request_acknowledged_only: true } };
    },
    async processNextTestAccess(keyPrefix: string): Promise<Result<{ status: string; test_invite_notification: string | null }>> {
      let job: z.infer<typeof accessLease> | null = null;
      const outcome = { origin: STARS_UAT_ENVIRONMENT, status: "UNKNOWN" as "INVITED" | "MEMBER" | "REVOKED" | "REVIEW" | "UNKNOWN", primary_attempt_id: null as string | null, verification_attempt_id: null as string | null, invite_reference: null as string | null, expires_at: null as string | null, membership: null as string | null };
      try {
        if (!initial.test_channel_id || !deps.claimTestAccess || !deps.recordTestAccess || !/^[A-Za-z0-9:_-]{1,40}$/u.test(keyPrefix)) throw Error();
        await binding("getChat");
        const claimed = z.object({ job: accessLease.nullable() }).parse(await deps.claimTestAccess());
        if (!claimed.job) return { state: "ACKNOWLEDGED", value: { status: "NO_READY_TEST_JOB", test_invite_notification: null } };
        job = claimed.job;
        if (job.program_id !== initial.program_id || job.tenant_id !== initial.tenant_id || job.channel_id !== initial.test_channel_id || job.operation !== "revoke" && !initial.permitted_payers.includes(job.payer_user_id)
          || job.operation === "revoke" && !initial.revocable_payers.includes(job.payer_user_id)) throw Error();
        const j = job, repair = j.operation === "revoke", key = (suffix: string) => keyPrefix + ":" + j.job_id + ":" + suffix;
        const call = async (method: Operation, body: Record<string, unknown>, suffix: string, validate: (value: unknown) => unknown, identity = j.job_id, payer?: string) => {
          const r = await request(method, body, key(suffix), validate, payer, identity, repair); if (r.state !== "ACKNOWLEDGED") throw Error(); return r.value;
        };
        await call("getChat", { chat_id: j.channel_id }, "chat", value => { const c = z.object({ id: z.number().int().safe(), type: z.literal("channel"), username: z.never().optional() }).parse(value); if (String(c.id) !== j.channel_id) throw Error(); return true; }, j.job_id + ":chat");
        await call("getChatMember", { chat_id: j.channel_id, user_id: Number(initial.bot_user_id) }, "bot", value => {
          const b = z.object({ status: z.literal("administrator"), user: z.object({ id: z.number().int().positive().safe(), is_bot: z.literal(true) }), can_invite_users: z.literal(true), can_restrict_members: z.literal(true) }).parse(value);
          if (String(b.user.id) !== initial.bot_user_id) throw Error(); return true;
        }, j.job_id + ":bot");
        const member = async () => {
          const r = await call("getChatMember", { chat_id: j.channel_id, user_id: Number(j.payer_user_id) }, "member", value => {
            const m = z.object({ status: z.enum(["member", "left", "kicked"]), user: z.object({ id: z.number().int().positive().safe(), is_bot: z.literal(false) }) }).parse(value);
            if (String(m.user.id) !== j.payer_user_id) throw Error(); return m.status;
          }, j.job_id, j.payer_user_id);
          outcome.verification_attempt_id = r.attempt_id; outcome.membership = z.enum(["member", "left", "kicked"]).parse(r.result); return r;
        };
        if (j.operation === "invite") {
          if (!j.subscription_active) throw Error();
          const expiry = Math.floor(Math.min(Date.parse(j.invite_expires_at), now() + 900000) / 1000); if (expiry <= now() / 1000) throw Error();
          const created = await call("createChatInviteLink", { chat_id: j.channel_id, name: "TEST-" + j.job_id.slice(0, 20), expire_date: expiry, creates_join_request: true }, "invite", value => {
            const link = z.object({ invite_link: z.string().regex(/^https:\/\/t\.me\/\+[A-Za-z0-9_-]{1,200}$/u), expire_date: z.literal(expiry), creates_join_request: z.literal(true), is_primary: z.literal(false), is_revoked: z.literal(false) }).parse(value); return link.invite_link;
          }, j.job_id, j.payer_user_id);
          outcome.primary_attempt_id = created.attempt_id; outcome.invite_reference = z.string().parse(created.result); outcome.expires_at = new Date(expiry * 1000).toISOString(); outcome.status = "INVITED";
        } else if (j.operation === "join") {
          if (!j.subscription_active) throw Error();
          const joined = await call("approveChatJoinRequest", { chat_id: j.channel_id, user_id: Number(j.payer_user_id) }, "join", value => z.literal(true).parse(value), j.job_id, j.payer_user_id);
          outcome.primary_attempt_id = joined.attempt_id; await member(); outcome.status = outcome.membership === "member" ? "MEMBER" : "REVIEW";
        } else if (j.operation === "revoke") {
          if (j.invite_reference) await call("revokeChatInviteLink", { chat_id: j.channel_id, invite_link: j.invite_reference }, "revoke-link", value => { z.object({ is_revoked: z.literal(true) }).parse(value); return true; }, j.job_id, j.payer_user_id);
          const revoked = await call("banChatMember", { chat_id: j.channel_id, user_id: Number(j.payer_user_id) }, "revoke", value => z.literal(true).parse(value), j.job_id, j.payer_user_id);
          outcome.primary_attempt_id = revoked.attempt_id; await member(); if (outcome.membership === "member") throw Error(); outcome.status = "REVOKED";
        } else { const m = await member(); outcome.primary_attempt_id = m.attempt_id; outcome.status = outcome.membership === "member" && j.subscription_active ? "MEMBER" : "REVIEW"; }
        const recorded = z.object({ recorded: z.literal(true), status: z.string(), effect_known: z.literal(true) }).parse(await deps.recordTestAccess({ job_id: j.job_id, lease_token: j.lease_token, outcome }));
        let notification: string | null = null;
        if (recorded.status === "INVITED" && outcome.invite_reference) {
          const r = await request("sendMessage", { chat_id: j.payer_user_id, text: "TEST ONLY membership. No real supplier signals or paid service. Join the dedicated test channel: " + outcome.invite_reference }, key("notice"), value => {
            const m = z.object({ message_id: z.number().int().positive().safe(), chat: z.object({ id: z.number().int().positive().safe(), type: z.literal("private") }) }).parse(value); if (String(m.chat.id) !== j.payer_user_id) throw Error(); return true;
          }, j.payer_user_id, j.job_id);
          notification = r.state;
        }
        return { state: "ACKNOWLEDGED", value: { status: recorded.status, test_invite_notification: notification } };
      } catch {
        if (job && deps.recordTestAccess) { try { await deps.recordTestAccess({ job_id: job.job_id, lease_token: job.lease_token, outcome: { ...outcome, status: "UNKNOWN" } }); } catch { /* Existing durable lease remains reviewable; never blind retry or invent completion. */ } }
        return { state: job ? "UNKNOWN" : "BLOCKED", reason: "STARS_TEST_ACCESS_REVIEW_REQUIRED" };
      }
    },
    async receiveTestJoinRequest(raw: string, secretHeader: string | null): Promise<Result<{ queued: true }>> {
      try {
        if (!deps.recordTestJoinRequest || !initial.test_channel_id || !secretHeader || !timingSafeEqual(hash(secretHeader), hash(credentials.webhook_secret))) throw Error();
        const e = z.object({ update_id: z.number().int().nonnegative().safe(), chat_join_request: z.object({ chat: z.object({ id: z.number().int().safe(), type: z.literal("channel") }), from: z.object({ id: z.number().int().positive().safe(), is_bot: z.literal(false) }), date: z.number().int().positive().safe(), invite_link: z.object({ invite_link: z.string().regex(/^https:\/\/t\.me\/\+[A-Za-z0-9_-]{1,200}$/u), creates_join_request: z.literal(true) }) }) }).parse(parseTelegramStarsTestJson(raw));
        const q = e.chat_join_request, user = String(q.from.id), channel = String(q.chat.id);
        await binding("approveChatJoinRequest", user);
        if (channel !== initial.test_channel_id || q.date * 1000 > now() + 60000 || now() - q.date * 1000 > 300000) throw Error();
        z.object({ queued: z.literal(true) }).parse(await deps.recordTestJoinRequest({ user_id: user, channel_id: channel, invite_hash: financialSha256(q.invite_link.invite_link), source_hash: financialSha256(raw), source_time: new Date(q.date * 1000).toISOString() }));
        return { state: "ACKNOWLEDGED", value: { queued: true } };
      } catch { return { state: "BLOCKED", reason: "STARS_TEST_JOIN_REQUEST_DENIED" }; }
    },
  };
}
