import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { disposablePolatDatabase, polatSqlClient } from "../helpers/polat-local-database";
import { polatClaudeCompleteEnvelope, polatClaudeFixtureWire } from "../helpers/polat-bridge-fixtures";
import { polatGuardDigest } from "../../packages/domain/src/polat-experiment-journal";
import { preparePolatConversation, assessPolatDraft } from "../../packages/domain/src/polat-conversation";
import { polatFixture } from "../../packages/domain/src/polat-conversation.fixtures";

// Actual native worker, PostgreSQL transactions and delivery-result recorder. Only the
// remote Anthropic socket and Telegram HTTP response are deterministic test doubles.
// Fixture MFA/account/billing observations are NOT genuine provider or human acceptance.
const fake = vi.hoisted(() => ({
  client: null as ReturnType<typeof polatSqlClient> | null,
  workspace: "", bot: "", chat: "", calls: 0, telegramCalls: 0,
  responseSequence: 0, wire: null as unknown, unknownTelegram: false,
  beforeResponse: null as (() => void) | null,
  bodies: [] as Array<Record<string, unknown>>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => {
  if (!fake.client) throw Error("DISPOSABLE_POSTGRES_REQUIRED"); return fake.client;
} }));
vi.mock("@/lib/agent-runtime/context-builder", () => import("../../apps/web/src/lib/agent-runtime/context-builder"));
vi.mock("@/lib/polat/test-runtime", () => import("../../apps/web/src/lib/polat/test-runtime"));
vi.mock("@/lib/polat/private-beta-provider", () => import("../../apps/web/src/lib/polat/private-beta-provider"));
vi.mock("@/lib/polat/private-beta-runtime", () => import("../../apps/web/src/lib/polat/private-beta-runtime"));
vi.mock("@/lib/messaging/telegram-adapter", () => import("../../apps/web/src/lib/messaging/telegram-adapter"));
vi.mock("@/lib/agent-runtime/providers/openai-responses", () => ({ openAIProviderFromEnvironment: () => { throw Error("UNAUTHORIZED_PROVIDER_PROHIBITED"); } }));
vi.mock("@/lib/messaging/outbound-dispatch", () => ({ dispatchQueuedTelegramMessage: () => { throw Error("GENERAL_OUTBOUND_PROHIBITED"); } }));
vi.mock("node:https", () => ({ request: (options: RequestOptions, callback: (r: IncomingMessage) => void) => {
  if (options.hostname !== "api.anthropic.com" || options.path !== "/v1/messages" || options.method !== "POST") throw Error("OFFLINE_FIXED_PROVIDER_BOUNDARY_ONLY");
  const socket = new EventEmitter() as EventEmitter & { end: (body: string) => void; destroy: () => void };
  socket.destroy = () => {};
  socket.end = body => {
    fake.calls++; fake.bodies.push(JSON.parse(body));
    const wire = structuredClone(fake.wire ?? polatClaudeFixtureWire());
    const sequence = ++fake.responseSequence, before = fake.beforeResponse; fake.beforeResponse = null;
    queueMicrotask(() => {
      before?.();
      const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void };
      response.statusCode = 200; response.headers = { "content-type": "application/json", "anthropic-workspace-id": fake.workspace, "request-id": "req_native_fixture_" + sequence }; response.resume = () => {};
      callback(response as unknown as IncomingMessage);
      response.emit("data", Buffer.from(JSON.stringify(polatClaudeCompleteEnvelope({ id: "msg_native_fixture_" + sequence, content: [{ type: "text", text: JSON.stringify(wire), citations: null }] }))));
      response.emit("end");
    });
  };
  return socket as unknown as ClientRequest;
} }));

import { runDeterministicWorker } from "../../apps/web/src/lib/agent-runtime/worker";
import { buildAgentContext } from "../../apps/web/src/lib/agent-runtime/context-builder";
import { createPrivateBetaProviderFromDatabase } from "../../apps/web/src/lib/polat/private-beta-provider";
import { dispatchPrivateBetaMessage, privateBetaSourceSchema } from "../../apps/web/src/lib/polat/private-beta-runtime";

