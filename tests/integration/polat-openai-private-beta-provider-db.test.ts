import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { disposablePolatDatabase } from "../helpers/polat-local-database";
import { preparePolatConversation, assessPolatDraft } from "../../packages/domain/src/polat-conversation";
import { polatFixture } from "../../packages/domain/src/polat-conversation.fixtures";
import { polatGuardDigest } from "../../packages/domain/src/polat-experiment-journal";
import { polatClaudeFixtureWire } from "../helpers/polat-bridge-fixtures";

// Genuine local PG17 transactions and the actual server factory; every external socket is fake.
// Simulated owner/account evidence below is NOT genuine MFA, provider/account or model acceptance.
const socket = vi.hoisted(() => ({ client: null as { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> } | null,
  calls: [] as Array<{ options: RequestOptions; body: string }>, responseId: "", disconnect: false, invalid: false, absentMetadata: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => { if (!socket.client) throw Error("DISPOSABLE_POSTGRES_REQUIRED"); return socket.client; } }));
vi.mock("node:https", () => ({ request: (options: RequestOptions, callback: (response: IncomingMessage) => void) => {
  const request = new EventEmitter() as EventEmitter & { end: (body: string) => void; destroy: () => void }; request.destroy = () => {};
  request.end = body => { socket.calls.push({ options, body }); queueMicrotask(() => {
    if (socket.disconnect) { request.emit("error", Error("SYNTHETIC_NETWORK_LOSS")); return; }
    const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void };
    response.statusCode = 200; response.headers = { "content-type": "application/json", "x-request-id": "req_local_openai_model" }; response.resume = () => {};
    callback(response as unknown as IncomingMessage);
    response.emit("data", Buffer.from(JSON.stringify({ id: socket.responseId, object: "response", model: socket.invalid ? "gpt-6-luna" : "gpt-6.1-sol", status: "completed", created_at: 1793059200, error: null, incomplete_details: null,
      service_tier: socket.absentMetadata ? null : "default", prompt_cache_options: socket.absentMetadata ? null : { mode: "explicit", ttl: "30m" },
      output: [{ type: "message", id: "msg_local_openai_model", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(polatClaudeFixtureWire()), annotations: [] }] }],
      usage: { input_tokens: 37, output_tokens: 121, total_tokens: 158, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 7 } } })));
    response.emit("end");
  }); }; return request as unknown as ClientRequest;
} }));
import { createPrivateBetaProviderFromDatabase } from "../../apps/web/src/lib/polat/private-beta-provider";

