import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { disposablePolatDatabase } from "../helpers/polat-local-database";
import { preparePolatConversation, assessPolatDraft } from "../../packages/domain/src/polat-conversation";
import { polatFixture } from "../../packages/domain/src/polat-conversation.fixtures";
import { polatGuardDigest } from "../../packages/domain/src/polat-experiment-journal";
import { polatClaudeCompleteEnvelope } from "../helpers/polat-bridge-fixtures";

// Actual local PostgreSQL + actual server factory; only the remote provider socket is fake.
// These simulated account/owner boundaries are never real account, MFA or inference acceptance.
const socket = vi.hoisted(() => ({ client: null as { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> } | null, calls: 0, workspace: "", responseId: "", disconnect: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => { if (!socket.client) throw Error("DISPOSABLE_POSTGRES_REQUIRED"); return socket.client; } }));
vi.mock("node:https", () => ({ request: (_options: RequestOptions, callback: (r: IncomingMessage) => void) => {
  const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }; request.destroy = () => {};
  request.end = () => { socket.calls++; queueMicrotask(() => {
    if (socket.disconnect) { request.emit("error", Error("SYNTHETIC_NETWORK_LOSS")); return; }
    const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void };
    response.statusCode = 200; response.headers = { "content-type": "application/json", "anthropic-workspace-id": socket.workspace, "request-id": "req_simulated_db_model" }; response.resume = () => {};
    callback(response as unknown as IncomingMessage); response.emit("data", Buffer.from(JSON.stringify(polatClaudeCompleteEnvelope({ id: socket.responseId })))); response.emit("end");
  }); }; return request as unknown as ClientRequest;
} }));
import { createPrivateBetaProviderFromDatabase } from "../../apps/web/src/lib/polat/private-beta-provider";

