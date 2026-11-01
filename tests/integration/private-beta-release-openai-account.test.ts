import { afterEach, describe, expect, it, vi } from "vitest";
import { observeOpenAIProjectHardLimit, observePrivateBetaOpenAIAccount, observeConfiguredOpenAIModel, privateBetaOpenAIAccountQuery } from "../../scripts/private-beta-release-openai-account.mjs";
import { polatGuardDigest } from "../../packages/domain/src/polat-experiment-journal";

const DATABASE = "https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query", MODEL = "https://api.openai.com/v1/models/gpt-6.1-sol";
const programId = "91bf9000-0000-4000-8000-000000007001", tenantId = "91bf1000-0000-4000-8000-000000007001", SHA = "a".repeat(40);
const KEY = "SYNTHETIC_EXISTING_OPENAI_KEY_PRIVATE", MANAGEMENT = "SYNTHETIC_SUPABASE_ACCESS_PRIVATE";
const env = (): Record<string, string | undefined> => ({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "AlisanMedia/GOLD-REVENUE-OS-PRO", GITHUB_SHA: SHA, VALIDATED_SHA: SHA,
  PRIVATE_BETA_PROGRAM_ID: programId, SUPABASE_ACCESS_TOKEN: MANAGEMENT, OPENAI_API_KEY: KEY, OPENAI_UAT_ORGANIZATION_ID: "org-fixture", OPENAI_UAT_PROJECT_ID: "proj_fixture" });
const program = () => [{ private_beta_program: { program_id: programId, tenant_id: tenantId, repository_sha: SHA, starts_at: "2026-10-27T00:00:00Z", expires_at: "2026-10-27T01:00:00Z", stage: "DRAFT", model_provider: "openai", model_name: "gpt-6.1-sol", notice_version: "polat-private-beta-notice-openai-v1" } }];
const model = () => ({ id: "gpt-6.1-sol", object: "model", created: 1793059200, owned_by: "openai" });
function json(url: string, value: unknown, status = 200) {
  const response = new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); Object.defineProperty(response, "url", { value: url }); return response;
}
function request() { return vi.fn<typeof fetch>(async (input) => { const url = String(input); return url === DATABASE ? json(url, program()) : json(url, model()); }); }
afterEach(() => vi.useRealTimers());

