import { IDENTITY_DOMAINS_V1 } from "../../packages/contracts/src/historical/identity-domains-v1";
import { IDENTITY_WIRE_V1 } from "../../packages/contracts/src/historical/identity-wire-v1";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectPrivateBetaFounderModel } from "../../scripts/private-beta-founder-model.mjs";

const DB = "https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query", MODEL = "https://api.openai.com/v1/models/gpt-6.1-sol";
const PRICING = "https://developers.openai.com/api/docs/models/gpt-6.1-sol.md", POLICY = "https://developers.openai.com/api/docs/guides/your-data.md";
const ID = "91cc1000-0000-4000-8000-000000000001", TENANT = "91cc2000-0000-4000-8000-000000000001", SHA = "a".repeat(40), AT = Date.parse("2026-11-01T22:00:00Z");
const KEY = "SYNTHETIC_OPENAI_KEY_NEVER_AUTHORITY", MANAGEMENT = "SYNTHETIC_MANAGEMENT_KEY_NEVER_AUTHORITY";
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const env = (): Record<string, string | undefined> => ({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "AlisanMedia/GOLD-REVENUE-OS-PRO", GITHUB_SHA: SHA, VALIDATED_SHA: SHA,
  PRIVATE_BETA_PROGRAM_ID: ID, OPENAI_API_KEY: KEY, SUPABASE_ACCESS_TOKEN: MANAGEMENT, OPENAI_UAT_ORGANIZATION_ID: "org-fixture", OPENAI_UAT_PROJECT_ID: "proj_fixture" });
// Reviewed official public model page, 2 November 2026 Europe/Istanbul. This is
// offline source text, not provider access, authenticated policy or billing proof.
const pricing = `# GPT-6.1 Sol

Model ID: \`gpt-6.1-sol\`

## Model details

- 1,050,000 context window
- Maximum input tokens: 922,000

## Pricing

Pricing is based on the number of tokens used, or other metrics based on the model type. For tool-specific models, like search and computer use, there’s a fee per tool call. See details in the [pricing page](/api/docs/pricing).

### Text tokens

| Metric | Price | Unit |
| --- | ---: | --- |
| Input | $2 | 1M tokens |
| Cached input | $0.1 | 1M tokens |
| Cache writes | $2.5 | 1M tokens |
| Output | $10 | 1M tokens |

- Cached input tokens are priced at 5% of the uncached input token rate.
- Cache writes are billed at 1.25x the uncached input token rate.
- API prompts with more than 272K input tokens are priced at 2x input and cache rates and 1.5x output for the full request.
- Fast mode prices are 2x Standard. Batch and Flex prices are 50% lower than Standard.
- Ultrafast mode prices are 6x Standard.
- Regional processing adds a 10% premium where available.
- GPT-6.1 Sol uses a default context window of 500K tokens in Codex and ChatGPT Work. Usage drawn from your subscription has no long-context surcharge. See [Codex pricing](/codex/pricing).

## Endpoints

| Responses | \`v1/responses\` | Supported |
`;
const policy = "# Data controls in the OpenAI platform\n\nUnderstand how OpenAI uses your data, and how you can control it.\n\nOffline policy fixture; no account settings are established.\n";
function response(url: string, value: unknown, status = 200, headers: Record<string, string> = {}) {
  const result = new Response(typeof value === "string" ? value : JSON.stringify(value), { status, headers: { "content-type": typeof value === "string" ? "text/markdown" : "application/json", ...headers } });
  Object.defineProperty(result, "url", { value: url }); return result;
}
function fixture() {
  const state = {
    program: { database_role: "postgres", program_id: ID, tenant_id: TENANT, tenant_status: "active", tenant_slug: "private-beta-fixture", outbound_messaging_enabled: false,
      repository_sha: "b".repeat(40) as string | null, stage: "DRAFT", request_count: "0", generation: "1", manifest_hash: "c".repeat(64), authorization_record_hash: "d".repeat(64), model_provider: "openai", model_name: "gpt-6.1-sol", notice_version: "jeff-private-beta-notice-openai-v1" },
    model: { id: "gpt-6.1-sol", object: "model", created: 1, owned_by: "openai" }, pricing, policy, modelHeaders: {} as Record<string, string>,
    stored: null as null | { observation: Record<string, unknown>; pricing: Record<string, unknown> }, readbackChange: (_stored: unknown): unknown => _stored,
    readbackRole: "postgres", writeStatus: 200, writes: [] as string[], sql: [] as string[],
  };
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === MODEL) return response(url, state.model, 200, state.modelHeaders);
    if (url === PRICING) return response(url, state.pricing);
    if (url === POLICY) return response(url, state.policy);
    if (url !== DB) throw Error("OFFLINE_FIXED_SOURCE_ONLY");
    const sql = (JSON.parse(String(init?.body)) as { query: string }).query; state.sql.push(sql);
    if (sql.startsWith("do $founder_model$")) {
      state.writes.push(sql);
      if (state.writeStatus !== 200) return response(url, { error: KEY }, state.writeStatus);
      const encoded = /decode\('([a-f0-9]+)','hex'\)/u.exec(sql)?.[1];
      if (!encoded) throw Error("OFFLINE_HEX_PAYLOAD_REQUIRED");
      state.stored = JSON.parse(Buffer.from(encoded, "hex").toString("utf8")) as typeof state.stored;
      return response(url, []);
    }
    if (sql.startsWith("select current_user")) return response(url, [{ database_role: state.readbackRole, founder_model_observation: state.readbackChange(state.stored) }]);
    return response(url, [{ private_beta_program: state.program }]);
  });
  const run = (config = env(), now = () => AT) => collectPrivateBetaFounderModel({ env: config, request, now });
  return { state, request, run };
}
afterEach(() => vi.useRealTimers());