const connection = process.env.POLAT_BETA_MODEL_DB_URL, quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
const id = (kind: number, n: number) => `91be${kind}000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SHA = "a".repeat(40), KEY = "SYNTHETIC_LOCAL_MODEL_CREDENTIAL_ONLY";
const allowed = new Set(["private_beta_binding_v1", "private_beta_owner_grant_v1", "private_beta_account_control_v1", "private_beta_reserve_v1", "private_beta_begin_v1", "private_beta_committed_attempt_v1", "private_beta_record_v1"]);
describe.runIf(Boolean(connection))("genuine provider wrapper against disposable PG17 and fake HTTPS only", () => {
  let db: ReturnType<typeof disposablePolatDatabase>;
  const base = Number(process.env.POLAT_BETA_MODEL_CASE_SEED ?? "5500");
  beforeAll(() => {
    db = disposablePolatDatabase(connection!); expect(db.query("select to_jsonb(current_setting('server_version_num')::int/10000)")).toBe(17);
    vi.stubEnv("POLAT_UAT_RELEASE_SHA", SHA); vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA); vi.stubEnv("POLAT_UAT_ANTHROPIC_API_KEY", KEY);
    socket.client = { rpc: (name, args) => {
      if (!allowed.has(name)) return Promise.reject(Error("LOCAL_RPC_NOT_ALLOWLISTED"));
      const params = Object.entries(args).map(([name, value]) => { if (!/^[a-z_]+$/u.test(name) || value !== null && typeof value !== "string") throw Error("LOCAL_RPC_PARAMETER_INVALID"); return name + "=>" + (value === null ? "null" : quote(value)); }).join(",");
      try { return Promise.resolve({ data: db.query(`begin;set local role service_role;select to_jsonb(public.${name}(${params}));commit;`), error: null }); }
      catch { return Promise.resolve({ data: null, error: { code: "DISPOSABLE_RPC_FAILED" } }); }
    } };
  });
  function setup(n: number) {
    const tenant = id(1, n), program = id(2, n), owner = id(3, n), native = id(4, n), conversation = id(5, n), source = id(6, n), now = Date.now();
    const claims = JSON.stringify({ sub: owner, aal: "aal2", role: "authenticated", amr: [{ method: "totp", timestamp: Math.floor(now / 1000) }] });
    const config = { repository_sha: SHA, starts_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 3600000).toISOString(), retention_days: 7, notice_version: "polat-private-beta-notice-v1", primary_operator: null, backup_operator: null };
    db.execute(`begin;insert into auth.users(id,email)values('${owner}','model-fixture-${n}@example.test');insert into public.tenants(id,name,slug,outbound_messaging_enabled)values('${tenant}','Local model wrapper fixture','private-beta-model-${n}',false);insert into public.tenant_members(tenant_id,user_id,role)values('${tenant}','${owner}','super_admin');set local role authenticated;set local request.jwt.claim.sub='${owner}';set local request.jwt.claims=${quote(claims)};select public.admin_private_beta_create_v1('${tenant}','${program}',${quote(JSON.stringify(config))});commit;`);
    const meta = db.query(`select jsonb_build_object('manifest_hash',manifest_hash,'authorization_record_hash',authorization_record_hash)from private.private_beta_programs where id='${program}'`) as { manifest_hash: string; authorization_record_hash: string };
    const workspace = "wrkspc_model" + n, account = polatGuardDigest(["ANTHROPIC_WORKSPACE1", workspace]);
    const payload = { version: 1, origin: "INDEPENDENT_ACCOUNT_CONTROL", program_id: program, tenant_id: tenant, workspace_id: workspace, account_scope_hash: account, repository_sha: SHA, manifest_hash: meta.manifest_hash, authorization_record_hash: meta.authorization_record_hash, provider: "anthropic", model: "claude-haiku-5-5", model_access: true,
      policy_hash: "e".repeat(64), credential_custody_hash: polatGuardDigest(["POLAT_UAT_CREDENTIAL_CUSTODY1", account, createHash("sha256").update(KEY, "utf8").digest("hex")]), region_evidence_hash: "1".repeat(64), retention_evidence_hash: "2".repeat(64), training_evidence_hash: "3".repeat(64), effective_limit_kind: "ENFORCED_EXPERIMENT_HARD_CAP", currency: "USD", enforced_maximum_spend: "5.00", independently_observed_spend: "0", remaining_allowance: "5.00", billing_state: "RECONCILED", billing_evidence_hash: "4".repeat(64), canary_reconciliation_hash: null, unknown_outcome_count: 0, request_bound: null, observed_at: new Date(now).toISOString(), expires_at: new Date(now + 300000).toISOString() };
    const pricing = { version: 1, origin: "INDEPENDENT_OFFICIAL_PRICING_READ", model: "claude-haiku-5-5", currency: "USD", source_url: "https://platform.claude.com/docs/en/models/haiku-5-5/overview", source_hash: "8".repeat(64), maximum_input_tokens: 1000000, maximum_input_usd_per_million: "0.50", maximum_output_usd_per_million: "2.50", observed_at: new Date(now).toISOString(), expires_at: new Date(now + 3600000).toISOString(), all_billable_components_covered: true };
    db.execute(`begin;select private.private_beta_account_control_record('${tenant}','${program}',${quote(JSON.stringify({ payload, pricing }))});set local role authenticated;set local request.jwt.claim.sub='${owner}';set local request.jwt.claims=${quote(claims)};select public.admin_private_beta_transition_v1('${tenant}','${program}','CANARY',1);commit;`);
    const input = polatFixture("Hi", "en"); input.tenant_id = tenant; input.conversation_id = conversation; input.source_message_id = source; input.boundary = new Date(now).toISOString(); input.messages = input.messages.map(m => ({ ...m, id: source, tenant_id: tenant, conversation_id: conversation, occurred_at: input.boundary }));
    const prepared = preparePolatConversation(input); prepared.request.requestId = native; prepared.request.timeoutMs = 10000;
    socket.workspace = workspace; socket.responseId = "msg_local_model_" + n; socket.calls = 0; socket.disconnect = false;
    return { tenant, program, owner, native, conversation, prepared };
  }
  const provider = (s: ReturnType<typeof setup>) => createPrivateBetaProviderFromDatabase({ tenantId: s.tenant, programId: s.program, scope: "CANARY", assess: (_request, response) => assessPolatDraft(s.prepared, response.output).action === "SAFE_PREVIEW" ? "APPROVED" : "HELD" });
  const retire = (s: ReturnType<typeof setup>) => db.execute(`begin;update public.tenants set status='suspended'where id='${s.tenant}'and slug like 'private-beta-model-%';insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values('${s.tenant}','SYSTEM','private_beta.fixture_retired','tenants','${s.tenant}','{"mode":"FIXTURE_ONLY","financial_authority":"NONE"}');commit;`);
  it("commits real reservations/results, preserves unknown billing and cannot turn a successful fake canary into founder authority", async () => {
    const s = setup(base + 1); try {
      const service = await provider(s), result = await service.provider.invoke(s.prepared.request);
      expect(result.provider).toBe("anthropic"); expect(socket.calls).toBe(1); expect(result.usage.billedAmount).toBeNull();
      expect(db.query(`select jsonb_build_object('requests',request_count,'reserved',trim_scale(reserved_liability)::text,'stage',stage,'canary_reconciled',canary_reconciliation_hash is not null)from private.private_beta_programs where id='${s.program}'`)).toEqual({ requests: 1, reserved: "0.50128", stage: "CANARY", canary_reconciled: false });
      expect(db.query(`select jsonb_agg(jsonb_build_object('stage',e.stage,'status',e.payload->>'status','qa',e.payload->>'qa','actual_bill',e.payload->>'actual_billed_amount')order by e.sequence)from private.polat_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id='${s.program}'`)).toEqual([{ stage: "DISPATCH_STARTED", status: "STARTED", qa: null, actual_bill: null }, { stage: "PROVIDER_RESULT", status: "SUCCEEDED", qa: "APPROVED", actual_bill: null }]);
      expect(db.query(`select to_jsonb(count(*))from private.verified_payment_receipts where tenant_id='${s.tenant}'`)).toBe(0);
      expect(db.query(`select to_jsonb(count(*))from public.messages where tenant_id='${s.tenant}'and direction='outbound'`)).toBe(0);
      const restarted = await provider(s); await expect(restarted.provider.invoke(s.prepared.request)).rejects.toThrow("RESERVATION"); expect(socket.calls).toBe(1);
    } finally { retire(s); }
  }, 60000);
  it("keeps unknown remote completion visible and does not dispatch again after a process-style restart", async () => {
    const s = setup(base + 2); try {
      socket.disconnect = true; const service = await provider(s); await expect(service.provider.invoke(s.prepared.request)).rejects.toMatchObject({ retryable: false }); expect(socket.calls).toBe(1);
      expect(db.query(`select to_jsonb(e.stage)from private.polat_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id='${s.program}'order by e.sequence desc limit 1`)).toBe("RESULT_UNKNOWN");
      const restarted = await provider(s); await expect(restarted.provider.invoke(s.prepared.request)).rejects.toThrow(); expect(socket.calls).toBe(1);
      expect(db.query(`select to_jsonb(request_count)from private.private_beta_programs where id='${s.program}'`)).toBe(1);
    } finally { retire(s); }
  }, 60000);
  it("preserves a begun reservation when the evidence commit fails and never reports that remote response as durably accepted", async () => {
    const s = setup(base + 3); try {
      db.execute(`create function private.beta_model_commit_failure_fixture()returns trigger language plpgsql as $$begin if new.tenant_id='${s.tenant}'and new.stage='PROVIDER_RESULT'then raise exception 'SYNTHETIC_COMMIT_FAILURE';end if;return new;end;$$;create trigger beta_model_commit_failure_fixture before insert on private.polat_experiment_evidence for each row execute function private.beta_model_commit_failure_fixture();`);
      const service = await provider(s); await expect(service.provider.invoke(s.prepared.request)).rejects.toThrow("COMMIT_UNKNOWN"); expect(socket.calls).toBe(1);
      expect(db.query(`select to_jsonb(count(*))from private.polat_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id='${s.program}'and e.stage='PROVIDER_RESULT'`)).toBe(0);
      const restarted = await provider(s); await expect(restarted.provider.invoke(s.prepared.request)).rejects.toThrow(); expect(socket.calls).toBe(1);
      expect(db.query(`select to_jsonb(request_count)from private.private_beta_programs where id='${s.program}'`)).toBe(1);
    } finally { db.execute("drop trigger if exists beta_model_commit_failure_fixture on private.polat_experiment_evidence;drop function if exists private.beta_model_commit_failure_fixture();"); retire(s); }
  }, 60000);
});