describe("protected diagnostic before an account/program has been configured", () => {
  it("makes one fixed GET with the existing key; no DB, inference, project or spending authority", async () => {
    const input = env(); delete input.PRIVATE_BETA_PROGRAM_ID; delete input.SUPABASE_ACCESS_TOKEN;
    delete input.OPENAI_UAT_ORGANIZATION_ID; delete input.OPENAI_UAT_PROJECT_ID;
    const http = request(), result = await observeConfiguredOpenAIModel({ env: input, request: http });
    expect(result).toMatchObject({ state: "OBSERVED", provider_status: 200, model_metadata_requests: 1, actual_inference_requests: 0,
      account_scope_hash: null, effective_experiment_cap: "UNVERIFIED", genuine_execution_authority: "BLOCKED", database_authority_written: false });
    expect(http).toHaveBeenCalledOnce(); expect(http.mock.calls[0]![0]).toBe(MODEL); expect(http.mock.calls[0]![1]?.method).toBe("GET");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
  it.each([401,403,404,429,500])("retains HTTP %s with zero retry and no provider-body leakage", async status => {
    const http = vi.fn<typeof fetch>(async () => json(MODEL, { error: { message: KEY } }, status));
    const result = await observeConfiguredOpenAIModel({ env: env(), request: http });
    expect(result).toMatchObject({ state: "BLOCKED", provider_status: status, model_metadata_requests: 1, actual_inference_requests: 0 });
    expect(http).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain(KEY);
  });
  it("denies a nonprotected SHA before reading the configured account", async () => {
    const input = env(); input.GITHUB_SHA = "b".repeat(40); const http = request();
    expect(await observeConfiguredOpenAIModel({ env: input, request: http })).toMatchObject({ state: "BLOCKED", model_metadata_requests: 0 });
    expect(http).not.toHaveBeenCalled();
  });
});

describe("protected OpenAI account observation, offline HTTP boundaries only", () => {
  it("reads only the exact owned program and one fixed model GET, keeping every genuine gate blocked", async () => {
    const http = request(), result = await observePrivateBetaOpenAIAccount({ env: env(), request: http, now: () => Date.parse("2026-10-27T00:00:00Z") });
    expect(result).toMatchObject({ state: "OBSERVED", model_access: "OBSERVED", model_metadata_requests: 1, actual_inference_requests: 0, genuine_execution_authority: "BLOCKED", provider_account_authority: "UNVERIFIED", effective_experiment_cap: "UNVERIFIED", actual_billed_amount: null, database_authority_written: false, financial_authority: "NONE", commercial_pilot: "NO_GO" });
    expect(result.account_scope_hash).toBe(polatGuardDigest(["OPENAI_PROJECT1", "org-fixture", "proj_fixture"])); expect(result.credential_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(http).toHaveBeenCalledTimes(2); expect(http.mock.calls[0]![0]).toBe(DATABASE); expect(http.mock.calls[1]![0]).toBe(MODEL);
    expect(http.mock.calls[0]![1]).toMatchObject({ method: "POST", redirect: "error" }); expect(http.mock.calls[1]![1]).toMatchObject({ method: "GET", redirect: "error", headers: { "OpenAI-Organization": "org-fixture", "OpenAI-Project": "proj_fixture" } });
    expect(String(http.mock.calls[0]![1]?.body)).toContain("select jsonb_build_object"); expect(String(http.mock.calls[0]![1]?.body)).not.toMatch(/insert|update|delete|grant/iu);
    expect(JSON.stringify(result)).not.toContain(KEY); expect(JSON.stringify(result)).not.toContain(MANAGEMENT); expect(JSON.stringify(result)).not.toContain("org-fixture"); expect(JSON.stringify(result)).not.toContain("proj_fixture");
  });
  it.each(["branch", "sha", "repo", "actions", "event", "program", "key", "scope", "header-injection"])("blocks %s without issuing any HTTP request", async field => {
    const config = env(), http = request();
    if (field === "branch") config.GITHUB_REF = "refs/heads/feature"; if (field === "sha") config.GITHUB_SHA = "b".repeat(40); if (field === "repo") config.GITHUB_REPOSITORY = "foreign/repository"; if (field === "actions") config.GITHUB_ACTIONS = "false"; if (field === "event") config.GITHUB_EVENT_NAME = "pull_request";
    if (field === "program") config.PRIVATE_BETA_PROGRAM_ID = "' or true--"; if (field === "key") delete config.OPENAI_API_KEY; if (field === "scope") delete config.OPENAI_UAT_PROJECT_ID; if (field === "header-injection") config.OPENAI_UAT_ORGANIZATION_ID = "org-safe\r\nother: value";
    expect(await observePrivateBetaOpenAIAccount({ env: config, request: http })).toMatchObject({ state: "BLOCKED", actual_inference_requests: 0, model_metadata_requests: 0 }); expect(http).not.toHaveBeenCalled();
  });
  it.each(["missing", "foreign", "sha", "claude", "model", "notice"])("does not proceed from %s program data to the provider", async field => {
    const p = program(); if (field === "foreign") p[0]!.private_beta_program.program_id = tenantId; if (field === "sha") p[0]!.private_beta_program.repository_sha = "b".repeat(40); if (field === "claude") p[0]!.private_beta_program.model_provider = "anthropic"; if (field === "model") p[0]!.private_beta_program.model_name = "gpt-6-luna"; if (field === "notice") p[0]!.private_beta_program.notice_version = "polat-private-beta-notice-v1";
    const http = vi.fn<typeof fetch>(async () => json(DATABASE, field === "missing" ? [] : p));
    expect(await observePrivateBetaOpenAIAccount({ env: env(), request: http })).toMatchObject({ state: "BLOCKED", model_metadata_requests: 0 }); expect(http).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 404, 429, 500])("makes no retry or inference on model HTTP %i", async status => {
    const http = vi.fn<typeof fetch>(async input => String(input) === DATABASE ? json(DATABASE, program()) : json(MODEL, { error: { message: KEY } }, status));
    const result = await observePrivateBetaOpenAIAccount({ env: env(), request: http });
    expect(result).toMatchObject({ state: "BLOCKED", model_metadata_requests: 1, actual_inference_requests: 0, actual_billed_amount: null }); expect(http).toHaveBeenCalledTimes(2); expect(JSON.stringify(result)).not.toContain(KEY);
  });
  it("rejects malformed/mismatched model metadata without inventing account eligibility", async () => {
    for (const metadata of [{ ...model(), id: "gpt-6-luna" }, { ...model(), object: "response" }, { ...model(), created: -1 }, {}]) {
      const http = vi.fn<typeof fetch>(async input => String(input) === DATABASE ? json(DATABASE, program()) : json(MODEL, metadata));
      expect(await observePrivateBetaOpenAIAccount({ env: env(), request: http })).toMatchObject({ state: "BLOCKED", reason: "OPENAI_MODEL_METADATA_INVALID", actual_inference_requests: 0 });
    }
  });
  it("rejects duplicate JSON keys before any program/model interpretation", async () => {
    const response = new Response('[{"private_beta_program":{},"private_beta_program":{}}]', { headers: { "content-type": "application/json" } }); Object.defineProperty(response, "url", { value: DATABASE });
    const http = vi.fn<typeof fetch>(async () => response);
    expect(await observePrivateBetaOpenAIAccount({ env: env(), request: http })).toMatchObject({ state: "BLOCKED", reason: "OPENAI_PREFLIGHT_JSON_INVALID", model_metadata_requests: 0 }); expect(http).toHaveBeenCalledOnce();
  });
  it("rejects duplicate model identity fields and never imports provider metadata as execution approval", async () => {
    const duplicate = new Response('{"id":"gpt-6.1-sol","id":"gpt-6-luna","object":"model","created":1,"owned_by":"openai"}', { headers: { "content-type": "application/json" } }); Object.defineProperty(duplicate, "url", { value: MODEL });
    const a = vi.fn<typeof fetch>(async input => String(input) === DATABASE ? json(DATABASE, program()) : duplicate);
    expect(await observePrivateBetaOpenAIAccount({ env: env(), request: a })).toMatchObject({ state: "BLOCKED", reason: "OPENAI_PREFLIGHT_JSON_INVALID", model_metadata_requests: 1 });
    const b = vi.fn<typeof fetch>(async input => String(input) === DATABASE ? json(DATABASE, program()) : json(MODEL, { ...model(), execution_enabled: true, verified: true, remaining_allowance: "9999" }));
    expect(await observePrivateBetaOpenAIAccount({ env: env(), request: b })).toMatchObject({ state: "OBSERVED", genuine_execution_authority: "BLOCKED", effective_experiment_cap: "UNVERIFIED", actual_inference_requests: 0 });
  });
  it("bounds response bytes, source URL and timeout without reading/logging credentials", async () => {
    for (const frame of [json("https://example.test", program()), json(DATABASE, { padding: "x".repeat(17000) })]) {
      const http = vi.fn<typeof fetch>(async () => frame); expect(await observePrivateBetaOpenAIAccount({ env: env(), request: http })).toMatchObject({ state: "BLOCKED", actual_inference_requests: 0 }); expect(http).toHaveBeenCalledOnce();
    }
  });
  it("times out an injected unresponsive boundary rather than hanging or retrying", async () => {
    vi.useFakeTimers(); const http = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const pending = observePrivateBetaOpenAIAccount({ env: env(), request: http }); await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({ state: "BLOCKED", reason: "OPENAI_PREFLIGHT_TIMEOUT", actual_inference_requests: 0 }); expect(http).toHaveBeenCalledOnce();
  });
  it("bounds a stalled provider body as well as the initial request", async () => {
    vi.useFakeTimers();
    const partial = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"id":')); } }), { headers: { "content-type": "application/json" } }); Object.defineProperty(partial, "url", { value: MODEL });
    const http = vi.fn<typeof fetch>(async input => String(input) === DATABASE ? json(DATABASE, program()) : partial);
    const pending = observePrivateBetaOpenAIAccount({ env: env(), request: http }); await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({ state: "BLOCKED", reason: "OPENAI_PREFLIGHT_TIMEOUT", model_metadata_requests: 1, actual_inference_requests: 0 }); expect(http).toHaveBeenCalledTimes(2);
  });
  it("redacts network error strings and ignores attempted host/authority overrides", async () => {
    const http = vi.fn<typeof fetch>(async () => { throw Error(KEY); }); const config = { ...env(), OPENAI_BASE_URL: "https://example.test", VERIFIED_ACCOUNT: "true", REPORTED_BALANCE: "9999" };
    const result = await observePrivateBetaOpenAIAccount({ env: config, request: http }); expect(result).toMatchObject({ state: "BLOCKED", genuine_execution_authority: "BLOCKED", effective_experiment_cap: "UNVERIFIED" }); expect(JSON.stringify(result)).not.toContain(KEY); expect(http.mock.calls[0]![0]).toBe(DATABASE);
  });
  it("rejects SQL injection, never treats a query literal as a writer or reads raw control/secret rows", () => {
    expect(() => privateBetaOpenAIAccountQuery("' or true--")).toThrow("OWNED_PROGRAM_REQUIRED");
    const query = privateBetaOpenAIAccountQuery(programId); expect(query).toContain(`p.id='${programId}'::uuid`); expect(query).not.toMatch(/account_control|pricing_control|credential|secret|cursor_secret|select \*/iu);
  });
});

describe('independent OpenAI project monthly-limit reader, offline Admin HTTP boundary', () => {
  const ADMIN = 'SYNTHETIC_ADMIN_READ_CREDENTIAL';
  const root = 'https://api.openai.com/v1/organization/projects/proj_owned';
  const cfg = () => ({ ...env(), OPENAI_UAT_PROJECT_ID: 'proj_owned', OPENAI_UAT_ADMIN_KEY: ADMIN });
  const project = () => ({ id: 'proj_owned', object: 'organization.project', status: 'active', name: 'Synthetic project only' });
  const limit = () => ({ object: 'project.spend_limit', currency: 'USD', interval: 'month', threshold_amount: 500, enforcement: { status: 'enforcing' } });
  function http(p: unknown = project(), cap: unknown = limit()) { return vi.fn<typeof fetch>(async url => json(String(url), String(url) === root ? p : cap)); }
  function rawLimit(raw: string) {
    return vi.fn<typeof fetch>(async url => {
      if (String(url) === root) return json(root, project());
      const response = new Response(raw, { headers: { 'content-type': 'application/json' } });
      Object.defineProperty(response, 'url', { value: root + '/spend_limit' });
      return response;
    });
  }
  it('uses only the Admin credential on two fixed GETs, observes exact cents and leaves execution/account/billing authority unverified', async () => {
    const request = http(), result = await observeOpenAIProjectHardLimit({ env: cfg(), request });
    expect(result).toMatchObject({ state: 'OBSERVED', monthly_hard_limit_usd: '5.00', control_metadata_requests: 2, enforcement_delay_possible: true, genuine_execution_authority: 'BLOCKED', provider_account_authority: 'UNVERIFIED', effective_experiment_cap: 'UNVERIFIED', billing: 'UNKNOWN', actual_billed_amount: null, database_authority_written: false, actual_inference_requests: 0 });
    expect(request.mock.calls.map(c => c[0])).toEqual([root,root+'/spend_limit']);
    for (const [,init] of request.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
      expect(init?.headers).toEqual({ authorization: 'Bearer ' + ADMIN, 'OpenAI-Organization': 'org-fixture', accept: 'application/json' });
      expect(init?.body).toBeUndefined();
    }
    expect(JSON.stringify(result)).not.toContain(ADMIN); expect(JSON.stringify(result)).not.toContain('Synthetic project only');
    expect(JSON.stringify(result)).not.toContain(KEY); expect(JSON.stringify(result)).not.toContain(MANAGEMENT);
    expect(JSON.stringify(result)).not.toContain('org-fixture'); expect(JSON.stringify(result)).not.toContain('proj_owned');
    expect(result.account_scope_hash).toBe(polatGuardDigest(['OPENAI_PROJECT1', 'org-fixture', 'proj_owned']));
    expect(result.project_response_hash).toMatch(/^[a-f0-9]{64}$/u); expect(result.limit_response_hash).toMatch(/^[a-f0-9]{64}$/u);
  });
  it('requires no program, database credential or ordinary inference credential for the independent Admin reads', async () => {
    const config: Record<string, string | undefined> = cfg();
    delete config.PRIVATE_BETA_PROGRAM_ID; delete config.SUPABASE_ACCESS_TOKEN; delete config.OPENAI_API_KEY;
    const request = http();
    expect(await observeOpenAIProjectHardLimit({ env: config, request })).toMatchObject({ state: 'OBSERVED', actual_inference_requests: 0, database_authority_written: false });
    expect(request.mock.calls.map(call => call[0])).toEqual([root, root + '/spend_limit']);
  });
  it.each([undefined, null, 'future-region', ADMIN, 'GLOBAL', 'EU_STORAGE_PROCESSING'])('projects only a recognized official residency without inferring missing policy (%j)', async residency => {
    const result = await observeOpenAIProjectHardLimit({ env: cfg(), request: http({ ...project(), residency }) });
    expect(result).toMatchObject({ state: 'OBSERVED', project_residency: residency === 'GLOBAL' || residency === 'EU_STORAGE_PROCESSING' ? residency : 'UNKNOWN', genuine_execution_authority: 'BLOCKED', provider_account_authority: 'UNVERIFIED' });
    expect(result.unresolved).toContain('CURRENT_USAGE_BILLING_AND_DATA_POLICY_NOT_ESTABLISHED');
    expect(JSON.stringify(result)).not.toContain(ADMIN);
  });
  it('does not substitute an inference key, input flag or claimed limit for missing Admin authentication', async () => {
    const request = http();
    const result = await observeOpenAIProjectHardLimit({ env: { ...env(), OPENAI_UAT_ADMIN_KEY: undefined, FORCE_ENABLED: 'true', CLAIMED_HARD_LIMIT: '5.00' }, request });
    expect(result).toMatchObject({ state: 'BLOCKED', reason: 'OPENAI_ACCOUNT_ADMIN_READ_KEY_REQUIRED', control_metadata_requests: 0 }); expect(request).not.toHaveBeenCalled();
  });
  it.each([1,5,99,100,500])('preserves the official integer-cent unit for %i cents', async cents => {
    const result = await observeOpenAIProjectHardLimit({ env: cfg(), request: http(project(),{...limit(),threshold_amount:cents}) });
    expect(result.monthly_hard_limit_usd).toBe(String(Math.floor(cents/100))+'.'+String(cents%100).padStart(2,'0')); expect(result.state).toBe('OBSERVED');
  });
  it.each([0,-1,501,50000,5.5,'500',null])('holds unsupported or excessive threshold %j without inventing a cap', async amount => {
    const request = http(project(),{...limit(),threshold_amount:amount});
    const result = await observeOpenAIProjectHardLimit({ env: cfg(), request });
    expect(result).toMatchObject({ state: 'BLOCKED', reason: 'OPENAI_PROJECT_HARD_LIMIT_UNVERIFIED', actual_billed_amount: null }); expect(result).not.toHaveProperty('monthly_hard_limit_usd'); expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['500.000000000000000001', 'OPENAI_PROJECT_HARD_LIMIT_UNVERIFIED'],
    ['499.999999999999999999', 'OPENAI_PROJECT_HARD_LIMIT_UNVERIFIED'],
    ['0.999999999999999999', 'OPENAI_PROJECT_HARD_LIMIT_UNVERIFIED'],
    ['5.0', 'OPENAI_PROJECT_HARD_LIMIT_UNVERIFIED'],
    ['5e2', 'OPENAI_PREFLIGHT_JSON_INVALID'],
    ['9007199254740992', 'OPENAI_PREFLIGHT_JSON_INVALID'],
  ])('rejects noncanonical integer-cent token %s before it can round into cap evidence', async (amount, reason) => {
    const raw = JSON.stringify(limit()).replace('"threshold_amount":500', '"threshold_amount":' + amount);
    const request = rawLimit(raw), result = await observeOpenAIProjectHardLimit({ env: cfg(), request });
    expect(result).toMatchObject({ state: 'BLOCKED', reason, control_metadata_requests: 2, actual_billed_amount: null });
    expect(result).not.toHaveProperty('monthly_hard_limit_usd'); expect(request).toHaveBeenCalledTimes(2);
  });
  it('uses the root amount and decoded field name; nested metadata cannot substitute integer-cent evidence', async () => {
    for (const amount of ['500.000000000000000001', 'null']) {
      const raw = JSON.stringify(limit()).replace('"threshold_amount":500', '"metadata":{"threshold_amount":500},"threshold_amount":' + amount);
      expect(await observeOpenAIProjectHardLimit({ env: cfg(), request: rawLimit(raw) })).toMatchObject({ state: 'BLOCKED', reason: 'OPENAI_PROJECT_HARD_LIMIT_UNVERIFIED' });
    }
    const escaped = JSON.stringify(limit()).replace('"threshold_amount":500', String.raw`"threshold_\u0061mount":5`);
    expect(await observeOpenAIProjectHardLimit({ env: cfg(), request: rawLimit(escaped) })).toMatchObject({ state: 'OBSERVED', monthly_hard_limit_usd: '0.05' });
    const duplicate = JSON.stringify(limit()).replace('"threshold_amount":500', String.raw`"threshold_amount":5,"threshold_\u0061mount":500`);
    expect(await observeOpenAIProjectHardLimit({ env: cfg(), request: rawLimit(duplicate) })).toMatchObject({ state: 'BLOCKED', reason: 'OPENAI_PREFLIGHT_JSON_INVALID' });
  });
  it.each(['currency','interval','inactive','unknown-enforcement','object'])('holds %s even when a response includes claimed permission flags', async mode => {
    const cap = { ...limit(), verified: true, execution_enabled: true };
    if(mode==='currency')cap.currency='EUR';if(mode==='interval')cap.interval='day';if(mode==='inactive')cap.enforcement.status='inactive';if(mode==='unknown-enforcement')cap.enforcement.status='future';if(mode==='object')cap.object='project.budget_alert';
    expect(await observeOpenAIProjectHardLimit({ env: cfg(), request: http(project(),cap) })).toMatchObject({ state: 'BLOCKED', genuine_execution_authority: 'BLOCKED' });
  });
  it.each(['foreign','archived','object'])('rejects %s project identity before reading a limit', async mode => {
    const p=project();if(mode==='foreign')p.id='proj_foreign';if(mode==='archived')p.status='archived';if(mode==='object')p.object='project.spend_limit';const request=http(p);
    expect(await observeOpenAIProjectHardLimit({ env: cfg(), request })).toMatchObject({ state: 'BLOCKED', reason: 'OPENAI_PROJECT_IDENTITY_UNVERIFIED' });expect(request).toHaveBeenCalledOnce();
  });
  it.each([401,403,429,500])('records Admin HTTP %i and never retries with the inference key', async status => {
    const request=vi.fn<typeof fetch>(async url=>json(String(url),{error:{message:ADMIN}},status));
    const result=await observeOpenAIProjectHardLimit({env:cfg(),request});expect(result).toMatchObject({state:'BLOCKED',project_http_status:status,control_metadata_requests:1});expect(request).toHaveBeenCalledOnce();expect(JSON.stringify(result)).not.toContain(ADMIN);
  });
  it.each([302,401,403,404,429,500])('records limit HTTP %i and stops after the two fixed Admin reads', async status => {
    const request = vi.fn<typeof fetch>(async url => String(url) === root ? json(root, project()) : json(root + '/spend_limit', { error: { message: ADMIN } }, status));
    const result = await observeOpenAIProjectHardLimit({ env: cfg(), request });
    expect(result).toMatchObject({ state: 'BLOCKED', project_http_status: 200, limit_http_status: status, control_metadata_requests: 2, database_authority_written: false });
    expect(request).toHaveBeenCalledTimes(2); expect(JSON.stringify(result)).not.toContain(ADMIN); expect(result).not.toHaveProperty('monthly_hard_limit_usd');
  });
  it.each([undefined, '', 'short', ADMIN + '\r\nInjected: value', ADMIN + '\0', 'x'.repeat(4097)])('rejects missing or malformed Admin credentials before any request (%j)', async key => {
    const request = http(), result = await observeOpenAIProjectHardLimit({ env: { ...cfg(), OPENAI_UAT_ADMIN_KEY: key }, request });
    expect(result).toMatchObject({ state: 'BLOCKED', reason: 'OPENAI_ACCOUNT_ADMIN_READ_KEY_REQUIRED', control_metadata_requests: 0 });
    expect(request).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain(ADMIN);
  });
  it('does not import provider permission flags, host overrides or a valid monthly cap into experiment authority', async () => {
    const config = { ...cfg(), OPENAI_BASE_URL: 'https://foreign.invalid', FORCE_ENABLED: 'true', VERIFIED_ACCOUNT: 'true' };
    const request = http(project(), { ...limit(), verified: true, execution_enabled: true, effective_experiment_cap: '5.00', actual_billed_amount: '0.00', private_secret: ADMIN });
    const result = await observeOpenAIProjectHardLimit({ env: config, request });
    expect(result).toMatchObject({ state: 'OBSERVED', monthly_hard_limit_usd: '5.00', actual_billed_amount: null, billing: 'UNKNOWN', genuine_execution_authority: 'BLOCKED', provider_account_authority: 'UNVERIFIED', effective_experiment_cap: 'UNVERIFIED', actual_inference_requests: 0, database_authority_written: false });
    expect(result.unresolved).toContain('MONTHLY_CAP_IS_NOT_TRANSACTIONAL_EXPERIMENT_AUTHORITY');
    expect(request.mock.calls.map(call => call[0])).toEqual([root, root + '/spend_limit']); expect(JSON.stringify(result)).not.toContain(ADMIN);
  });
  it('rejects a wrong source, duplicate keys and oversized frames without exposing transport diagnostics', async () => {
    for(const r of [json('https://foreign.invalid',project()),json(root,{filler:'x'.repeat(17000)})]){
      const request=vi.fn<typeof fetch>(async()=>r);expect((await observeOpenAIProjectHardLimit({env:cfg(),request})).state).toBe('BLOCKED');expect(request).toHaveBeenCalledOnce();
    }
    const duplicate=new Response('{"id":"proj_owned","id":"proj_foreign"}',{headers:{'content-type':'application/json'}});Object.defineProperty(duplicate,'url',{value:root});
    expect((await observeOpenAIProjectHardLimit({env:cfg(),request:vi.fn(async()=>duplicate)})).state).toBe('BLOCKED');
    const request=vi.fn<typeof fetch>(async()=>{throw Error(ADMIN);});const result=await observeOpenAIProjectHardLimit({env:cfg(),request});expect(result.state).toBe('BLOCKED');expect(JSON.stringify(result)).not.toContain(ADMIN);
  });
  it('times out a stalled Admin response without retries, billing assumptions or authority writes', async () => {
    vi.useFakeTimers();const request=vi.fn<typeof fetch>(()=>new Promise(()=>undefined));const pending=observeOpenAIProjectHardLimit({env:cfg(),request});await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({state:'BLOCKED',actual_billed_amount:null,database_authority_written:false});expect(request).toHaveBeenCalledOnce();vi.useRealTimers();
  });
  it('bounds a stalled limit body after successful project identity without retries or raw response leakage', async () => {
    vi.useFakeTimers();
    const partial = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"threshold_amount":')); } }), { headers: { 'content-type': 'application/json' } });
    Object.defineProperty(partial, 'url', { value: root + '/spend_limit' });
    const request = vi.fn<typeof fetch>(async url => String(url) === root ? json(root, project()) : partial);
    const pending = observeOpenAIProjectHardLimit({ env: cfg(), request }); await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({ state: 'BLOCKED', reason: 'OPENAI_PREFLIGHT_TIMEOUT', project_http_status: 200, limit_http_status: 200, control_metadata_requests: 2, database_authority_written: false });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each(['scope','organization','branch','sha','validated-sha','event','repo','actions'])('requires protected scope before any Admin read (%s)', async mode=>{
    const config: Record<string, string | undefined> = cfg();if(mode==='scope')config.OPENAI_UAT_PROJECT_ID='proj_owned\r\nX-Header: injected';if(mode==='organization')config.OPENAI_UAT_ORGANIZATION_ID='org-owned\r\nX-Header: injected';if(mode==='branch')config.GITHUB_REF='refs/heads/feature';if(mode==='sha')config.GITHUB_SHA='b'.repeat(40);if(mode==='validated-sha')config.VALIDATED_SHA='invalid';if(mode==='event')config.GITHUB_EVENT_NAME='pull_request';if(mode==='repo')config.GITHUB_REPOSITORY='foreign/repository';if(mode==='actions')config.GITHUB_ACTIONS='false';const request=http();
    expect((await observeOpenAIProjectHardLimit({env:config,request})).state).toBe('BLOCKED');expect(request).not.toHaveBeenCalled();
  });
});
