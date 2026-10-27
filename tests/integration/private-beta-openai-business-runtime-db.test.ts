import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { disposablePolatDatabase, polatSqlClient } from "../helpers/polat-local-database";
import { polatClaudeFixtureWire } from "../helpers/polat-bridge-fixtures";
import { polatGuardDigest } from "../../packages/domain/src/polat-experiment-journal";
import { preparePolatConversation, assessPolatDraft } from "../../packages/domain/src/polat-conversation";
import { polatFixture } from "../../packages/domain/src/polat-conversation.fixtures";

// One combined native integration: real PG transactions, context, model codec,
// exact-response QA and delivery recorder. HTTPS and Telegram are OFFLINE doubles.
// Simulated account/MFA/billing evidence is never genuine provider acceptance.
const fake = vi.hoisted(() => ({ client: null as ReturnType<typeof polatSqlClient> | null, organization: "", project: "", botKey: "", founder: "", representative: "", business: "", modelCalls: 0, metadataCalls: 0, sends: 0, sequence: 0, wire: null as unknown, bodies: [] as Array<Record<string, unknown>> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => { if (!fake.client) throw Error("DISPOSABLE_POSTGRES_REQUIRED"); return fake.client; } }));
vi.mock("@/lib/agent-runtime/context-builder", () => import("../../apps/web/src/lib/agent-runtime/context-builder"));
vi.mock("@/lib/polat/test-runtime", () => import("../../apps/web/src/lib/polat/test-runtime"));
vi.mock("@/lib/polat/private-beta-provider", () => import("../../apps/web/src/lib/polat/private-beta-provider"));
vi.mock("@/lib/polat/private-beta-runtime", () => import("../../apps/web/src/lib/polat/private-beta-runtime"));
vi.mock("@/lib/messaging/telegram-adapter", () => import("../../apps/web/src/lib/messaging/telegram-adapter"));
vi.mock("@/lib/agent-runtime/providers/openai-responses", () => ({ openAIProviderFromEnvironment: () => { throw Error("GENERAL_OPENAI_PROVIDER_PROHIBITED"); } }));
vi.mock("@/lib/messaging/outbound-dispatch", () => ({ dispatchQueuedTelegramMessage: () => { throw Error("GENERAL_OUTBOUND_PROHIBITED"); } }));
vi.mock("node:https", () => ({ request: (options: RequestOptions, callback: (response: IncomingMessage) => void) => {
  if (options.hostname !== "api.openai.com" || options.path !== "/v1/responses" || options.method !== "POST") throw Error("OFFLINE_FIXED_OPENAI_BOUNDARY_ONLY");
  const socket = new EventEmitter() as EventEmitter & { end: (body: string) => void; destroy: () => void }; socket.destroy = () => {};
  socket.end = body => { fake.modelCalls++; fake.bodies.push(JSON.parse(body)); const wire = structuredClone(fake.wire ?? polatClaudeFixtureWire()), sequence = ++fake.sequence;
    queueMicrotask(() => {
      const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void }; response.statusCode = 200; response.headers = { "content-type": "application/json", "x-request-id": "req_combined_fixture_" + sequence, "openai-organization": fake.organization, "openai-project": fake.project }; response.resume = () => {};
      callback(response as unknown as IncomingMessage);
      response.emit("data", Buffer.from(JSON.stringify({ id: "resp_combined_fixture_" + sequence, object: "response", model: "gpt-6.1-sol", status: "completed", created_at: Math.floor(Date.now() / 1000), error: null, incomplete_details: null, service_tier: "default", prompt_cache_options: { mode: "explicit", ttl: "30m" }, output: [{ type: "message", id: "msg_combined_fixture_" + sequence, role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(wire), annotations: [] }] }], usage: { input_tokens: 37, output_tokens: 121, total_tokens: 158, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 7 } } })));
      response.emit("end");
    });
  }; return socket as unknown as ClientRequest;
} }));
import { runDeterministicWorker } from "../../apps/web/src/lib/agent-runtime/worker";
import { buildAgentContext } from "../../apps/web/src/lib/agent-runtime/context-builder";
import { createPrivateBetaProviderFromDatabase } from "../../apps/web/src/lib/polat/private-beta-provider";
import { dispatchPrivateBetaMessage, privateBetaSourceSchema } from "../../apps/web/src/lib/polat/private-beta-runtime";
import { privateBetaBusinessUpdateId } from "../../apps/web/src/lib/polat/private-beta-business";

