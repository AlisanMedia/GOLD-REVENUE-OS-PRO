import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { disposablePolatDatabase, polatSqlClient } from "../helpers/polat-local-database";
import { polatClaudeFixtureWire } from "../helpers/polat-bridge-fixtures";
import { polatGuardDigest } from "../../packages/domain/src/polat-experiment-journal";

// Real independent PG connections + native worker/context/QA. Every external socket
// is an OFFLINE double. JWT/account/billing declarations below are synthetic only.
const fake = vi.hoisted(() => ({ db: null as ReturnType<typeof polatSqlClient> | null,
  key: "SYNTHETIC_CAMPAIGN_OPENAI_CREDENTIAL", bot: "", representative: "", chat: "", business: "", organization: "", project: "",
  calls: 0, sends: 0, wire: null as unknown, modelStatus: 200, timeout: false, sendUnknown: false, rateLimit: false, permission: true, afterModel: null as (() => void) | null,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fake.db }));
vi.mock("@/lib/agent-runtime/context-builder", () => import("../../apps/web/src/lib/agent-runtime/context-builder"));
vi.mock("@/lib/polat/test-runtime", () => import("../../apps/web/src/lib/polat/test-runtime"));
vi.mock("@/lib/messaging/outbound-dispatch", () => ({ dispatchQueuedTelegramMessage: () => { throw Error("LEGACY_SENDER_NOT_ALLOWED"); } }));
vi.mock("@/lib/agent-runtime/providers/openai-responses", () => ({ openAIProviderFromEnvironment: () => { throw Error("UNBOUNDED_PROVIDER_NOT_ALLOWED"); } }));
vi.mock("node:https", () => ({ request: (options: RequestOptions, callback: (r: IncomingMessage) => void) => {
  if (options.hostname !== "api.openai.com" || options.path !== "/v1/responses" || options.method !== "POST") throw Error("OFFLINE_FIXED_MODEL_ENDPOINT_ONLY");
  const socket = new EventEmitter() as EventEmitter & { end: (body: string) => void; destroy: () => void };
  socket.destroy = () => {};
  socket.end = body => {
    const request = JSON.parse(body) as { model: string; max_output_tokens: number };
    expect(request.model).toBe("gpt-6.1-sol"); expect(request.max_output_tokens).toBe(512);
    fake.calls++;
    queueMicrotask(() => {
      if (fake.timeout) { socket.emit("error", Error("SYNTHETIC_NETWORK_UNKNOWN")); return; }
      const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void };
      response.statusCode = fake.modelStatus; response.headers = { "content-type": "application/json", "x-request-id": `req_campaign_${fake.calls}` }; response.resume = () => {};
      callback(response as unknown as IncomingMessage);
      if (fake.modelStatus !== 200) return;
      response.emit("data", Buffer.from(JSON.stringify({ id: `resp_campaign_${fake.calls}`, object: "response", model: "gpt-6.1-sol", status: "completed", created_at: Math.floor(Date.now() / 1000),
        output: [{ type: "message", id: `msg_campaign_${fake.calls}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(fake.wire ?? polatClaudeFixtureWire()), annotations: [] }] }],
        usage: { input_tokens: 37, output_tokens: 121, total_tokens: 158 } })));
      fake.afterModel?.(); response.emit("end");
    });
  };
  return socket as unknown as ClientRequest;
} }));
import { runDeterministicWorker } from "../../apps/web/src/lib/agent-runtime/worker";
import { buildAgentContext } from "../../apps/web/src/lib/agent-runtime/context-builder";
import { preparePolatCampaignRuntime } from "../../packages/domain/src/polat-campaign-runtime";
import { preparePolatOpenAIRequest } from "../../packages/domain/src/polat-openai-adapter";
import { dispatchCampaignMessage } from "../../apps/web/src/lib/polat/campaign-execution";

const connection = process.env.CAMPAIGN_GENUINE_DB_URL, SHA = "a".repeat(40);
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const id = (n: number, kind: string) => `61b0${kind}-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe.runIf(Boolean(connection))("genuine campaign architecture, actual disposable PG17, fake external network", () => {
  let db: ReturnType<typeof disposablePolatDatabase>;
  const tenants = new Set<string>();
  const seed = Number(process.env.CAMPAIGN_GENUINE_CASE_SEED ?? "0");
  const service = (expression: string) => db.query(`begin;set local role service_role;select to_jsonb(${expression});commit;`);
  beforeAll(() => {
    db = disposablePolatDatabase(connection!); fake.db = polatSqlClient(db);
    expect(db.query("select to_jsonb(current_setting('server_version_num')::int/10000)")).toBe(17);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA); vi.stubEnv("OPENAI_API_KEY", fake.key);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (options?.method !== "POST" || options.redirect !== "error") throw Error("OFFLINE_TELEGRAM_ONLY");
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      if (url === `https://api.telegram.org/bot${fake.bot}/getBusinessConnection`) return Response.json({ ok: true, result: { id: fake.business, user: { id: Number(fake.representative), is_bot: false }, is_enabled: fake.permission, rights: { can_reply: fake.permission } } });
      if (url !== `https://api.telegram.org/bot${fake.bot}/sendMessage` || body.business_connection_id !== fake.business || body.chat_id !== fake.chat) throw Error("OFFLINE_MATCHED_RECIPIENT_ONLY");
      fake.sends++; if (fake.sendUnknown) throw Error("SYNTHETIC_SEND_UNKNOWN");
      if (fake.rateLimit) return Response.json({ ok: false, error_code: 429, parameters: { retry_after: 1 } }, { status: 429 });
      return Response.json({ ok: true, result: { message_id: 7000 + fake.sends, chat: { id: Number(fake.chat), type: "private" }, business_connection_id: fake.business, text: body.text } });
    }));
  });
  afterAll(() => { for (const tenant of tenants) db.execute(`update private.sales_campaigns set state='STOPPED'where tenant_id='${tenant}';update public.tenants set status='suspended'where id='${tenant}'and slug like 'campaign-uat-%';`); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  function setup(n: number) {
    const tenant = id(n, "2000"), campaign = id(n, "9000"), at = Date.now();
    const helpers = readFileSync("supabase/tests/helpers/campaign_fixtures.sql", "utf8").replace("\\ir polat_inbound_fixtures.sql", () => readFileSync("supabase/tests/helpers/polat_inbound_fixtures.sql", "utf8"));
    db.execute(`begin;${helpers}select pg_temp.campaign_setup(${n},false);update public.tenants set slug='campaign-uat-${n}'where id='${tenant}';select public.admin_campaign_save_v1('${tenant}','${campaign}',((select configuration from private.sales_campaigns where id='${campaign}')||'{"mode":"CONTROLLED_TEST","budget_amount":"5.000000","maximum_liability_per_call":"1.100000","maximum_model_calls":4}'::jsonb)::text,1);commit;`);
    tenants.add(tenant); fake.bot = `${9200000 + n}:SYNTHETIC_CAMPAIGN_BOT_KEY_ONLY`;
    fake.chat = "710000" + n; fake.representative = String(8300000 + n); fake.business = "synthetic-campaign-business-" + n;
    fake.organization = "org-campaign-" + n; fake.project = "proj_campaign_" + n;
    fake.calls = 0; fake.sends = 0; fake.wire = null; fake.modelStatus = 200; fake.timeout = false; fake.sendUnknown = false; fake.rateLimit = false; fake.permission = true; fake.afterModel = null;
    vi.stubEnv("POLAT_UAT_TELEGRAM_BOT_TOKEN", fake.bot);
    const config = db.query(`select configuration from private.sales_campaigns where id='${campaign}'`) as Record<string, unknown>;
    const credentialHash = createHash("sha256").update(fake.key).digest("hex"), accountHash = polatGuardDigest(["OPENAI_PROJECT1", fake.organization, fake.project]);
    const binding = { version: 3, mode: "FOUNDER_CAMPAIGN", tenant_id: tenant, campaign_id: campaign, provider: "openai", model: "gpt-6.1-sol", model_version: "gpt-6.1-sol", protocol_version: "responses-v1", repository_sha: SHA,
      configuration_hash: polatGuardDigest(config), account_scope_hash: accountHash, authorization_record_hash: polatGuardDigest(["SYNTHETIC_CAMPAIGN_GRANT", campaign]), manifest_hash: "b".repeat(64), policy_hash: "c".repeat(64), credential_custody_hash: polatGuardDigest(["POLAT_CAMPAIGN_CREDENTIAL1", accountHash, credentialHash]),
      maximum_requests: 4, maximum_spend: "5.000000", maximum_attempt_liability: "1.100000", currency: "USD", maximum_output_tokens: 512, timeout_ms: 10000, expires_at: config.expires_at, financial_authority: "NONE" };
    const account = { version: 1, origin: "INDEPENDENT_CAMPAIGN_ACCOUNT_CONTROL", tenant_id: tenant, campaign_id: campaign, binding_hash: polatGuardDigest(binding), organization_id: fake.organization, project_id: fake.project, credential_sha256: credentialHash,
      model_access: true, effective_limit_kind: "ENFORCED_CAMPAIGN_HARD_CAP", enforced_maximum_spend: "5", independently_observed_spend: "0", remaining_allowance: "5", currency: "USD", unknown_outcome_count: 0,
      data_policy_evidence_hash: "d".repeat(64), billing_evidence_hash: "e".repeat(64), canary_reconciliation_hash: "f".repeat(64),
      pricing: { maximum_input_tokens: 1050000, maximum_input_usd_per_million: "1", maximum_output_usd_per_million: "1", all_billable_components_covered: true, source_hash: "1".repeat(64) }, observed_at: new Date(at).toISOString(), expires_at: new Date(at + 300000).toISOString() };
    const transport = { version: 1, mode: "CAMPAIGN_BUSINESS", tenant_id: tenant, campaign_id: campaign, repository_sha: SHA, bot_id: fake.bot.split(":")[0], credential_sha256: createHash("sha256").update(fake.bot).digest("hex"), representative_user_id: fake.representative,
      business_connection_id: fake.business, connection_generation: "1", observed_at: new Date(at).toISOString(), expires_at: new Date(at + 3600000).toISOString() };
    db.execute(`begin;select private.campaign_control_record('${tenant}','${campaign}',${quote(JSON.stringify({ binding, account, transport, scope: "CONTROLLED_TEST", source_hash: "2".repeat(64) }))});update public.messaging_provider_connections set provider_account_ref='${fake.bot.split(":")[0]}'where tenant_id='${tenant}';commit;`);
    const claims = JSON.stringify({ sub: "61ca1000-0000-4000-8000-000000000001", aal: "aal2", role: "authenticated", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] });
    db.query(`begin;set local role authenticated;set local request.jwt.claims=${quote(claims)};select public.admin_campaign_state_v1('${tenant}','${campaign}',2,'START');commit;`);
    return { tenant, campaign, n, binding, account, transport, claims };
  }
  function inbound(s: ReturnType<typeof setup>, text = "Hi", ordinal = 2) {
    return service(`public.campaign_ingest_business_v1('${s.tenant}','${s.campaign}',${quote(JSON.stringify({ kind: "INBOUND", update_id: String(ordinal), connection_id: fake.business, source_hash: polatGuardDigest([s.n, text, ordinal]), occurred_at: new Date().toISOString(), user_id: fake.chat, chat_id: fake.chat, message_id: String(ordinal), text, reply_to_id: null }))})`) as { accepted: boolean; duplicate: boolean; conversation_id: string; message_id: string; event_id: string };
  }
  async function run(s: ReturnType<typeof setup>, conversation: string) {
    return runDeterministicWorker({ conversation: { tenantId: s.tenant, conversationId: conversation }, polatCampaign: { campaignId: s.campaign } });
  }
  function concurrentSql(expression: string) {
    return new Promise<{ pid: number; result: unknown }>((resolve, reject) => {
      const child = spawn("psql", [connection!, "-XAtq", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
      let output = "", errors = "";
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); }); child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
      const timer = setTimeout(() => { child.kill(); reject(Error("LOCAL_CONCURRENCY_TIMEOUT")); }, 15000);
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", code => { clearTimeout(timer); if (code !== 0) reject(Error(errors.slice(0,800))); else { try { resolve(JSON.parse(output.trim()) as { pid: number; result: unknown }); } catch (error) { reject(error); } } });
      child.stdin.end(`begin;set local statement_timeout='10s';set local role service_role;select jsonb_build_object('pid',pg_backend_pid(),'result',${expression});commit;`);
    });
  }
  it("existing START -> persisted inbound -> actual codec output -> native QA -> provider ACK history/CRM", async () => {
    const s = setup(97101 + seed), source = inbound(s);
    const result = await run(s, source.conversation_id);
    expect(result).toMatchObject({ tasksClaimed: 1, tasksFailed: 0 });
    expect(fake.calls).toBe(1); expect(fake.sends).toBe(1);
    expect(db.query(`select jsonb_build_object('status',status,'provider_message_id',provider_message_id)from public.messages where tenant_id='${s.tenant}'and direction='outbound'`)).toEqual({ status: "sent", provider_message_id: "7001" });
    expect(db.query(`select coalesce(to_jsonb(payload->>'actual_billed_amount'),'null'::jsonb)from private.polat_experiment_evidence where tenant_id='${s.tenant}'and stage='PROVIDER_RESULT'`)).toBeNull();
    expect(db.query(`select to_jsonb(count(*))from private.verified_payment_receipts where tenant_id='${s.tenant}'`)).toBe(0);
    expect(inbound(s).duplicate).toBe(true);
    expect((await run(s, source.conversation_id)).tasksClaimed).toBe(0); expect(fake.calls).toBe(1);
    // Each build re-derives history from provider-acknowledged messages.
    const second = inbound(s, "What is your name?", 3);
    const claimed = await fake.db!.rpc("claim_campaign_tasks_v1", { target_tenant_id: s.tenant, target_conversation_id: source.conversation_id, worker_id_value: "context_only_worker" });
    expect(claimed.error).toBeNull();
    expect(claimed.data).toHaveLength(1);
    const scope = await fake.db!.rpc("campaign_source_scope_v1", { target_tenant_id: s.tenant, target_conversation_id: source.conversation_id, target_event_id: second.event_id });
    const context = await buildAgentContext({ tenant_id: s.tenant, customer_id: id(s.n, "5000"), conversation_id: source.conversation_id, source_event_id: second.event_id }, { polatCampaign: scope.data });
    expect(context.context.recentMessages.some(m => m.direction === "outbound" && m.content.includes("Polat"))).toBe(true);
  }, 30000);
  it.each(["MODEL_UNKNOWN", "TELEGRAM_UNKNOWN", "QA_UNSAFE", "PERMISSION_LOST", "STOP_RACE", "OPT_OUT_RACE"])("%s never becomes fixture success or a blind retry", async (kind) => {
    const n = 97110 + ["MODEL_UNKNOWN", "TELEGRAM_UNKNOWN", "QA_UNSAFE", "PERMISSION_LOST", "STOP_RACE", "OPT_OUT_RACE"].indexOf(kind);
    const s = setup(n + seed), source = inbound(s);
    if (kind === "MODEL_UNKNOWN") fake.timeout = true;
    if (kind === "TELEGRAM_UNKNOWN") fake.sendUnknown = true;
    if (kind === "PERMISSION_LOST") fake.permission = false;
    if (kind === "QA_UNSAFE") { const wire = polatClaudeFixtureWire(); wire.proposed_response = "I guarantee trading profits and your VIP is active."; fake.wire = wire; }
    if (kind === "STOP_RACE") fake.afterModel = () => db.execute(`update private.sales_campaigns set state='STOPPED',revision=revision+1 where id='${s.campaign}';`);
    if (kind === "OPT_OUT_RACE") fake.afterModel = () => { fake.afterModel = null; inbound(s, "Do not contact me again", 3); };
    await run(s, source.conversation_id);
    expect(fake.calls).toBe(1);
    expect(fake.sends).toBe(kind === "TELEGRAM_UNKNOWN" ? 1 : 0);
    expect(db.query(`select to_jsonb(count(*))from public.messages where tenant_id='${s.tenant}'and direction='outbound'and status='sent'`)).toBe(0);
    await run(s, source.conversation_id).catch(() => undefined);
    expect(fake.calls).toBe(1);
    expect(db.query(`select to_jsonb(reserved_liability::text)from private.sales_campaigns where id='${s.campaign}'`)).toBe("1.100000");
  }, 30000);
  it("independent PG connections serialize concurrent claims, reservations and starts", async () => {
    const s = setup(97120 + seed), source = inbound(s);
    const claim = `(select coalesce(jsonb_agg(x),'[]')from public.claim_campaign_tasks_v1('${s.tenant}','${source.conversation_id}','concurrent_owner')x)`;
    const claims = await Promise.all([concurrentSql(claim), concurrentSql(claim)]);
    expect(claims[0]!.pid).not.toBe(claims[1]!.pid);
    expect(claims.flatMap(c => c.result as unknown[])).toHaveLength(1);
    const task = (claims.find(c => (c.result as unknown[]).length)!.result as Array<{ task_id: string }>)[0]!;
    const scope = await fake.db!.rpc("campaign_source_scope_v1", { target_tenant_id: s.tenant, target_conversation_id: source.conversation_id, target_event_id: source.event_id });
    const built = await buildAgentContext({ tenant_id: s.tenant, customer_id: id(s.n, "5000"), conversation_id: source.conversation_id, source_event_id: source.event_id }, { polatCampaign: scope.data });
    const runId = service(`public.begin_agent_run('${s.tenant}','${task.task_id}','concurrent_owner',${quote(JSON.stringify(built.manifest))}::jsonb)`) as string;
    const profile = preparePolatCampaignRuntime(built.context, runId, scope.data), wire = preparePolatOpenAIRequest(profile.request, 512);
    const jobId = (scope.data as { job_id: string }).job_id;
    const reserve = `public.campaign_reserve_model_v1('${s.tenant}','${s.campaign}','${jobId}','${runId}','${wire.request_hash}','${wire.body_hash}')`;
    const reservations = await Promise.all([concurrentSql(reserve), concurrentSql(reserve)]);
    const values = reservations.map(r => r.result as { replay: boolean; attempt_id: string });
    expect(values.map(v => v.replay).sort()).toEqual([false, true]);
    expect(new Set(values.map(v => v.attempt_id)).size).toBe(1);
    const attempt = values[0]!.attempt_id, nonce = "3acb1000-0000-4000-8000-000000000001";
    const begin = `public.campaign_begin_model_v1('${s.tenant}','${s.campaign}','${attempt}','${nonce}')`;
    const starts = await Promise.all([concurrentSql(begin), concurrentSql(begin)]);
    expect(starts.map(r => (r.result as { dispatch: boolean }).dispatch).sort()).toEqual([false, true]);
    expect(db.query(`select to_jsonb(count(*))from private.polat_experiment_evidence where tenant_id='${s.tenant}'and stage='DISPATCH_STARTED'`)).toBe(1);
    expect(fake.calls).toBe(0);
  }, 30000);
  it("a documented Telegram 429 recovers without regenerating or resetting the reserved model budget", async () => {
    const s=setup(97122+seed),source=inbound(s);fake.rateLimit=true;
    await run(s,source.conversation_id);expect(fake.calls).toBe(1);expect(fake.sends).toBe(1);
    expect(db.query(`select to_jsonb(status)from public.messages where tenant_id='${s.tenant}'and direction='outbound'`)).toBe("retry_scheduled");
    db.execute(`update public.messages set retry_after_at=clock_timestamp()-interval '1 second'where tenant_id='${s.tenant}'and status='retry_scheduled';`);
    const pending=service(`public.campaign_recover_delivery_v1('${s.tenant}','${s.campaign}','${source.conversation_id}')`)as{message_id:string};
    fake.rateLimit=false;expect((await dispatchCampaignMessage(s.tenant,s.campaign,pending.message_id)).status).toBe("sent");
    expect(fake.calls).toBe(1);expect(fake.sends).toBe(2);
    expect(db.query(`select to_jsonb(attempts)from private.sales_campaigns where id='${s.campaign}'`)).toBe(1);
    expect((await dispatchCampaignMessage(s.tenant,s.campaign,pending.message_id)).status).toBe("blocked");expect(fake.sends).toBe(2);
  },30000);
  it("authenticated human takeover sends branded support through the SAME Business identity; return fences old sources",async()=>{
    const s=setup(97123+seed),source=inbound(s);
    const owner=(expression:string)=>db.query(`begin;set local role authenticated;set local request.jwt.claims=${quote(s.claims)};select to_jsonb(${expression});commit;`);
    owner(`public.set_conversation_runtime_mode('${s.tenant}','${source.conversation_id}','HUMAN_TAKEOVER','Synthetic founder takeover','3acb1000-0000-4000-8000-000000000003')`);
    const queued=owner(`public.admin_campaign_queue_manual_v1('${s.tenant}','${s.campaign}','${source.conversation_id}','I can help with your question.','synthetic-manual-command','3acb1000-0000-4000-8000-000000000004',null)`)as{message_id:string};
    expect((await dispatchCampaignMessage(s.tenant,s.campaign,queued.message_id)).status).toBe("sent");expect(fake.calls).toBe(0);
    const message=db.query(`select jsonb_build_object('content',content,'actor',actor_id)from public.messages where id='${queued.message_id}'`)as{content:string;actor:string};
    expect(message.content).toBe("Polat Support: I can help with your question.");expect(message.actor).toBe("61ca1000-0000-4000-8000-000000000001");
    owner(`public.set_conversation_automatic_replies('${s.tenant}','${source.conversation_id}',true,'3acb1000-0000-4000-8000-000000000005')`);
    expect((await run(s,source.conversation_id)).tasksClaimed).toBe(0);expect(fake.calls).toBe(0);
    const fresh=inbound(s,"Hi",3);expect((await run(s,fresh.conversation_id)).tasksFailed).toBe(0);expect(fake.calls).toBe(1);
  },30000);
  it("new RPCs/private custody deny browser and service-role control writes; founder summary is redacted",()=>{
    const s=setup(97125+seed);
    const grants=db.query(`select jsonb_build_object('browser_control',has_function_privilege('authenticated','public.campaign_execution_control_v1(uuid,uuid)','execute'),'browser_send',has_function_privilege('authenticated','public.campaign_claim_reply_v1(uuid,uuid,uuid)','execute'),'service_control',has_function_privilege('service_role','private.campaign_control_record(uuid,uuid,text)','execute'),'raw_table',has_table_privilege('authenticated','private.campaign_execution_controls','select'))`);
    expect(grants).toEqual({browser_control:false,browser_send:false,service_control:false,raw_table:false});
    const workspace=db.query(`begin;set local role authenticated;set local request.jwt.claims=${quote(s.claims)};select public.admin_campaign_workspace_v1('${s.tenant}',null);commit;`);
    const raw=JSON.stringify(workspace);expect(raw).not.toContain(fake.key);expect(raw).not.toContain(fake.bot);expect(raw).not.toContain(s.account.credential_sha256);expect(raw).not.toContain(s.transport.business_connection_id);
    expect(raw).toContain('READY_TO_DISPATCH');
  },30000);
  it("a crashed worker lease becomes UNKNOWN and pauses instead of being re-dispatched",async()=>{
    const s=setup(97124+seed),source=inbound(s);
    const claim=await fake.db!.rpc("claim_campaign_tasks_v1",{target_tenant_id:s.tenant,target_conversation_id:source.conversation_id,worker_id_value:"crashed_campaign_worker"});expect((claim.data as unknown[])).toHaveLength(1);
    db.execute(`update public.scheduled_jobs set locked_at=clock_timestamp()-interval '121 seconds'where tenant_id='${s.tenant}'and status='processing';update public.agent_tasks set locked_at=clock_timestamp()-interval '121 seconds'where tenant_id='${s.tenant}'and task_type='campaign.reply'and status='RUNNING';`);
    expect((await run(s,source.conversation_id)).tasksClaimed).toBe(0);expect(fake.calls).toBe(0);
    expect(db.query(`select jsonb_build_object('state',state,'attempts',attempts)from private.sales_campaigns where id='${s.campaign}'`)).toEqual({state:"PAUSED",attempts:1});
    expect(db.query(`select to_jsonb(status)from public.agent_tasks where tenant_id='${s.tenant}'and task_type='campaign.reply'`)).toBe("DEAD_LETTER");
    expect(db.query(`select to_jsonb(attention_required)from public.conversations where tenant_id='${s.tenant}'`)).toBe(true);
    expect(db.query(`select to_jsonb(last_error_code)from public.scheduled_jobs where tenant_id='${s.tenant}'and status='dead_letter'`)).toBe("DELIVERY_UNKNOWN");
  },30000);
});