const connection = process.env.POLAT_BETA_MODEL_DB_URL, quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
const id = (kind: number, n: number) => `91bf${kind}000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SHA = "a".repeat(40), KEY = "SYNTHETIC_LOCAL_OPENAI_CREDENTIAL_ONLY";
const allowed = new Set(["private_beta_binding_v1", "private_beta_owner_grant_v1", "private_beta_account_control_v1", "private_beta_reserve_v1", "private_beta_begin_v1", "private_beta_committed_attempt_v1", "private_beta_record_v1"]);
describe.runIf(Boolean(connection))("OpenAI UAT actual server/provider with disposable PG17 and fake HTTPS only", () => {
  let db: ReturnType<typeof disposablePolatDatabase>;
  const base = Number(process.env.POLAT_OPENAI_BETA_MODEL_CASE_SEED ?? "6600");
  beforeAll(() => {
    db = disposablePolatDatabase(connection!); expect(db.query("select to_jsonb(current_setting('server_version_num')::int/10000)")).toBe(17);
    vi.stubEnv("POLAT_UAT_RELEASE_SHA", SHA); vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA); vi.stubEnv("OPENAI_API_KEY", KEY);
    // This historical/global setting must not select the model for a scoped UAT program.
    vi.stubEnv("OPENAI_MODEL", "gpt-6-astra");
    socket.client = { rpc: (name, args) => {
      if (!allowed.has(name)) return Promise.reject(Error("LOCAL_RPC_NOT_ALLOWLISTED"));
      const params = Object.entries(args).map(([key, value]) => { if (!/^[a-z_]+$/u.test(key) || value !== null && typeof value !== "string") throw Error("LOCAL_RPC_PARAMETER_INVALID"); return key + "=>" + (value === null ? "null" : quote(value)); }).join(",");
      try { return Promise.resolve({ data: db.query(`begin;set local role service_role;select to_jsonb(public.${name}(${params}));commit;`), error: null }); }
      catch { return Promise.resolve({ data: null, error: { code: "DISPOSABLE_RPC_FAILED" } }); }
    } };
  });
  function setup(n: number, seal = true) {
    const tenant = id(1, n), program = id(2, n), owner = id(3, n), native = id(4, n), conversation = id(5, n), source = id(6, n), now = Date.now();
    const claims = JSON.stringify({ sub: owner, aal: "aal2", role: "authenticated", amr: [{ method: "totp", timestamp: Math.floor(now / 1000) }] });
    const config = { repository_sha: SHA, starts_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 3600000).toISOString(), retention_days: 7, notice_version: "polat-private-beta-notice-openai-v1", primary_operator: null, backup_operator: null, model_provider: "openai", model_name: "gpt-6.1-sol" };
    db.execute(`begin;insert into auth.users(id,email)values('${owner}','openai-fixture-${n}@example.test');insert into public.tenants(id,name,slug,outbound_messaging_enabled)values('${tenant}','Local OpenAI wrapper fixture','private-beta-openai-model-${n}',false);insert into public.tenant_members(tenant_id,user_id,role)values('${tenant}','${owner}','super_admin');set local role authenticated;set local request.jwt.claim.sub='${owner}';set local request.jwt.claims=${quote(claims)};select public.admin_private_beta_create_v1('${tenant}','${program}',${quote(JSON.stringify(config))});commit;`);
    const meta = db.query(`select jsonb_build_object('manifest_hash',manifest_hash,'authorization_record_hash',authorization_record_hash)from private.private_beta_programs where id='${program}'`) as { manifest_hash: string; authorization_record_hash: string };
    const organization = "org-fixture" + n, project = "proj_fixture" + n, account = polatGuardDigest(["OPENAI_PROJECT1", organization, project]);
    const payload = { version: 2, origin: "INDEPENDENT_ACCOUNT_CONTROL", program_id: program, tenant_id: tenant, organization_id: organization, project_id: project, credential_sha256: createHash("sha256").update(KEY, "utf8").digest("hex"), account_scope_hash: account, repository_sha: SHA, manifest_hash: meta.manifest_hash, authorization_record_hash: meta.authorization_record_hash, provider: "openai", model: "gpt-6.1-sol", model_access: true,
      policy_hash: "e".repeat(64), credential_custody_hash: polatGuardDigest(["POLAT_UAT_CREDENTIAL_CUSTODY1", account, createHash("sha256").update(KEY, "utf8").digest("hex")]), region_evidence_hash: "1".repeat(64), retention_evidence_hash: "2".repeat(64), training_evidence_hash: "3".repeat(64), effective_limit_kind: "ENFORCED_EXPERIMENT_HARD_CAP", currency: "USD", enforced_maximum_spend: "5.00", independently_observed_spend: "0", remaining_allowance: "5.00", billing_state: "RECONCILED", billing_evidence_hash: "4".repeat(64), canary_reconciliation_hash: null, unknown_outcome_count: 0, request_bound: null, observed_at: new Date(now).toISOString(), expires_at: new Date(now + 300000).toISOString() };
    const pricing = { version: 2, origin: "INDEPENDENT_OFFICIAL_PRICING_READ", model: "gpt-6.1-sol", currency: "USD", source_url: "https://developers.openai.com/api/docs/pricing", source_hash: "8".repeat(64), maximum_input_tokens: 1050000, maximum_input_usd_per_million: "4", maximum_output_usd_per_million: "15", observed_at: new Date(now).toISOString(), expires_at: new Date(now + 3600000).toISOString(), all_billable_components_covered: true };
    if (seal) db.execute(`begin;select private.private_beta_account_control_record('${tenant}','${program}',${quote(JSON.stringify({ payload, pricing }))});set local role authenticated;set local request.jwt.claim.sub='${owner}';set local request.jwt.claims=${quote(claims)};select public.admin_private_beta_transition_v1('${tenant}','${program}','CANARY',1);commit;`);
    const input = polatFixture("Hi", "en"); input.tenant_id = tenant; input.conversation_id = conversation; input.source_message_id = source; input.boundary = new Date(now).toISOString(); input.messages = input.messages.map(m => ({ ...m, id: source, tenant_id: tenant, conversation_id: conversation, occurred_at: input.boundary }));
    const prepared = preparePolatConversation(input); prepared.request.requestId = native; prepared.request.timeoutMs = 10000;
    socket.responseId = "resp_local_openai_" + n; socket.calls = []; socket.disconnect = false; socket.invalid = false; socket.absentMetadata = false; vi.stubEnv("OPENAI_API_KEY", KEY);
    return { tenant, program, owner, native, conversation, prepared, payload, pricing, claims, config, organization, project };
  }
  const provider = (s: ReturnType<typeof setup>) => createPrivateBetaProviderFromDatabase({ tenantId: s.tenant, programId: s.program, scope: "CANARY", assess: (_request, actual) => assessPolatDraft(s.prepared, actual.output).action === "SAFE_PREVIEW" ? "APPROVED" : "HELD" });
  const retire = (s: ReturnType<typeof setup>) => db.execute(`begin;update public.tenants set status='suspended'where id='${s.tenant}'and slug like 'private-beta-openai-model-%';insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values('${s.tenant}','SYSTEM','private_beta.fixture_retired','tenants','${s.tenant}','{"mode":"FIXTURE_ONLY","financial_authority":"NONE"}');commit;`);
  const state = (s: ReturnType<typeof setup>) => db.query(`select jsonb_build_object('requests',request_count,'reserved',trim_scale(reserved_liability)::text,'stage',stage,'canary_reconciled',canary_reconciliation_hash is not null)from private.private_beta_programs where id='${s.program}'`);
  it("commits the version2 canary, native QA and unknown billing before returning the actual fake response", async () => {
    const s = setup(base + 1); try {
      const service = await provider(s), result = await service.provider.invoke(s.prepared.request);
      expect(result.provider).toBe("openai"); expect(result.model).toBe("gpt-6.1-sol"); expect(result.output.proposed_response).toBe(polatClaudeFixtureWire().proposed_response); expect(socket.calls).toHaveLength(1);
      expect(socket.calls[0]!.options).toMatchObject({ hostname: "api.openai.com", path: "/v1/responses", headers: { "OpenAI-Organization": s.organization, "OpenAI-Project": s.project } });
      expect(JSON.parse(socket.calls[0]!.body) as unknown).toMatchObject({ model: "gpt-6.1-sol", max_output_tokens: 512, service_tier: "default" });
      expect(state(s)).toEqual({ requests: 1, reserved: "4.20768", stage: "CANARY", canary_reconciled: false }); expect(result.usage.billedAmount).toBeNull();
      expect(db.query(`select jsonb_agg(jsonb_build_object('stage',e.stage,'status',e.payload->>'status','qa',e.payload->>'qa','actual_bill',e.payload->>'actual_billed_amount')order by e.sequence)from private.polat_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id='${s.program}'`)).toEqual([{ stage: "DISPATCH_STARTED", status: "STARTED", qa: null, actual_bill: null }, { stage: "PROVIDER_RESULT", status: "SUCCEEDED", qa: "APPROVED", actual_bill: null }]);
      const restarted = await provider(s); await expect(restarted.provider.invoke(s.prepared.request)).rejects.toThrow("RESERVATION"); expect(socket.calls).toHaveLength(1);
      expect(db.query(`select to_jsonb(count(*))from private.verified_payment_receipts where tenant_id='${s.tenant}'`)).toBe(0); expect(db.query(`select to_jsonb(count(*))from public.messages where tenant_id='${s.tenant}'and direction='outbound'`)).toBe(0);
    } finally { retire(s); }
  }, 60000);
  it("keeps unknown remote completion and rejects a process-style restart without an extra call", async () => {
    const s = setup(base + 2); try {
      socket.disconnect = true; const service = await provider(s); await expect(service.provider.invoke(s.prepared.request)).rejects.toMatchObject({ retryable: false }); expect(socket.calls).toHaveLength(1);
      expect(db.query(`select to_jsonb(e.stage)from private.polat_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id='${s.program}'order by e.sequence desc limit 1`)).toBe("RESULT_UNKNOWN");
      const restarted = await provider(s); await expect(restarted.provider.invoke(s.prepared.request)).rejects.toThrow(); expect(socket.calls).toHaveLength(1); expect(state(s)).toMatchObject({ requests: 1, reserved: "4.20768" });
    } finally { retire(s); }
  }, 60000);
  it("preserves the committed budget when result-evidence commit fails", async () => {
    const s = setup(base + 3); try {
      db.execute(`create function private.openai_model_commit_failure_fixture()returns trigger language plpgsql as $$begin if new.tenant_id='${s.tenant}'and new.stage='PROVIDER_RESULT'then raise exception 'SYNTHETIC_COMMIT_FAILURE';end if;return new;end;$$;create trigger openai_model_commit_failure_fixture before insert on private.polat_experiment_evidence for each row execute function private.openai_model_commit_failure_fixture();`);
      const service = await provider(s); await expect(service.provider.invoke(s.prepared.request)).rejects.toThrow("COMMIT_UNKNOWN"); expect(socket.calls).toHaveLength(1);
      expect(db.query(`select to_jsonb(count(*))from private.polat_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id='${s.program}'and e.stage='PROVIDER_RESULT'`)).toBe(0);
      const restarted = await provider(s); await expect(restarted.provider.invoke(s.prepared.request)).rejects.toThrow(); expect(socket.calls).toHaveLength(1); expect(state(s)).toMatchObject({ requests: 1, reserved: "4.20768" });
    } finally { db.execute("drop trigger if exists openai_model_commit_failure_fixture on private.polat_experiment_evidence;drop function if exists private.openai_model_commit_failure_fixture();"); retire(s); }
  }, 60000);
  it("does not use a different pre-existing key and consumes no outbound model effect", async () => {
    const s = setup(base + 4); try {
      vi.stubEnv("OPENAI_API_KEY", "SYNTHETIC_OTHER_PROJECT_CREDENTIAL"); const service = await provider(s);
      await expect(service.provider.invoke(s.prepared.request)).rejects.toThrow(); expect(socket.calls).toHaveLength(0); expect(state(s)).toMatchObject({ requests: 1, reserved: "4.20768" });
    } finally { vi.stubEnv("OPENAI_API_KEY", KEY); retire(s); }
  }, 60000);
  it("does not derive genuine account authority from a balance report or an unsealed DRAFT", async () => {
    const s = setup(base + 5, false); try {
      await expect(provider(s)).rejects.toThrow(); expect(socket.calls).toHaveLength(0);
      expect(() => db.execute(`select private.private_beta_account_control_record('${s.tenant}','${s.program}',${quote(JSON.stringify({ payload: { ...s.payload, effective_limit_kind: "REPORTED_BALANCE", remaining_allowance: "18" }, pricing: s.pricing }))});`)).toThrow();
      expect(state(s)).toMatchObject({ requests: 0, stage: "DRAFT" });
    } finally { retire(s); }
  }, 60000);
  it("denies cross-tenant lookup and mismatched provider before any socket", async () => {
    const s = setup(base + 6); try {
      await expect(createPrivateBetaProviderFromDatabase({ tenantId: id(1, base + 999), programId: s.program, scope: "CANARY", assess: () => "APPROVED" })).rejects.toThrow(); expect(socket.calls).toHaveLength(0);
      expect(() => db.execute(`select private.private_beta_account_control_record('${s.tenant}','${s.program}',${quote(JSON.stringify({ payload: { ...s.payload, provider: "anthropic" }, pricing: s.pricing }))});`)).toThrow(); expect(state(s)).toMatchObject({ requests: 0 });
    } finally { retire(s); }
  }, 60000);
  it("never accepts a model mismatch or turns a fake ACK into reconciled cost", async () => {
    const s = setup(base + 7); try {
      socket.invalid = true; const service = await provider(s); await expect(service.provider.invoke(s.prepared.request)).rejects.toThrow("ENVELOPE_INVALID"); expect(socket.calls).toHaveLength(1);
      expect(state(s)).toMatchObject({ requests: 1, reserved: "4.20768", canary_reconciled: false });
      expect(db.query(`select coalesce(to_jsonb(e.payload->>'actual_billed_amount'),'null'::jsonb)from private.polat_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id='${s.program}'order by e.sequence desc limit 1`)).toBeNull();
    } finally { retire(s); }
  }, 60000);
  it("retains the entire real PG reservation and UNKNOWN bill when optional provider metadata is null", async () => {
    const s = setup(base + 8); try {
      socket.absentMetadata = true; const service = await provider(s), result = await service.provider.invoke(s.prepared.request);
      expect(result.output.proposed_response).toBe(polatClaudeFixtureWire().proposed_response); expect(result.usage.billedAmount).toBeNull(); expect(socket.calls).toHaveLength(1);
      expect(state(s)).toEqual({ requests: 1, reserved: "4.20768", stage: "CANARY", canary_reconciled: false });
      expect(db.query(`select to_jsonb(private.private_beta_billing(s.attempt_id)is null)from private.private_beta_attempt_scope s where s.program_id='${s.program}'`)).toBe(true);
    } finally { retire(s); }
  }, 60000);
});