const connection = process.env.POLAT_BETA_OPENAI_BUSINESS_DB_URL, SHA = "a".repeat(40), MODEL_KEY = "SYNTHETIC_COMBINED_OPENAI_MODEL_KEY_ONLY";
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const id = (kind: number, n: number) => `92bf${kind}000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe.runIf(Boolean(connection))("combined native Polat OpenAI + BUSINESS + PG17 integration, fake external boundaries only", () => {
  let db: ReturnType<typeof disposablePolatDatabase>;
  const retired = new Set<string>(), eventTimes = new Map<string, string>(), base = Number(process.env.POLAT_OPENAI_BUSINESS_CASE_SEED ?? "31000");
  const service = (expression: string) => db.query(`begin;set local role service_role;select ${expression};commit;`);
  beforeAll(() => {
    db = disposablePolatDatabase(connection!); expect(db.query("select to_jsonb(current_setting('server_version_num')::int/10000)")).toBe(17); fake.client = polatSqlClient(db);
    vi.stubEnv("POLAT_UAT_RELEASE_SHA", SHA); vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA); vi.stubEnv("OPENAI_API_KEY", MODEL_KEY); vi.stubEnv("OPENAI_MODEL", "gpt-6-astra");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (options?.method !== "POST" || options.redirect !== "error") throw Error("OFFLINE_TELEGRAM_BOUNDARY_ONLY");
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      if (url === `https://api.telegram.org/bot${fake.botKey}/getBusinessConnection`) {
        fake.metadataCalls++; if (body.business_connection_id !== fake.business) throw Error("OFFLINE_BUSINESS_CONNECTION_REQUIRED");
        return Response.json({ ok: true, result: { id: fake.business, user: { id: Number(fake.representative), is_bot: false }, is_enabled: true, rights: { can_reply: true } } });
      }
      if (url !== `https://api.telegram.org/bot${fake.botKey}/sendMessage` || body.business_connection_id !== fake.business || body.chat_id !== fake.founder) throw Error("OFFLINE_EXACT_TELEGRAM_TARGET_ONLY");
      fake.sends++; return Response.json({ ok: true, result: { message_id: 1000 + fake.sends, chat: { id: Number(fake.founder), type: "private" }, business_connection_id: fake.business, text: body.text } });
    }));
  });
  afterAll(() => { for (const tenant of retired) db.execute(`begin;update public.tenants set status='suspended'where id='${tenant}'and slug like 'private-beta-openai-business-%';insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values('${tenant}','SYSTEM','private_beta.fixture_retired','tenants','${tenant}','{"mode":"OFFLINE_COMBINED_NATIVE_FIXTURE","financial_authority":"NONE"}');commit;`); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  type Scope = { n: number; tenant: string; program: string; owner: string; conversation: string; participant: string; claims: string; account: Record<string, unknown>; pricing: Record<string, unknown>; accountHash: string };
  const owner = (s: Pick<Scope, "claims">, expression: string) => db.query(`begin;set local role authenticated;set local request.jwt.claim.sub='';set local request.jwt.claims=${quote(s.claims)};select to_jsonb(${expression});commit;`);
  function event(s: Pick<Scope, "tenant" | "program">, kind: "INBOUND" | "HUMAN_REPLY", text: string, ordinal: number) {
    const sourceKey = `${s.program}:${kind}:${ordinal}`, occurredAt = eventTimes.get(sourceKey) ?? new Date().toISOString(); eventTimes.set(sourceKey, occurredAt);
    const facts = { version: 1, kind, update_id: String(ordinal), business_connection_id: fake.business, provider_user_id: kind === "HUMAN_REPLY" ? fake.representative : fake.founder, provider_chat_id: fake.founder, provider_message_id: String(ordinal), occurred_at: occurredAt, content: kind === "HUMAN_REPLY" ? text : null };
    const value = { ...facts, source_hash: polatGuardDigest(["COMBINED_BUSINESS_FIXTURE", facts, text]) };
    return service(`public.private_beta_business_event_v1('${s.tenant}','${s.program}',${quote(JSON.stringify(value))})`) as { accepted: boolean; action: string; duplicate: boolean };
  }
  function inbound(s: Pick<Scope, "tenant" | "program">, text: string, ordinal: number) {
    expect(event(s, "INBOUND", text, ordinal)).toMatchObject({ accepted: true, action: "INBOUND" });
    return service(`public.ingest_telegram_message('${s.tenant}',${quote(privateBetaBusinessUpdateId(fake.business, String(ordinal)))},'${ordinal}','${fake.founder}','${fake.founder}',null,null,null,${quote(text)},null,${quote(eventTimes.get(`${s.program}:INBOUND:${ordinal}`)!)})`) as { conversation_id: string; message_id: string; event_id: string; duplicate: boolean };
  }
  function reconcileFixture(s: Pick<Scope, "tenant" | "program" | "accountHash">, ordinal: number) {
    const attempt = db.query(`select jsonb_build_object('attempt',a.id,'request_hash',a.request_hash)from private.polat_experiment_attempts a join private.private_beta_attempt_scope scope on scope.attempt_id=a.id where scope.program_id='${s.program}'and scope.global_ordinal=${ordinal}`) as { attempt: string; request_hash: string };
    // Explicit isolated fixture accounting, not an inferred or genuine provider charge.
    db.execute(`select private.private_beta_reconcile_attempt('${s.tenant}','${s.program}','${attempt.attempt}',${quote(JSON.stringify({ version: 1, origin: "INDEPENDENT_PROVIDER_BILLING", coverage: "COMPLETE_REQUEST_CHARGE", account_scope_hash: s.accountHash, request_hash: attempt.request_hash, actual_billed_amount: "0.001284", currency: "USD", source_hash: "f".repeat(64), observed_at: new Date().toISOString() }))});`);
  }
  async function setup(n: number): Promise<Scope> {
    const tenant = id(1, n), program = id(2, n), user = id(3, n), at = Date.now();
    const claims = JSON.stringify({ sub: user, aal: "aal2", role: "authenticated", amr: [{ method: "totp", timestamp: Math.floor(at / 1000) }] });
    const config = { repository_sha: SHA, starts_at: new Date(at - 1000).toISOString(), expires_at: new Date(at + 3600000).toISOString(), retention_days: 7, notice_version: "polat-private-beta-notice-openai-v1", primary_operator: user, backup_operator: user, model_provider: "openai", model_name: "gpt-6.1-sol" };
    db.execute(`begin;insert into auth.users(id,email)values('${user}','combined-native-${n}@example.test');insert into public.tenants(id,name,slug,outbound_messaging_enabled)values('${tenant}','Combined OpenAI Business fixture','private-beta-openai-business-${n}',false);insert into public.tenant_members(tenant_id,user_id,role)values('${tenant}','${user}','super_admin');set local role authenticated;set local request.jwt.claim.sub='';set local request.jwt.claims=${quote(claims)};select public.admin_private_beta_create_v1('${tenant}','${program}',${quote(JSON.stringify(config))});commit;`); retired.add(tenant);
    fake.organization = "org-combined-" + n; fake.project = "proj_combined_" + n; fake.botKey = `${9800000 + n}:SYNTHETIC_COMBINED_TELEGRAM_KEY_ONLY`; fake.founder = String(8800000 + n); fake.representative = String(8900000 + n); fake.business = "combined-business-" + n; fake.modelCalls = 0; fake.metadataCalls = 0; fake.sends = 0; fake.sequence = 0; fake.wire = null; fake.bodies = []; vi.stubEnv("POLAT_UAT_TELEGRAM_BOT_TOKEN", fake.botKey);
    const meta = db.query(`select jsonb_build_object('manifest_hash',manifest_hash,'authorization_record_hash',authorization_record_hash)from private.private_beta_programs where id='${program}'`) as { manifest_hash: string; authorization_record_hash: string };
    const accountHash = polatGuardDigest(["OPENAI_PROJECT1", fake.organization, fake.project]);
    const account = { version: 2, origin: "INDEPENDENT_ACCOUNT_CONTROL", program_id: program, tenant_id: tenant, organization_id: fake.organization, project_id: fake.project, credential_sha256: createHash("sha256").update(MODEL_KEY).digest("hex"), account_scope_hash: accountHash, repository_sha: SHA, manifest_hash: meta.manifest_hash, authorization_record_hash: meta.authorization_record_hash, provider: "openai", model: "gpt-6.1-sol", model_access: true, policy_hash: "e".repeat(64), credential_custody_hash: polatGuardDigest(["POLAT_UAT_CREDENTIAL_CUSTODY1", accountHash, createHash("sha256").update(MODEL_KEY).digest("hex")]), region_evidence_hash: "1".repeat(64), retention_evidence_hash: "2".repeat(64), training_evidence_hash: "3".repeat(64), effective_limit_kind: "ENFORCED_EXPERIMENT_HARD_CAP", currency: "USD", enforced_maximum_spend: "5.00", independently_observed_spend: "0", remaining_allowance: "5.00", billing_state: "RECONCILED", billing_evidence_hash: "4".repeat(64), canary_reconciliation_hash: null as string | null, unknown_outcome_count: 0, request_bound: null, observed_at: new Date(at).toISOString(), expires_at: new Date(at + 300000).toISOString() };
    const pricing = { version: 2, origin: "INDEPENDENT_OFFICIAL_PRICING_READ", model: "gpt-6.1-sol", currency: "USD", source_url: "https://developers.openai.com/api/docs/pricing", source_hash: "8".repeat(64), maximum_input_tokens: 1050000, maximum_input_usd_per_million: "4", maximum_output_usd_per_million: "15", observed_at: new Date(at).toISOString(), expires_at: new Date(at + 3600000).toISOString(), all_billable_components_covered: true };
    db.execute(`select private.private_beta_account_control_record('${tenant}','${program}',${quote(JSON.stringify({ payload: account, pricing }))});select private.private_beta_bot_control_record('${tenant}','${program}',${quote(JSON.stringify({ version: 1, bot_id: fake.botKey.split(":")[0], source_hash: "9".repeat(64), observed_at: new Date(at).toISOString(), api_environment: "production", credential_sha256: createHash("sha256").update(fake.botKey).digest("hex") }))});`);
    owner({ claims }, `public.admin_private_beta_business_configure_v1('${tenant}','${program}',${quote(JSON.stringify({ representative_user_id: fake.representative, founder_chat_id: fake.founder, business_connection_id: fake.business }))},1)`);
    db.execute(`select private.private_beta_business_control_record('${tenant}','${program}',${quote(JSON.stringify({ version: 1, origin: "INDEPENDENT_TELEGRAM_BUSINESS_READ", bot_id: fake.botKey.split(":")[0], credential_sha256: createHash("sha256").update(fake.botKey).digest("hex"), repository_sha: SHA, business_connection_id: fake.business, representative_user_id: fake.representative, expected_generation: "1", enabled: true, can_reply: true, source_hash: "a".repeat(64), observed_at: new Date().toISOString(), expires_at: config.expires_at }))});`);
    owner({ claims }, `public.admin_private_beta_transition_v1('${tenant}','${program}','CANARY',2)`);
    const greeting = polatFixture("Hi", "en"), canaryConversation = id(5, n), canarySource = id(6, n); greeting.tenant_id = tenant; greeting.conversation_id = canaryConversation; greeting.source_message_id = canarySource; greeting.boundary = new Date(at).toISOString(); greeting.messages = greeting.messages.map(m => ({ ...m, id: canarySource, tenant_id: tenant, conversation_id: canaryConversation, occurred_at: greeting.boundary })); const prepared = preparePolatConversation(greeting); prepared.request.requestId = id(4, n); prepared.request.timeoutMs = 10000;
    const canary = await createPrivateBetaProviderFromDatabase({ tenantId: tenant, programId: program, scope: "CANARY", assess: (_request, response) => assessPolatDraft(prepared, response.output).action === "SAFE_PREVIEW" ? "APPROVED" : "HELD" }); await canary.provider.invoke(prepared.request); expect(fake.modelCalls).toBe(1);
    const partial = { tenant, program, accountHash }; reconcileFixture(partial, 1); account.canary_reconciliation_hash = "f".repeat(64); account.independently_observed_spend = "0.001284"; account.remaining_allowance = "4.998716";
    db.execute(`select private.private_beta_account_control_record('${tenant}','${program}',${quote(JSON.stringify({ payload: account, pricing }))});`);
    owner({ claims }, `public.admin_private_beta_transition_v1('${tenant}','${program}','FOUNDER',3)`); owner({ claims }, `public.admin_private_beta_operator_accept_v1('${tenant}','${program}')`);
    const invitation = owner({ claims }, `public.admin_private_beta_invite_v1('${tenant}','${program}','FOUNDER','${id(7, n)}')`) as { code: string };
    const accepted = service(`public.private_beta_invite_accept_v1('${tenant}','${fake.botKey.split(":")[0]}','${fake.founder}','${fake.founder}',${quote("/start " + invitation.code)})`) as { status: string; participant_id: string }; expect(accepted.status).toBe("NOTICE_REQUIRED");
    const initial = inbound(partial, "/start [invitation redacted]", 1), s: Scope = { n, tenant, program, owner: user, conversation: initial.conversation_id, participant: accepted.participant_id, claims, account, pricing, accountHash };
    const notice = service(`public.private_beta_queue_notice_v1('${tenant}','${program}','${s.participant}','${s.conversation}','${initial.message_id}','NOTICE')`) as { queued: boolean; message_id: string }; expect(notice.queued).toBe(true); await dispatchPrivateBetaMessage(tenant, program, notice.message_id); expect(fake.sends).toBe(1);
    expect(service(`public.private_beta_invite_accept_v1('${tenant}','${fake.botKey.split(":")[0]}','${fake.founder}','${fake.founder}','/agree')`)).toMatchObject({ status: "ACTIVE" }); inbound(s, "/agree", 2); expect(service(`public.private_beta_bind_conversation_v1('${tenant}','${s.participant}','${s.conversation}')`)).toEqual({ bound: true });
    return s;
  }
  const work = (s: Scope, suffix: string) => runDeterministicWorker({ workerId: "combined-" + s.n + "-" + suffix, conversation: { tenantId: s.tenant, conversationId: s.conversation }, polatUat: { programId: s.program } });
  it("carries two turns through native context/OpenAI/QA/BUSINESS ACK, preserves replay budget, then commits real-pipeline human pause", async () => {
    const s = await setup(base + 1);
    const first = inbound(s, "Hi", 3); expect(await work(s, "first")).toMatchObject({ tasksClaimed: 1, tasksFailed: 0 }); expect(fake.modelCalls).toBe(2); expect(fake.sends).toBe(2);
    expect(db.query(`select to_jsonb(original_payload->>'proposed_response')from public.agent_proposals where tenant_id='${s.tenant}'order by created_at desc limit 1`)).toBe("Hi! I'm Polat's AI assistant. What would you like to know?");
    expect(db.query(`select to_jsonb(customer_facing_blocked)from public.conversation_quality_evaluations where tenant_id='${s.tenant}'order by created_at desc limit 1`)).toBe(false);
    // A full conservative4.20768 reservation cannot fund a second unknown call;
    // explicitly reconcile this synthetic first turn before another reservation.
    reconcileFixture(s, 2); s.account.independently_observed_spend = "0.002568"; s.account.remaining_allowance = "4.997432"; db.execute(`select private.private_beta_account_control_record('${s.tenant}','${s.program}',${quote(JSON.stringify({ payload: s.account, pricing: s.pricing }))});`);
    const wire = polatClaudeFixtureWire(); wire.classification = "ACKNOWLEDGEMENT"; wire.proposed_response = "You're welcome."; wire.semantic_response = { response_goal: "Acknowledge the thanks", key_points: ["You're welcome."], factual_grounding: { classification: "unknown", evidence_refs: [], missing_information: ["approved_scoped_fact"] } }; wire.claims = [{ text: "You're welcome.", kind: "social", speech_act: "ACKNOWLEDGEMENT", capability: null, grounding: "GENERAL_SAFE_STATEMENT", evidence_refs: [], action_category: null }]; fake.wire = wire;
    const second = inbound(s, "Thanks", 4); expect(await work(s, "second")).toMatchObject({ tasksClaimed: 1, tasksFailed: 0 }); expect(fake.modelCalls).toBe(3); expect(fake.sends).toBe(3);
    const secondRequest = fake.bodies[2] as { input: Array<{ content: Array<{ text: string }> }> }; const sentContext = JSON.parse(secondRequest.input[1]!.content[0]!.text) as { source_message: { content: string }; context: { recentMessages: Array<{ direction: string; content: string }> } };
    expect(sentContext.source_message.content).toBe("Thanks"); expect(sentContext.context.recentMessages.some(m => m.direction === "outbound" && m.content === "Hi! I'm Polat's AI assistant. What would you like to know?")).toBe(true);
    const source = privateBetaSourceSchema.parse(service(`public.private_beta_source_scope_v1('${s.tenant}','${s.conversation}','${second.event_id}')`)); const customer = db.query(`select to_jsonb(customer_id)from public.conversations where id='${s.conversation}'`) as string;
    const built = await buildAgentContext({ tenant_id: s.tenant, customer_id: customer, conversation_id: s.conversation, source_event_id: second.event_id }, { polatPrivateBeta: source, polatPrivateBetaCodec: "openai-responses-v1" }); expect(built.manifest.private_beta_codec).toBe("openai-responses-v1"); expect(built.manifest.private_beta_history_basis).toBe("PROVIDER_ACK_ONLY");
    expect(inbound(s, "Thanks", 4).duplicate).toBe(true); expect(await work(s, "replay")).toMatchObject({ tasksClaimed: 0 }); expect(fake.modelCalls).toBe(3); expect(fake.sends).toBe(3); expect(first.message_id).not.toBe(second.message_id);
    db.execute(`insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_chat_id,reply_to_message_id,idempotency_key,actor_type,actor_id,correlation_id,occurred_at)select c.tenant_id,c.id,c.customer_id,c.messaging_contact_id,c.provider_connection_id,'outbound','text','A synthetic queued draft that must be fenced.','pending',a.provider_chat_id,a.last_inbound_id,'combined-stale-draft','SYSTEM','private-beta-ai:'||a.revision,extensions.gen_random_uuid(),clock_timestamp()from public.conversations c join private.private_beta_participants a on a.conversation_id=c.id where c.id='${s.conversation}';`);
    expect(event(s, "HUMAN_REPLY", "Polat Support: I'll take it from here.", 5)).toMatchObject({ accepted: true, action: "HELD" });
    expect(db.query(`select jsonb_build_object('mode',runtime_mode,'human',human_takeover,'automatic',automatic_replies_enabled)from public.conversations where id='${s.conversation}'`)).toEqual({ mode: "HUMAN_TAKEOVER", human: true, automatic: false });
    expect(db.query(`select to_jsonb(status)from public.messages where tenant_id='${s.tenant}'and idempotency_key='combined-stale-draft'`)).toBe("blocked"); expect(await work(s, "human-owned")).toMatchObject({ tasksClaimed: 0 }); expect(fake.modelCalls).toBe(3); expect(fake.sends).toBe(3);
    const admin = owner(s, `public.admin_private_beta_workspace_v1('${s.tenant}')`) as { program: unknown; attempts: unknown[] }; expect(admin.program).toMatchObject({ global_requests: 3, billing_status: "UNKNOWN", actual_billed_amount: null }); expect(admin.attempts).toHaveLength(3);
    expect(db.query(`select to_jsonb(count(*))from private.verified_payment_receipts where tenant_id='${s.tenant}'`)).toBe(0); expect(db.query(`select to_jsonb(count(*))from public.model_invocations where tenant_id='${s.tenant}'and provider='openai'and status='SUCCEEDED'`)).toBe(2);
  }, 60000);
});