describe("protected founder model/pricing collector, offline fixed HTTP and SQL boundaries", () => {
  it("accepts documented query201 for scope, observation write and independent readback without granting inference", async () => {
    const f = fixture(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (url, init) => { const r = await original(url, init); if (String(url) !== DB) return r;
      const created = new Response(r.body, { status: 201, headers: r.headers }); Object.defineProperty(created, "url", { value: DB }); return created; });
    expect(await f.run()).toMatchObject({ state: "RECORDED", database_observation_write: "VERIFIED", actual_inference_requests: 0, owner_authority: "NOT_GRANTED", database_authority_written: false });
    expect(f.state.writes).toHaveLength(1); expect(f.request).toHaveBeenCalledTimes(6);
    f.state.readbackChange = () => null;
    expect(await f.run()).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_PERSISTENCE_UNVERIFIED", database_observation_write: "UNVERIFIED" });
  });
  it.each(["empty", "malformed", "duplicate", "wrong-role"])("does not trust query201 without valid authenticated program JSON (%s)", async kind => {
    const f = fixture(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation((url, init) => {
      if (String(url) !== DB) return original(url, init);
      const raw = kind === "empty" ? null : kind === "malformed" ? "{" : kind === "duplicate" ? '[{"private_beta_program":{},"private_beta_program":{}}]' : JSON.stringify([{ private_beta_program: { ...f.state.program, database_role: "authenticated" } }]);
      const r = new Response(raw, { status: 201, headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: DB }); return Promise.resolve(r);
    });
    expect(await f.run()).toMatchObject({ state: "BLOCKED", database_observation_write: "NOT_ATTEMPTED", actual_inference_requests: 0 }); expect(f.request).toHaveBeenCalledOnce(); expect(f.state.writes).toHaveLength(0);
  });
  it.each([MODEL, PRICING, POLICY])("does not accept201 from other provider or documentation endpoints (%s)", async target => {
    const f = fixture(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (url, init) => { const r = await original(url, init); if (String(url) !== target) return r;
      const created = new Response(r.body, { status: 201, headers: r.headers }); Object.defineProperty(created, "url", { value: target }); return created; });
    expect(await f.run()).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_RESPONSE_INVALID", database_observation_write: "NOT_ATTEMPTED" }); expect(f.state.writes).toHaveLength(0);
  });
  it("records only verified scoped metadata and reviewed public rates, then independently verifies persistence", async () => {
    const f = fixture(), result = await f.run(), stored = f.state.stored!;
    expect(result).toMatchObject({ state: "RECORDED", database_observation_write: "VERIFIED", actual_inference_requests: 0, owner_authority: "NOT_GRANTED", provider_billing: "UNKNOWN", provider_enforced_cap: "UNVERIFIED", actual_billed_amount: null, database_authority_written: false, financial_authority: "NONE", commercial_pilot: "NO_GO" });
    expect(f.request.mock.calls.map(call => call[0])).toEqual([DB, MODEL, PRICING, POLICY, DB, DB]);
    expect(stored.observation).toMatchObject({ version: 1, origin: "PROTECTED_OPENAI_MODEL_AND_PRICING_OBSERVATION", program_id: ID, tenant_id: TENANT, repository_sha: SHA, organization_id: "org-fixture", project_id: "proj_fixture", credential_sha256: hash(KEY), account_scope_hash: hash(JSON.stringify(["OPENAI_PROJECT1", "org-fixture", "proj_fixture"])), model_access: true, policy_hash: hash(policy), observed_at: new Date(AT).toISOString(), expires_at: new Date(AT + 86400000).toISOString() });
    expect(stored.observation.credential_custody_hash).toBe(hash(JSON.stringify([IDENTITY_DOMAINS_V1["JEFF_UAT_CREDENTIAL_CUSTODY1"], stored.observation.account_scope_hash, hash(KEY)])));
    expect(stored.pricing).toMatchObject({ version: 2, source_hash: hash(pricing), maximum_input_tokens: 1050000, maximum_input_usd_per_million: "4.4", maximum_output_usd_per_million: "16.5", all_billable_components_covered: true });
    expect(f.state.writes).toHaveLength(1); expect(f.state.writes[0]).toContain("private.private_beta_founder_model_record"); expect(f.state.writes[0]).toContain("for update of p"); expect(f.state.writes[0]).toContain("p.generation=1");
    expect(f.state.writes[0]).not.toMatch(/admin_private_beta|account_control_record|transition|grant execute|insert into/iu);
    for (const [url, init] of f.request.mock.calls) {
      expect(init?.redirect).toBe("error"); expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url === MODEL) expect(init).toMatchObject({ method: "GET", headers: { authorization: "Bearer " + KEY, "OpenAI-Organization": "org-fixture", "OpenAI-Project": "proj_fixture" } });
      else if (url === DB) expect(init).toMatchObject({ method: "POST", headers: { authorization: "Bearer " + MANAGEMENT } });
      else { expect(init?.method).toBe("GET"); expect(init?.headers).toEqual({ accept: "text/markdown, text/plain" }); }
    }
    for (const sensitive of [KEY, MANAGEMENT, ID, TENANT, "org-fixture", "proj_fixture", "owned_by"]) expect(JSON.stringify(result)).not.toContain(sensitive);
    expect(JSON.stringify(stored)).not.toContain(KEY); expect(JSON.stringify(stored)).not.toContain(MANAGEMENT);
  });
  it("permits an old or unconfigured draft release; only authentic owner preparation can bind the new observed release", async () => {
    const f = fixture(); f.state.program.repository_sha = null;
    expect(await f.run()).toMatchObject({ state: "RECORDED", repository_sha: SHA });
    expect(f.state.stored?.observation.repository_sha).toBe(SHA); expect(f.state.writes[0]).not.toContain("set configuration");
  });
  it("collects current metadata for only the independently eligible two-attempt personal continuation", async () => {
    const f = fixture();
    Object.assign(f.state.program, { stage: "CANARY", request_count: "2", continuation_available: true });
    expect(await f.run()).toMatchObject({ state: "RECORDED", owner_authority: "NOT_GRANTED", actual_inference_requests: 0 });
    expect(f.state.writes[0]).toContain("private.private_beta_continuation_available(p)");
    for (const eligibility of [false, "true", undefined]) {
      const denied = fixture();
      Object.assign(denied.state.program, { stage: "CANARY", request_count: "2", continuation_available: eligibility });
      expect(await denied.run()).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_PROGRAM_REQUIRED" });
      expect(denied.request).toHaveBeenCalledOnce();
      expect(denied.state.writes).toHaveLength(0);
    }
  });
  it("refreshes stopped-setup metadata only for an independently eligible three-attempt rearm", async () => {
    const f = fixture(); Object.assign(f.state.program, { stage: "STOPPED", request_count: "3", continuation_available: true });
    expect(await f.run()).toMatchObject({ state: "RECORDED", actual_inference_requests: 0, owner_authority: "NOT_GRANTED" });
    const blocked = fixture(); Object.assign(blocked.state.program, { stage: "STOPPED", request_count: "3", continuation_available: false });
    expect(await blocked.run()).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_PROGRAM_REQUIRED" });
    expect(blocked.state.writes).toHaveLength(0);
  });
  it("collects metadata for only the server-eligible third usage-envelope repair", async () => {
    const f = fixture(); Object.assign(f.state.program, { stage: "CANARY", request_count: "3", continuation_available: true });
    expect(await f.run()).toMatchObject({ state: "RECORDED", actual_inference_requests: 0 });
    expect(f.state.writes).toHaveLength(1);
    const denied = fixture(); Object.assign(denied.state.program, { stage: "CANARY", request_count: "3", continuation_available: false });
    expect(await denied.run()).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_PROGRAM_REQUIRED" });
    expect(denied.state.writes).toHaveLength(0);
  });

  it("reads the preserved notice only for the exact two-attempt continuation and rechecks it under the write lock and readback", async () => {
    const f = fixture(), notice = IDENTITY_WIRE_V1["jeff-private-beta-notice-openai-v1"];
    Object.assign(f.state.program, { notice_version: notice, stage: "CANARY", request_count: "2", continuation_available: true });
    expect(await f.run()).toMatchObject({ state: "RECORDED", owner_authority: "NOT_GRANTED", actual_inference_requests: 0, database_authority_written: false });
    expect(f.state.writes).toHaveLength(1);
    for (const sql of f.state.sql.slice(1)) {
      expect(sql).toContain("p.configuration->>'notice_version'='" + notice + "' and p.stage='CANARY' and p.request_count=2 and private.private_beta_continuation_available(p)");
      expect(sql).not.toContain("set configuration");
    }
    expect(f.state.writes[0]).toContain("for update of p");
  });
  it.each([
    { stage: "DRAFT", request_count: "0", continuation_available: true },
    { stage: "CANARY", request_count: "1", recovery_available: true, continuation_available: true },
    { stage: "CANARY", request_count: "2", continuation_available: false },
    { stage: "CANARY", request_count: "2", continuation_available: "true" },
    { stage: "CANARY", request_count: "2", continuation_available: undefined },
    { stage: "CANARY", request_count: "3", continuation_available: true },
    { stage: "FOUNDER", request_count: "2", continuation_available: true },
  ])("rejects a preserved notice outside the exact continuation scope: %j", async scope => {
    const f = fixture();
    Object.assign(f.state.program, { notice_version: IDENTITY_WIRE_V1["jeff-private-beta-notice-openai-v1"], ...scope });
    expect(await f.run()).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_PROGRAM_REQUIRED", database_observation_write: "NOT_ATTEMPTED" });
    expect(f.request).toHaveBeenCalledOnce(); expect(f.state.writes).toHaveLength(0);
  });
  it.each(["actions", "event", "branch", "repository", "release", "validated-sha", "program", "project", "organization", "key", "management"])("rejects invalid protected input %s before any HTTP", async field => {
    const f = fixture(), config = env();
    if (field === "actions") config.GITHUB_ACTIONS = "false"; if (field === "event") config.GITHUB_EVENT_NAME = "pull_request"; if (field === "branch") config.GITHUB_REF = "refs/heads/feature"; if (field === "repository") config.GITHUB_REPOSITORY = "foreign/repository";
    if (field === "release") config.GITHUB_SHA = "b".repeat(40); if (field === "validated-sha") config.VALIDATED_SHA = "invalid"; if (field === "program") config.PRIVATE_BETA_PROGRAM_ID = "' or true--";
    if (field === "project") config.OPENAI_UAT_PROJECT_ID = "proj_fixture\r\nX-Header: injected"; if (field === "organization") config.OPENAI_UAT_ORGANIZATION_ID = "https://foreign.invalid";
    if (field === "key") config.OPENAI_API_KEY = KEY + "\0"; if (field === "management") delete config.SUPABASE_ACCESS_TOKEN;
    expect(await f.run(config)).toMatchObject({ state: "BLOCKED", database_observation_write: "NOT_ATTEMPTED" }); expect(f.request).not.toHaveBeenCalled();
  });
  it.each(["role", "foreign", "inactive", "live-tenant", "outbound", "stage", "attempts", "provider", "model", "notice", "generation"])("rejects ineligible or forged database scope %s without provider access", async change => {
    const f = fixture(), p = f.state.program;
    if (change === "role") p.database_role = "service_role"; if (change === "foreign") p.program_id = TENANT; if (change === "inactive") p.tenant_status = "inactive"; if (change === "live-tenant") p.tenant_slug = "production"; if (change === "outbound") p.outbound_messaging_enabled = true;
    if (change === "stage") p.stage = "FOUNDER"; if (change === "attempts") p.request_count = "1"; if (change === "provider") p.model_provider = "anthropic"; if (change === "model") p.model_name = "gpt-6-luna"; if (change === "notice") p.notice_version = "old"; if (change === "generation") p.generation = "1;select true";
    expect(await f.run()).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_PROGRAM_REQUIRED" }); expect(f.request).toHaveBeenCalledOnce(); expect(f.state.writes).toHaveLength(0);
  });
  it.each(["model", "object", "created", "project", "organization"])("rejects mismatched model metadata %s before any write", async change => {
    const f = fixture();
    if (change === "model") f.state.model.id = "gpt-6-luna"; if (change === "object") f.state.model.object = "response"; if (change === "created") f.state.model.created = -1;
    if (change === "project") f.state.modelHeaders["openai-project"] = "proj_foreign"; if (change === "organization") f.state.modelHeaders["openai-organization"] = "org-foreign";
    expect(await f.run()).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_ACCESS_UNVERIFIED" }); expect(f.state.writes).toHaveLength(0); expect(f.request).toHaveBeenCalledTimes(2);
  });
  it.each(["input", "regional", "long-context", "extra-fee", "duplicate", "identity", "capacity"])("rejects public pricing drift %s instead of manufacturing a safe rate", async change => {
    const f = fixture();
    if (change === "input") f.state.pricing = pricing.replace("| Input | $2 |", "| Input | $2.01 |");
    if (change === "regional") f.state.pricing = pricing.replace("10% premium", "20% premium"); if (change === "long-context") f.state.pricing = pricing.replace("1.5x output", "2x output");
    if (change === "extra-fee") f.state.pricing = pricing.replace("## Endpoints", "- New mandatory request fee: $1\n\n## Endpoints"); if (change === "duplicate") f.state.pricing += "\n## Pricing\n| Input | $999 | 1M tokens |";
    if (change === "identity") f.state.pricing = pricing.replace("# GPT-6.1 Sol", "# Another model"); if (change === "capacity") f.state.pricing = pricing.replace("1,050,000 context", "2,050,000 context");
    expect(await f.run()).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_PRICING_DRIFT", database_observation_write: "NOT_ATTEMPTED" }); expect(f.state.writes).toHaveLength(0);
  });
  it("ignores environment claims/host overrides and requires the actual public policy body", async () => {
    const f = fixture(); f.state.policy = "# Claimed approved account\n{" + KEY + "}";
    const config = { ...env(), OPENAI_BASE_URL: "https://foreign.invalid", CLAIMED_HARD_LIMIT: "5", VERIFIED_ACCOUNT: "true", CLAIMED_OBSERVATION: "{}" };
    const result = await f.run(config); expect(result).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_POLICY_UNVERIFIED" }); expect(f.state.writes).toHaveLength(0); expect(JSON.stringify(result)).not.toContain(KEY);
    expect(f.request.mock.calls.map(call => call[0])).toEqual([DB, MODEL, PRICING, POLICY]);
  });
  it.each(["missing", "release", "project", "credential", "stale", "extra", "role"])("requires an independent exact persisted readback (%s)", async change => {
    const f = fixture();
    if (change === "role") f.state.readbackRole = "authenticated";
    else f.state.readbackChange = stored => {
      if (change === "missing") return null;
      const copy = structuredClone(stored) as { observation: Record<string, unknown>; pricing: Record<string, unknown> };
      if (change === "release") copy.observation.repository_sha = "f".repeat(40); if (change === "project") copy.observation.project_id = "proj_foreign"; if (change === "credential") copy.observation.credential_sha256 = "0".repeat(64);
      if (change === "stale") copy.observation.observed_at = new Date(AT - 300001).toISOString(); if (change === "extra") copy.observation.verified = true;
      return copy;
    };
    expect(await f.run()).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_PERSISTENCE_UNVERIFIED", database_observation_write: "UNVERIFIED" }); expect(f.state.writes).toHaveLength(1); expect(f.request).toHaveBeenCalledTimes(6);
  });
  it("holds a rejected write without retry or pretending persistence is known", async () => {
    const f = fixture(); f.state.writeStatus = 409;
    const result = await f.run(); expect(result).toMatchObject({ state: "BLOCKED", database_observation_write: "UNVERIFIED" }); expect(f.state.writes).toHaveLength(1); expect(f.request).toHaveBeenCalledTimes(5); expect(JSON.stringify(result)).not.toContain(KEY);
  });
  it("does not write when the observation clock becomes stale", async () => {
    const f = fixture(), now = vi.fn<() => number>().mockReturnValueOnce(AT).mockReturnValue(AT + 300001);
    expect(await f.run(env(), now)).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_TIME_INVALID", database_observation_write: "NOT_ATTEMPTED" }); expect(f.state.writes).toHaveLength(0);
  });
  it.each(["foreign-url", "redirect", "duplicate", "oversize", "wrong-type", "transport-secret"])("bounds and redacts %s without inference or retries", async kind => {
    const f = fixture(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (url, init) => {
      if (String(url) !== MODEL) return original(url, init);
      if (kind === "transport-secret") throw Error(KEY);
      if (kind === "foreign-url") return response("https://foreign.invalid", f.state.model);
      if (kind === "redirect") { const r = response(MODEL, f.state.model); Object.defineProperty(r, "redirected", { value: true }); return r; }
      if (kind === "duplicate") return response(MODEL, '{"id":"gpt-6.1-sol","id":"other"}', 200, { "content-type": "application/json" });
      if (kind === "oversize") return response(MODEL, { padding: "x".repeat(17000) });
      return response(MODEL, "<html>denied</html>", 200, { "content-type": "text/html" });
    });
    const result = await f.run(); expect(result).toMatchObject({ state: "BLOCKED", database_observation_write: "NOT_ATTEMPTED" }); expect(f.request).toHaveBeenCalledTimes(2); expect(f.state.writes).toHaveLength(0); expect(JSON.stringify(result)).not.toContain(KEY);
  });
  it("times out a stalled request as well as a stalled public document body", async () => {
    vi.useFakeTimers();
    for (const body of [false, true]) {
      const f = fixture(), original = f.request.getMockImplementation()!;
      f.request.mockImplementation(async (url, init) => {
        if (String(url) !== PRICING) return original(url, init);
        if (!body) return new Promise(() => undefined);
        const r = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("# GPT-6.1 Sol\n")); } }), { headers: { "content-type": "text/markdown" } }); Object.defineProperty(r, "url", { value: PRICING }); return r;
      });
      const pending = f.run(); await vi.advanceTimersByTimeAsync(10000);
      expect(await pending).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_TIMEOUT" }); expect(f.state.writes).toHaveLength(0); expect(f.request).toHaveBeenCalledTimes(3);
    }
  });
});


describe("provider display metadata is not an account-ID echo", () => {
  it("records fixed-credential model access with opaque organization/project labels and no inference", async () => {
    const f = fixture(); f.state.modelHeaders = { "openai-organization": "user-legacy-account", "openai-project": "Default project" };
    expect(await f.run()).toMatchObject({ state: "RECORDED", actual_inference_requests: 0, owner_authority: "NOT_GRANTED", provider_billing: "UNKNOWN" });
    expect(f.state.writes).toHaveLength(1);
    const [, init] = f.request.mock.calls.find(([url]) => String(url) === MODEL)!;
    expect(init?.headers).toMatchObject({ "OpenAI-Organization": "org-fixture", "OpenAI-Project": "proj_fixture" });
  });
  it.each(["org-foreign", "org_foreign"])("rejects a canonical foreign organization ID %s", async organization => {
    const f = fixture(); f.state.modelHeaders = { "openai-organization": organization };
    expect(await f.run()).toMatchObject({ state: "BLOCKED", reason: "FOUNDER_MODEL_ACCESS_UNVERIFIED", actual_inference_requests: 0 }); expect(f.state.writes).toHaveLength(0);
  });
});
