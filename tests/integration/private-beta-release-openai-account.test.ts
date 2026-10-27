import { afterEach, describe, expect, it, vi } from "vitest";
import { observePrivateBetaOpenAIAccount, privateBetaOpenAIAccountQuery } from "../../scripts/private-beta-release-openai-account.mjs";
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
