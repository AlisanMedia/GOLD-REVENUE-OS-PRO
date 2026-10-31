import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeProtectedIntegrationInventory } from "../../scripts/protected-integration-inventory.mjs";

const SHA = "a".repeat(40), KEY = "SYNTHETIC_OPENAI_PRIVATE_NOT_A_REAL_KEY";
const BOT = "8123456701:" + "SYNTHETIC_PRIVATE_BUSINESS_TOKEN", TEST = "8123456702:" + "SYNTHETIC_PRIVATE_TEST_TOKEN", MERCHANT = "8123456703:" + "SYNTHETIC_PRIVATE_MERCHANT_TOKEN";
const MODEL = "https://api.openai.com/v1/models/gpt-6.1-sol";
function env(): Record<string, string | undefined> {
  return { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "AlisanMedia/GOLD-REVENUE-OS-PRO", GITHUB_SHA: SHA, VALIDATED_SHA: SHA, OPENAI_API_KEY: KEY, POLAT_UAT_TELEGRAM_BOT_TOKEN: BOT };
}
function json(url: string, value: unknown, status = 200) {
  const response = new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); Object.defineProperty(response, "url", { value: url }); return response;
}
function payload(url: string) {
  if (url === MODEL) return { id: "gpt-6.1-sol", object: "model", created: 1, owned_by: "openai" };
  if (url.endsWith("getWebhookInfo")) return { ok: true, result: { url: "", pending_update_count: 0 } };
  return { ok: true, result: { id: Number(url.split("/bot")[1]!.split(":")[0]), is_bot: true, username: "synthetic_test_bot", first_name: "DO_NOT_EXPORT_PRIVATE_PROFILE", can_connect_to_business: true } };
}
function network() { return vi.fn<typeof fetch>(async url => json(String(url), payload(String(url)))); }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("protected pre-configuration inventory: real reader, offline boundaries", () => {
  it("reuses the exact model metadata reader and inspects current webhook without requiring a program or granting authority", async () => {
    const request = network(), result = await observeProtectedIntegrationInventory({ env: env(), request });
    expect(result).toMatchObject({ actual_inference_requests: 0, telegram_messages: 0, database_mutations: 0, webhook_mutations: 0, payment_requests: 0, financial_authority: "NONE", genuine_execution_authority: "BLOCKED", billing: "UNKNOWN" });
    expect(result.openai).toMatchObject({ state: "OBSERVED", model_metadata_requests: 1, actual_inference_requests: 0 });
    expect(result.openai_http_classification).toBe("HTTP_OK_METADATA_ONLY");
    expect(result.bots[0]).toMatchObject({ state: "OBSERVED", role: "BUSINESS_AI", bot_id: "8123456701", secretary_capability: true, webhook: { target: "NOT_REGISTERED" } });
    expect(result.bots.slice(1).every(b => b.state === "NOT_CONFIGURED")).toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
    expect(result.configured_names).toEqual(["OPENAI_API_KEY", "POLAT_UAT_TELEGRAM_BOT_TOKEN"]);
    for (const secret of [KEY, BOT, "DO_NOT_EXPORT_PRIVATE_PROFILE"]) expect(JSON.stringify(result)).not.toContain(secret);
    for (const [url, init] of request.mock.calls) {
      expect(String(url) === MODEL || /\/(getMe|getWebhookInfo)$/u.test(String(url))).toBe(true);
      expect(init?.redirect).toBe("error"); expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it.each(["actions", "event", "branch", "repository", "sha"])("rejects %s before any credential reaches HTTP", async field => {
    const config = env(), request = network();
    if (field === "actions") config.GITHUB_ACTIONS = "false"; if (field === "event") config.GITHUB_EVENT_NAME = "pull_request"; if (field === "branch") config.GITHUB_REF = "refs/heads/feature"; if (field === "repository") config.GITHUB_REPOSITORY = "other/repository"; if (field === "sha") config.GITHUB_SHA = "b".repeat(40);
    await expect(observeProtectedIntegrationInventory({ env: config, request })).rejects.toThrow("PROTECTED_INVENTORY_SCOPE_REQUIRED"); expect(request).not.toHaveBeenCalled();
  });
  it("keeps production merchant and dedicated TEST identities/routes distinct", async () => {
    const request = network(); const result = await observeProtectedIntegrationInventory({ env: { ...env(), POLAT_STARS_MERCHANT_BOT_TOKEN: MERCHANT, POLAT_UAT_STARS_TEST_BOT_TOKEN: TEST }, request });
    expect(result.bots.map(b => [b.role, b.api_environment, b.bot_id])).toEqual([["BUSINESS_AI", "TELEGRAM_PRODUCTION", "8123456701"], ["MERCHANT", "TELEGRAM_PRODUCTION", "8123456703"], ["STARS_DEDICATED_TEST", "TELEGRAM_DEDICATED_TEST", "8123456702"]]);
    expect(request.mock.calls.filter(([url]) => String(url).includes("/test/")).map(([url]) => String(url).split("/").at(-1))).toEqual(["getMe", "getWebhookInfo"]);
    expect(result.bot_role_conflicts).toEqual([]); expect(request).toHaveBeenCalledTimes(7);
  });
  it("flags shared Business/merchant custody; same numeric ID across different networks alone proves no collision", async () => {
    const a = await observeProtectedIntegrationInventory({ env: { ...env(), POLAT_STARS_MERCHANT_BOT_TOKEN: BOT }, request: network() });
    expect(a.bot_role_conflicts).toEqual([["BUSINESS_AI", "MERCHANT"]]);
    const b = await observeProtectedIntegrationInventory({ env: { ...env(), POLAT_UAT_STARS_TEST_BOT_TOKEN: "8123456701:" + "OTHER_SYNTHETIC_TEST_ONLY_TOKEN" }, request: network() });
    expect(b.bot_role_conflicts).toEqual([]);
  });
  it("does not print existing webhook URLs, query secrets, last-error text or provider profile data", async () => {
    const privateUrl = "https://private.example.test/" + KEY + "?token=" + BOT;
    const request = vi.fn<typeof fetch>(async input => { const url = String(input); return json(url, url.endsWith("getWebhookInfo") ? { ok: true, result: { url: privateUrl, pending_update_count: 3, last_error_message: KEY, last_error_date: 1, ip_address: "127.0.0.1", verified: true } } : payload(url)); });
    const result = await observeProtectedIntegrationInventory({ env: env(), request });
    expect(result.bots[0]?.webhook).toMatchObject({ target: "OTHER_EXISTING_WEBHOOK", pending_update_count: 3, error_present: true, url_hash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    for (const text of [KEY, BOT, privateUrl, "127.0.0.1", "verified"]) expect(JSON.stringify(result)).not.toContain(text);
  });
  it("recognizes only the fixed known ingress, and never rewrites any webhook", async () => {
    const request = vi.fn<typeof fetch>(async input => { const url = String(input); return json(url, url.endsWith("getWebhookInfo") ? { ok: true, result: { url: "https://xqvwkghpmezcpgugetqc.supabase.co/functions/v1/polat-campaign-ingress", pending_update_count: 0, allowed_updates: ["business_message"] } } : payload(url)); });
    const result = await observeProtectedIntegrationInventory({ env: env(), request });
    expect(result.bots[0]?.webhook).toMatchObject({ target: "CAMPAIGN", allowed_updates: ["business_message"] }); expect(request).toHaveBeenCalledTimes(3);
  });
  it.each([401, 403, 404, 429, 500])("retains actual HTTP %i but no provider error body, retries or fallback", async status => {
    const request = vi.fn<typeof fetch>(async url => json(String(url), { error: { message: KEY }, description: BOT }, status));
    const result = await observeProtectedIntegrationInventory({ env: env(), request });
    expect(result.openai).toMatchObject({ state: "BLOCKED", provider_status: status }); expect(result.bots[0]).toMatchObject({ state: "BLOCKED", provider_status: status, metadata_requests: 1 });
    expect(request).toHaveBeenCalledTimes(2); expect(JSON.stringify(result)).not.toContain(KEY); expect(JSON.stringify(result)).not.toContain(BOT);
  });
  it("does not let malformed credential text enter a URL", async () => {
    const request = network(); const result = await observeProtectedIntegrationInventory({ env: { ...env(), POLAT_UAT_TELEGRAM_BOT_TOKEN: BOT + "/sendMessage" }, request });
    expect(result.bots[0]).toMatchObject({ state: "BLOCKED", reason: "CREDENTIAL_FORMAT_INVALID", metadata_requests: 0 }); expect(request).toHaveBeenCalledOnce();
  });
  it.each(["identity", "duplicate-json", "url", "oversize", "malformed-webhook"])("holds %s rather than manufacturing an observed bot", async failure => {
    const request = vi.fn<typeof fetch>(async input => {
      const url = String(input); if (url === MODEL) return json(url, payload(url));
      if (failure === "identity") return json(url, { ok: true, result: { id: 123, is_bot: true, username: "synthetic_test_bot" } });
      if (failure === "url") return json("https://other.example.test", payload(url));
      if (failure === "oversize") return json(url, { padding: "x".repeat(17000) });
      if (failure === "duplicate-json") { const response = new Response('{"ok":true,"ok":false,"result":{}}', { headers: { "content-type": "application/json" } }); Object.defineProperty(response, "url", { value: url }); return response; }
      return json(url, url.endsWith("getWebhookInfo") ? { ok: true, result: { url: "", pending_update_count: -1 } } : payload(url));
    });
    const result = await observeProtectedIntegrationInventory({ env: env(), request }); expect(result.bots[0]?.state).toBe("BLOCKED"); expect(result.actual_inference_requests).toBe(0);
  });
  it.each(["request", "body"])("bounds a stalled %s without retry or raw exception leakage", async failure => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>(async input => {
      const url = String(input); if (url === MODEL) return json(url, payload(url));
      if (failure === "request") return new Promise<Response>(() => undefined);
      const response = new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":')); } }), { headers: { "content-type": "application/json" } }); Object.defineProperty(response, "url", { value: url }); return response;
    });
    const pending = observeProtectedIntegrationInventory({ env: env(), request }); await vi.advanceTimersByTimeAsync(10000);
    const result = await pending; expect(result.bots[0]).toMatchObject({ state: "BLOCKED", reason: "METADATA_TIMEOUT", metadata_requests: 1 }); expect(request).toHaveBeenCalledTimes(2);
  });
  it("retains required environment review, exact-head governance and no deployment/migration/model entry point", () => {
    const workflow = readFileSync(".github/workflows/private-beta-uat.yml", "utf8").split("  integration_inventory:\n")[1]!.split("  verify_bot:\n")[0]!;
    expect(workflow).toContain("environment: staging"); expect(workflow).toContain("scripts/private-beta-release-gate.mjs");
    expect(workflow).toContain("github.ref == 'refs/heads/main'"); expect(workflow).toContain("persist-credentials: false"); expect(workflow).toContain("if-no-files-found: error");
    for (const text of ["supabase db push", "vercel deploy", "SUPABASE_ACCESS_TOKEN:", "STAGING_SUPABASE_DB_PASSWORD:", "setWebhook", "runPrivateBetaCanary"]) expect(workflow).not.toContain(text);
    expect(JSON.parse(readFileSync("vercel.json", "utf8")).git.deploymentEnabled["codex/protected-integration-inventory"]).toBe(false);
  });
});