const connection = process.env.POLAT_BETA_RUNTIME_DB_URL;
const quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
const id = (kind: number, n: number) => `92be${kind}000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SHA = "a".repeat(40), MODEL_KEY = "SYNTHETIC_NATIVE_RUNTIME_MODEL_KEY_ONLY";

describe.runIf(Boolean(connection))("private beta actual native runtime with disposable PG17 and offline HTTP", () => {
  let db: ReturnType<typeof disposablePolatDatabase>;
  const createdTenants = new Set<string>();
  const base = Number(process.env.POLAT_BETA_RUNTIME_CASE_SEED ?? "7100");
  beforeAll(() => {
    db = disposablePolatDatabase(connection!); expect(db.query("select to_jsonb(current_setting('server_version_num')::int/10000)")).toBe(17);
    fake.client = polatSqlClient(db);
    vi.stubEnv("POLAT_UAT_RELEASE_SHA", SHA); vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA); vi.stubEnv("POLAT_UAT_ANTHROPIC_API_KEY", MODEL_KEY);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (url !== "https://api.telegram.org/bot" + fake.bot + "/sendMessage" || options?.method !== "POST" || options.redirect !== "error") throw Error("OFFLINE_FIXED_TELEGRAM_BOUNDARY_ONLY");
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      if (body.chat_id !== fake.chat || typeof body.text !== "string") throw Error("OFFLINE_TELEGRAM_SCOPE_DENIED");
      fake.telegramCalls++;
      if (fake.unknownTelegram) throw Error("SYNTHETIC_UNKNOWN_AFTER_POSSIBLE_EFFECT");
      return Response.json({ ok: true, result: { message_id: 1000 + fake.telegramCalls, date: Math.floor(Date.now() / 1000), chat: { id: Number(fake.chat), type: "private" }, text: body.text } });
    }));
  });
  afterAll(() => { for (const tenant of createdTenants) retire({ tenant }); });

  type Scope = { n: number; tenant: string; program: string; owner: string; conversation: string; participant: string; claims: string; account: Record<string, unknown>; pricing: Record<string, unknown> };
  const owner = (s: Pick<Scope, "claims">, expression: string) => db.query(`begin;set local role authenticated;set local request.jwt.claims=${quote(s.claims)};select to_jsonb(${expression});commit;`);
  const service = (expression: string) => db.query(`begin;set local role service_role;select ${expression};commit;`);
  async function setup(n: number): Promise<Scope> {
    const tenant = id(1, n), program = id(2, n), user = id(3, n), now = Date.now();
    const claims = JSON.stringify({ sub: user, aal: "aal2", role: "authenticated", amr: [{ method: "totp", timestamp: Math.floor(now / 1000) }] });
    const config = { repository_sha: SHA, starts_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 3600000).toISOString(), retention_days: 7, notice_version: "polat-private-beta-notice-v1", primary_operator: user, backup_operator: user };
    db.execute(`begin;insert into auth.users(id,email)values('${user}','native-runtime-${n}@example.test');insert into public.tenants(id,name,slug,outbound_messaging_enabled)values('${tenant}','Native runtime synthetic fixture','private-beta-native-${n}',false);insert into public.tenant_members(tenant_id,user_id,role)values('${tenant}','${user}','super_admin');set local role authenticated;set local request.jwt.claims=${quote(claims)};select public.admin_private_beta_create_v1('${tenant}','${program}',${quote(JSON.stringify(config))});commit;`);
    createdTenants.add(tenant);
    const meta = db.query(`select jsonb_build_object('manifest_hash',manifest_hash,'authorization_record_hash',authorization_record_hash)from private.private_beta_programs where id='${program}'`) as { manifest_hash: string; authorization_record_hash: string };
    fake.workspace = "wrkspc_native" + n; fake.bot = `${9700000 + n}:SYNTHETIC_LOCAL_TELEGRAM_KEY_ONLY`; fake.chat = String(8800000 + n);
    fake.calls = 0; fake.telegramCalls = 0; fake.wire = null; fake.bodies = []; fake.beforeResponse = null; fake.unknownTelegram = false;
    vi.stubEnv("POLAT_UAT_TELEGRAM_BOT_TOKEN", fake.bot);
    const accountHash = polatGuardDigest(["ANTHROPIC_WORKSPACE1", fake.workspace]);
    const account = { version: 1, origin: "INDEPENDENT_ACCOUNT_CONTROL", program_id: program, tenant_id: tenant, workspace_id: fake.workspace, account_scope_hash: accountHash, repository_sha: SHA, manifest_hash: meta.manifest_hash, authorization_record_hash: meta.authorization_record_hash, provider: "anthropic", model: "claude-haiku-5-5", model_access: true,
      policy_hash: "e".repeat(64), credential_custody_hash: polatGuardDigest(["POLAT_UAT_CREDENTIAL_CUSTODY1", accountHash, createHash("sha256").update(MODEL_KEY, "utf8").digest("hex")]), region_evidence_hash: "1".repeat(64), retention_evidence_hash: "2".repeat(64), training_evidence_hash: "3".repeat(64), effective_limit_kind: "ENFORCED_EXPERIMENT_HARD_CAP", currency: "USD", enforced_maximum_spend: "5.00", independently_observed_spend: "0", remaining_allowance: "5.00", billing_state: "RECONCILED", billing_evidence_hash: "4".repeat(64), canary_reconciliation_hash: null as string | null, unknown_outcome_count: 0, request_bound: null, observed_at: new Date(now).toISOString(), expires_at: new Date(now + 300000).toISOString() };
    const pricing = { version: 1, origin: "INDEPENDENT_OFFICIAL_PRICING_READ", model: "claude-haiku-5-5", currency: "USD", source_url: "https://platform.claude.com/docs/en/models/haiku-5-5/overview", source_hash: "8".repeat(64), maximum_input_tokens: 1000000, maximum_input_usd_per_million: "0.50", maximum_output_usd_per_million: "2.50", observed_at: new Date(now).toISOString(), expires_at: new Date(now + 3600000).toISOString(), all_billable_components_covered: true };
    db.execute(`select private.private_beta_account_control_record('${tenant}','${program}',${quote(JSON.stringify({ payload: account, pricing }))});select private.private_beta_bot_control_record('${tenant}','${program}',${quote(JSON.stringify({ version: 1, bot_id: fake.bot.split(":")[0], source_hash: "9".repeat(64), observed_at: new Date(now).toISOString(), api_environment: "production", credential_sha256: createHash("sha256").update(fake.bot).digest("hex") }))});`);
    owner({ claims }, `public.admin_private_beta_transition_v1('${tenant}','${program}','CANARY',1)`);
    const input = polatFixture("Hi", "en"), conversation = id(5, n), source = id(6, n);
    input.tenant_id = tenant; input.conversation_id = conversation; input.source_message_id = source; input.boundary = new Date(now).toISOString(); input.messages = input.messages.map(m => ({ ...m, id: source, tenant_id: tenant, conversation_id: conversation, occurred_at: input.boundary }));
    const prepared = preparePolatConversation(input); prepared.request.requestId = id(4, n); prepared.request.timeoutMs = 10000;
    const canary = await createPrivateBetaProviderFromDatabase({ tenantId: tenant, programId: program, scope: "CANARY", assess: (_request, response) => assessPolatDraft(prepared, response.output).action === "SAFE_PREVIEW" ? "APPROVED" : "HELD" });
    await canary.provider.invoke(prepared.request); expect(fake.calls).toBe(1);
    const attempt = db.query(`select jsonb_build_object('attempt',a.id,'request_hash',a.request_hash)from private.polat_experiment_attempts a join private.private_beta_attempt_scope s on s.attempt_id=a.id where s.program_id='${program}'`) as { attempt: string; request_hash: string };
    // The protected billing-control boundary is simulated only in this disposable fixture.
    db.execute(`select private.private_beta_reconcile_attempt('${tenant}','${program}','${attempt.attempt}',${quote(JSON.stringify({ version: 1, origin: "INDEPENDENT_PROVIDER_BILLING", coverage: "COMPLETE_REQUEST_CHARGE", account_scope_hash: accountHash, request_hash: attempt.request_hash, actual_billed_amount: "0.000025", currency: "USD", source_hash: "f".repeat(64), observed_at: new Date().toISOString() }))});`);
    account.canary_reconciliation_hash = "f".repeat(64);
    db.execute(`select private.private_beta_account_control_record('${tenant}','${program}',${quote(JSON.stringify({ payload: account, pricing }))});`);
    owner({ claims }, `public.admin_private_beta_transition_v1('${tenant}','${program}','FOUNDER',2)`);
    owner({ claims }, `public.admin_private_beta_operator_accept_v1('${tenant}','${program}')`);
    const invitation = owner({ claims }, `public.admin_private_beta_invite_v1('${tenant}','${program}','FOUNDER','${id(7, n)}')`) as { code: string };
    const accepted = service(`public.private_beta_invite_accept_v1('${tenant}','${fake.bot.split(":")[0]}','${fake.chat}','${fake.chat}',${quote("/start " + invitation.code)})`) as { status: string; participant_id: string };
    expect(accepted.status).toBe("NOTICE_REQUIRED");
    const initial = service(`public.ingest_telegram_message('${tenant}','native-start-${n}','1','${fake.chat}','${fake.chat}',null,'Synthetic',null,'/start [REDACTED]',null,clock_timestamp())`) as { conversation_id: string; message_id: string };
    const scope: Scope = { n, tenant, program, owner: user, conversation: initial.conversation_id, participant: accepted.participant_id, claims, account, pricing };
    // Fixed-body queue is server-owned; no supplied notice text or consent boolean.
    const notice = service(`public.private_beta_queue_notice_v1('${tenant}','${program}','${accepted.participant_id}','${initial.conversation_id}','${initial.message_id}','NOTICE')`) as { queued: boolean; message_id: string };
    expect(notice.queued).toBe(true);
    expect(service(`public.private_beta_invite_accept_v1('${tenant}','${fake.bot.split(":")[0]}','${fake.chat}','${fake.chat}','/agree')`)).toMatchObject({ status: "NOTICE_REQUIRED" });
    expect(fake.calls).toBe(1); await dispatchPrivateBetaMessage(tenant, program, notice.message_id);
    expect(service(`public.private_beta_invite_accept_v1('${tenant}','${fake.bot.split(":")[0]}','${fake.chat}','${fake.chat}','/agree')`)).toMatchObject({ status: "ACTIVE" });
    expect(service(`public.private_beta_bind_conversation_v1('${tenant}','${accepted.participant_id}','${initial.conversation_id}')`)).toEqual({ bound: true });
    expect(fake.telegramCalls).toBe(1);
    return scope;
  }
  function retire(s: Pick<Scope, "tenant">) {
    db.execute(`do $$begin if exists(select 1 from public.tenants where id='${s.tenant}'and slug like 'private-beta-native-%'and status='active')then update public.tenants set status='suspended'where id='${s.tenant}';insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values('${s.tenant}','SYSTEM','private_beta.fixture_retired','tenants','${s.tenant}','{"mode":"FIXTURE_ONLY","financial_authority":"NONE"}');end if;end;$$;`);
  }
  const inbound = (s: Scope, text: string, number: number) => service(`public.ingest_telegram_message('${s.tenant}','native-inbound-${s.n}-${number}','${number}','${fake.chat}','${fake.chat}',null,'Synthetic',null,${quote(text)},null,clock_timestamp())`) as { event_id: string; message_id: string; conversation_id: string };
  const work = (s: Scope, worker: string) => runDeterministicWorker({ workerId: `private-beta-runtime-${s.n}-${worker}`, conversation: { tenantId: s.tenant, conversationId: s.conversation }, polatUat: { programId: s.program } });
  const aiMessages = (s: Scope) => db.query(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'body',content,'provider_id',provider_message_id,'failure',failure_code)order by created_at,id),'[]')from public.messages where tenant_id='${s.tenant}'and direction='outbound'and actor_id like 'private-beta-ai:%'`) as Array<{ id: string; status: string; body: string; provider_id: string | null; failure: string | null }>;

  it("persists invitation/notice ACK/consent and two native turns through exact QA, fake provider ACK and CRM with no replay", async () => {
    const s = await setup(base + 1); try {
      const first = inbound(s, "Hi", 2);
      expect(await work(s, "first")).toMatchObject({ tasksClaimed: 1, tasksFailed: 0 });
      expect(fake.calls).toBe(2); expect(fake.telegramCalls).toBe(2);
      expect(aiMessages(s)).toEqual([expect.objectContaining({ status: "sent", provider_id: "1002", body: "Hi! I'm Polat's AI assistant. What would you like to know?" })]);
      const wire = polatClaudeFixtureWire(); wire.classification = "ACKNOWLEDGEMENT"; wire.proposed_response = "You're welcome.";
      wire.semantic_response = { response_goal: "Acknowledge the thanks", key_points: ["You're welcome."], factual_grounding: { classification: "unknown", evidence_refs: [], missing_information: ["approved_scoped_fact"] } };
      wire.claims = [{ text: "You're welcome.", kind: "social", speech_act: "ACKNOWLEDGEMENT", capability: null, grounding: "GENERAL_SAFE_STATEMENT", evidence_refs: [], action_category: null }]; fake.wire = wire;
      const second = inbound(s, "Thanks", 3); expect(await work(s, "second")).toMatchObject({ tasksClaimed: 1, tasksFailed: 0 });
      expect(fake.calls).toBe(3); expect(fake.telegramCalls).toBe(3); expect(aiMessages(s).map(m => m.status)).toEqual(["sent", "sent"]);
      const customer = db.query(`select to_jsonb(customer_id)from public.conversations where id='${s.conversation}'`) as string;
      const source = privateBetaSourceSchema.parse(service(`public.private_beta_source_scope_v1('${s.tenant}','${s.conversation}','${second.event_id}')`));
      const built = await buildAgentContext({ tenant_id: s.tenant, customer_id: customer, conversation_id: s.conversation, source_event_id: second.event_id }, { polatPrivateBeta: source });
      expect(built.manifest.private_beta_history_basis).toBe("PROVIDER_ACK_ONLY"); expect(built.context.recentMessages.some(m => m.direction === "outbound" && m.content === "Hi! I'm Polat's AI assistant. What would you like to know?")).toBe(true);
      inbound(s, "Hi", 2); expect(await work(s, "duplicate")).toMatchObject({ tasksClaimed: 0 });
      expect(fake.calls).toBe(3); expect(fake.telegramCalls).toBe(3);
      const admin = owner(s, `public.admin_private_beta_workspace_v1('${s.tenant}')`) as { program: unknown; participants: unknown[]; attempts: unknown[] };
      expect(admin.program).toMatchObject({ global_requests: 3, actual_billed_amount: null, billing_status: "UNKNOWN", stage: "FOUNDER" }); expect(admin.participants).toHaveLength(1); expect(admin.attempts).toHaveLength(3);
      expect(db.query(`select to_jsonb(count(*))from private.verified_payment_receipts where tenant_id='${s.tenant}'`)).toBe(0);
      expect(first.message_id).not.toBe(second.message_id);
    } finally { retire(s); }
  }, 60000);

  it("holds the exact unsafe provider output without a substitute, hidden regeneration or Telegram dispatch", async () => {
    const s = await setup(base + 2); try {
      const wire = polatClaudeFixtureWire(); wire.proposed_response = "Your payment is verified and VIP access is active."; wire.claims = [{ text: wire.proposed_response, kind: "fact", speech_act: "BUSINESS_FACT", capability: null, grounding: "UNKNOWN", evidence_refs: [], action_category: null }]; fake.wire = wire;
      inbound(s, "Hi", 2); await work(s, "unsafe"); expect(fake.calls).toBe(2); expect(fake.telegramCalls).toBe(1); expect(aiMessages(s)).toHaveLength(0);
      expect(db.query(`select to_jsonb(customer_facing_blocked)from public.conversation_quality_evaluations where tenant_id='${s.tenant}'limit 1`)).toBe(true);
      expect(db.query(`select to_jsonb(evidence#>>'{original_output,proposed_response}')from public.quality_stage_evidence where tenant_id='${s.tenant}'limit 1`)).toBe(wire.proposed_response);
      expect(db.query(`select to_jsonb(count(*))from public.escalation_cases where tenant_id='${s.tenant}'and status not in('RESOLVED','CLOSED')`)).toBe(1);
    } finally { retire(s); }
  }, 60000);

  it("fences a model result when an independently authenticated operator takes ownership during generation", async () => {
    const s = await setup(base + 3); try {
      inbound(s, "Hi", 2);
      fake.beforeResponse = () => { owner(s, `public.set_conversation_runtime_mode('${s.tenant}','${s.conversation}','HUMAN_TAKEOVER','Synthetic independent owner takeover','${id(8, s.n)}')`); };
      await work(s, "human-race"); expect(fake.calls).toBe(2); expect(fake.telegramCalls).toBe(1); expect(aiMessages(s)).toHaveLength(0);
      expect(db.query(`select jsonb_build_object('mode',runtime_mode,'human',human_takeover)from public.conversations where id='${s.conversation}'`)).toEqual({ mode: "HUMAN_TAKEOVER", human: true });
      await work(s, "restart"); expect(fake.calls).toBe(2); expect(fake.telegramCalls).toBe(1);
    } finally { retire(s); }
  }, 60000);

  it("invalidates a pending AI reply after numeric-identity opt-out and denies subsequent work", async () => {
    const s = await setup(base + 4); try {
      inbound(s, "Hi", 2); fake.beforeResponse = () => { expect(service(`public.private_beta_invite_accept_v1('${s.tenant}','${fake.bot.split(":")[0]}','${fake.chat}','${fake.chat}','/stop')`)).toMatchObject({ status: "REVOKED" }); };
      await work(s, "opt-out-race"); expect(fake.calls).toBe(2); expect(fake.telegramCalls).toBe(1); expect(aiMessages(s)).toHaveLength(0);
      inbound(s, "Please send more", 3); await work(s, "after-opt-out"); expect(fake.calls).toBe(2); expect(fake.telegramCalls).toBe(1);
      expect(db.query(`select to_jsonb(status)from private.private_beta_participants where id='${s.participant}'`)).toBe("REVOKED");
    } finally { retire(s); }
  }, 60000);

  it("retains uncertain Telegram delivery, excludes it from safe history and never blindly resends after restart", async () => {
    const s = await setup(base + 5); try {
      inbound(s, "Hi", 2); fake.unknownTelegram = true; await work(s, "unknown-send");
      expect(fake.calls).toBe(2); expect(fake.telegramCalls).toBe(2);
      const [message] = aiMessages(s); expect(message).toMatchObject({ provider_id: null, failure: "TELEGRAM_DELIVERY_UNCERTAIN" }); expect(message?.status).not.toBe("sent");
      fake.unknownTelegram = false; expect(await dispatchPrivateBetaMessage(s.tenant, s.program, message!.id)).toMatchObject({ status: "blocked" }); await work(s, "restart");
      expect(fake.calls).toBe(2); expect(fake.telegramCalls).toBe(2);
      inbound(s, "Did you get my message?", 3); await work(s, "uncertain-obligation"); expect(fake.calls).toBe(2); expect(fake.telegramCalls).toBe(2);
      expect(db.query(`select to_jsonb(attention_required)from public.conversations where id='${s.conversation}'`)).toBe(true);
    } finally { retire(s); }
  }, 60000);
});
