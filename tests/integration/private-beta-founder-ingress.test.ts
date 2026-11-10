import { IDENTITY_NAMES_V1 } from "../../packages/contracts/src/historical/identity-names-v1";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPrivateBetaFounderIngress } from "../../scripts/private-beta-founder-ingress.mjs";
import { PRIVATE_BETA_VERCEL as TARGET } from "../../scripts/private-beta-release-vercel.mjs";

const SHA = "a".repeat(40), PROGRAM = "91cc1000-0000-4000-8000-000000000001", TENANT = "91cc2000-0000-4000-8000-000000000001", AT = Date.parse("2026-11-02T00:00:00Z");
const BOT = "7012345:SYNTHETIC_PRIVATE_BOT_CREDENTIAL", MANAGEMENT = "SYNTHETIC_MANAGEMENT_CREDENTIAL", VERCEL = "SYNTHETIC_VERCEL_CREDENTIAL", BYPASS = "SYNTHETIC_EXISTING_AUTOMATION_BYPASS";
const DB = "https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query", EDGE = "https://xqvwkghpmezcpgugetqc.supabase.co/functions/v1/jeff-private-beta-ingress";
const SECRET_NAMES = ["JEFF_UAT_TELEGRAM_WEBHOOK_SECRET", "JEFF_UAT_RELAY_SECRET"], SELECTORS = ["JEFF_UAT_TENANT_ID", "JEFF_UAT_PROGRAM_ID"];
const UPDATES = ["business_connection", "business_message", "edited_business_message", "deleted_business_messages"];
const digest = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const dirs: string[] = [];
function json(url: string, value: unknown, status = 200) { const r = new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: url }); return r; }
function rawJson(url: string, raw: string, status = 200) { const r = new Response(raw, { status, headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: url }); return r; }
function fixture() {
  const dir = mkdtempSync("/tmp/founder-ingress-offline-"); dirs.push(dir);
  const env: Record<string, string | undefined> = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "AlisanMedia/GOLD-REVENUE-OS-PRO", GITHUB_SHA: SHA, VALIDATED_SHA: SHA,
    PRIVATE_BETA_PROGRAM_ID: PROGRAM, RUNNER_TEMP: dir, SUPABASE_ACCESS_TOKEN: MANAGEMENT, VERCEL_TOKEN: VERCEL, JEFF_UAT_TELEGRAM_BOT_TOKEN: BOT };
  const state = {
    project: { id: TARGET.project, name: TARGET.name, accountId: TARGET.team, ssoProtection: { deploymentType: "all_except_custom_domains" }, link: { type: "github", org: "AlisanMedia", repo: "GOLD-REVENUE-OS-PRO" }, protectionBypass: { [BYPASS]: { scope: "automation-bypass", isEnvVar: true } } as Record<string, { scope: string; isEnvVar?: boolean }> },
    team: { id: TARGET.team, slug: TARGET.name },
    program: { database_role: "postgres", program_id: PROGRAM, tenant_id: TENANT, tenant_status: "active", tenant_slug: "private-beta-ingress-fixture", outbound_messaging_enabled: false,
      provider: "openai", model: "gpt-6.1-sol", stage: "DRAFT", generation: "1", manifest_hash: "c".repeat(64), authorization_record_hash: "d".repeat(64), repository_sha: "b".repeat(40), model_observation_sha: null as string | null,
      owner_only_test: false, continuation_available: false, canary_result_hash: null as string | null, business_permitted: false, bot_id: "7012345", bot_credential_hash: digest(BOT), representative_user_id: "9001234", founder_chat_id: "5001234" },
    entries: [] as Array<{ id: string; key: string; type: string; target: string[]; value: string; decrypted: boolean }>, paginationNext: null as number | null,
    envWrites: [] as Array<Record<string, unknown>>, edgeWrites: [] as Array<Array<{ name: string; value: string }>>, queries: [] as string[], botProof: null as Record<string, unknown> | null, readbackValid: true,
    deployment: { id: "dpl_fixture01", projectId: TARGET.project, name: TARGET.name, target: "production", readyState: "READY", gitSource: { sha: SHA } }, aliasDeployment: "dpl_fixture01",
    me: { id: 7012345, is_bot: true, can_connect_to_business: true }, webhook: "", afterUpdates: UPDATES, afterError: "", setStatus: 200, setThrows: false, setCalls: [] as Array<Record<string, unknown>>, methods: [] as string[], generated: 0,
    edgeMode: "normal", edgeProbes: [] as Array<{ headers: HeadersInit | undefined; body: BodyInit | null | undefined }>, secretsStatus: 201,
  };
  const random = vi.fn((size: number) => new Uint8Array(size).fill(++state.generated));
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input), parsed = new URL(url), body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (url === DB) {
      const query = String(body.query); state.queries.push(query);
      if (query.startsWith("do $founder_bot$")) { const encoded = /decode\('([a-f0-9]+)','hex'\)/u.exec(query)![1]; state.botProof = JSON.parse(Buffer.from(encoded, "hex").toString("utf8")) as Record<string, unknown>; return json(url, []); }
      if (query.startsWith("select current_user")) return json(url, state.readbackValid ? [{ database_role: "postgres", bot_control: state.botProof }] : []);
      return json(url, [{ private_beta_program: state.program }]);
    }
    if (parsed.origin === "https://api.vercel.com") {
      if (parsed.searchParams.get("teamId") !== TARGET.team) throw Error("OFFLINE_FIXED_TEAM_ONLY");
      if (parsed.pathname === "/v9/projects/" + TARGET.project) return json(url, state.project);
      if (parsed.pathname === "/v2/teams/" + TARGET.team) return json(url, state.team);
      if (parsed.pathname === "/v10/projects/" + TARGET.project + "/env") {
        if (init?.method === "POST") {
          if (parsed.searchParams.get("upsert") !== "false" || ![...SECRET_NAMES, ...SELECTORS].includes(String(body.key))) throw Error("OFFLINE_CREATE_ALLOWLIST_ONLY");
          state.envWrites.push(body); state.entries.push({ id: "env_" + state.entries.length, key: String(body.key), type: String(body.type), target: body.target as string[], value: String(body.value), decrypted: true }); return json(url, { created: true }, 201);
        }
        if (parsed.searchParams.get("decrypt") !== "false") throw Error("OFFLINE_NO_BULK_SECRET_READ");
        return json(url, { envs: state.entries.map(({ value: _value, ...metadata }) => metadata), pagination: { next: state.paginationNext } });
      }
      if (parsed.pathname.startsWith("/v1/projects/" + TARGET.project + "/env/")) {
        const e = state.entries.find(v => parsed.pathname.endsWith("/" + v.id));
        if (!e) return json(url, { error: "missing" }, 404);
        return json(url, e.decrypted ? e : { id: e.id, key: e.key, type: "sensitive", target: e.target, decrypted: false });
      }
      if (parsed.pathname.startsWith("/v4/aliases/") && TARGET.aliases.some(v => parsed.pathname.endsWith(v))) return json(url, { deploymentId: state.aliasDeployment, projectId: TARGET.project });
      if (parsed.pathname === "/v13/deployments/dpl_fixture01") return json(url, state.deployment);
      throw Error("OFFLINE_NO_PROTECTION_WRITE_OR_SHARE_URL");
    }
    if (url === "https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/secrets") {
      state.edgeWrites.push(body as unknown as Array<{ name: string; value: string }>);
      const r = new Response(null, { status: state.secretsStatus }); Object.defineProperty(r, "url", { value: url }); return r;
    }
    if (url === EDGE) {
      state.edgeProbes.push({ headers: init?.headers, body: init?.body });
      if (state.edgeMode === "not-deployed") return json(url, { error: "missing" }, 404);
      if (state.edgeMode === "jwt-protected") return json(url, { error: "JWT required" }, 401);
      const header = new Headers(init?.headers), expected = state.edgeMode === "wrong-key" ? "z".repeat(43) : state.edgeWrites[0]?.[0]?.value;
      if (header.get("x-telegram-bot-api-secret-token") !== expected) return json(url, { error: "WEBHOOK_SECRET_INVALID" }, 401);
      if (header.get("content-type") !== "application/json") return json(url, { error: "JSON_REQUIRED" }, state.edgeMode === "wrong-status" ? 400 : 415);
      throw Error("OFFLINE_NO_AUTHENTICATED_TELEGRAM_EVENT_PROBE");
    }
    if (url.startsWith("https://api.telegram.org/bot" + BOT + "/")) {
      const method = parsed.pathname.split("/").at(-1)!; state.methods.push(method);
      if (method === "getMe") return json(url, { ok: true, result: state.me });
      if (method === "getWebhookInfo") return json(url, { ok: true, result: { url: state.webhook, allowed_updates: state.setCalls.length ? state.afterUpdates : UPDATES, ...(state.afterError && state.setCalls.length ? { last_error_message: state.afterError } : {}) } });
      if (method === "setWebhook") { state.setCalls.push(body); if (state.setThrows) throw Error(BOT + BYPASS); state.webhook = String(body.url); return json(url, { ok: true, result: true }, state.setStatus); }
      throw Error("OFFLINE_NO_MESSAGE_UPDATES_OR_DELETE_WEBHOOK");
    }
    throw Error("OFFLINE_FIXED_ENDPOINT_ONLY");
  });
  const run = (command: "prepare" | "register") => runPrivateBetaFounderIngress({ command, env, request, random, now: () => AT });
  const activate = () => { Object.assign(state.program, { stage: "CANARY", generation: "4", repository_sha: SHA, model_observation_sha: SHA, owner_only_test: true, canary_result_hash: "e".repeat(64), business_permitted: true }); };
  const add = (key: string, value: string, decrypted = true) => state.entries.push({ id: "env_" + state.entries.length, key, value, type: SELECTORS.includes(key) ? "plain" : "encrypted", target: ["production"], decrypted });
  return { env, state, request, random, run, activate, add, dir };
}
afterEach(() => { vi.useRealTimers(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("protected existing founder Business ingress, offline transports only", () => {
  it("accepts documented Supabase query201 with JSON for scope, write and independent readback", async () => {
    const f = fixture(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (url, init) => {
      const r = await original(url, init);
      if (String(url) !== DB) return r;
      const created = new Response(r.body, { status: 201, headers: r.headers }); Object.defineProperty(created, "url", { value: DB }); return created;
    });
    expect(await f.run("prepare")).toMatchObject({ state: "PREPARED", actual_inference_requests: 0, telegram_messages: 0 }); f.activate();
    expect(await f.run("register")).toMatchObject({ state: "REGISTERED", webhook_registration: "VERIFIED", inbound_delivery_observed: false });
    expect(f.state.queries.filter(q => q.startsWith("do $founder_bot$"))).toHaveLength(1); expect(f.state.methods).not.toContain("sendMessage");
  });
  it.each(["empty", "wrong-type", "malformed", "duplicate", "wrong-role", "foreign-url"])("rejects untrusted query201 (%s) before any writes", async kind => {
    const f = fixture(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation((url, init) => {
      if (String(url) !== DB) return original(url, init);
      if (kind === "empty") { const r = new Response(null, { status: 201, headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: DB }); return Promise.resolve(r); }
      if (kind === "wrong-type") { const r = new Response("<html>created</html>", { status: 201, headers: { "content-type": "text/html" } }); Object.defineProperty(r, "url", { value: DB }); return Promise.resolve(r); }
      if (kind === "malformed") return Promise.resolve(rawJson(DB, "{", 201));
      if (kind === "duplicate") return Promise.resolve(rawJson(DB, '[{"private_beta_program":{},"private_beta_program":{}}]', 201));
      return Promise.resolve(json(kind === "foreign-url" ? "https://foreign.invalid" : DB, [{ private_beta_program: { ...f.state.program, database_role: "authenticated" } }], 201));
    });
    expect(await f.run("prepare")).toMatchObject({ state: "BLOCKED", mutation_state: "NOT_ATTEMPTED" }); expect(f.state.envWrites).toHaveLength(0); expect(f.state.edgeWrites).toHaveLength(0);
  });
  it.each([202, 204, 401, 403, 429, 500])("rejects query HTTP%i without retries or mutation", async status => {
    const f = fixture(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation((url, init) => {
      if (String(url) !== DB) return original(url, init);
      const r = new Response(status === 204 ? null : "[]", { status, headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: DB }); return Promise.resolve(r);
    });
    expect(await f.run("prepare")).toMatchObject({ state: "BLOCKED", reason: "INGRESS_RESPONSE_INVALID", request_stage: "SUPABASE_PROGRAM", request_http_status: status, mutation_state: "NOT_ATTEMPTED" });
    expect(f.request.mock.calls.filter(([url]) => url === DB)).toHaveLength(1); expect(f.state.envWrites).toHaveLength(0);
  });
  it("does not accept201 on Vercel GET as a side effect of the query status fix", async () => {
    const f = fixture(); f.request.mockImplementation(async url => json(String(url), f.state.project, 201));
    expect(await f.run("prepare")).toMatchObject({ state: "BLOCKED", reason: "INGRESS_RESPONSE_INVALID", request_stage: "VERCEL_PROJECT", request_http_status: 201 }); expect(f.request).toHaveBeenCalledOnce();
  });
  it.each(["project", "team"])("accepts valid finite exponent-form and nested Vercel %s metadata without changing model/payment parsing", async kind => {
    const f = fixture(), original = f.request.getMockImplementation()!, path = kind === "project" ? "/v9/projects/" : "/v2/teams/";
    const raw = JSON.stringify(kind === "project" ? f.state.project : f.state.team).slice(0, -1)
      + ',"billingMetadata":{"smallUnitPrice":1e-8,"fraction":0.123456789012345678901,"zero":0e3},"nested":'
      + '['.repeat(20) + 'null' + ']'.repeat(20) + ',"resources":[' + '0,'.repeat(4999) + '0]}';
    f.request.mockImplementation((url, init) => String(url).includes(path) ? Promise.resolve(rawJson(String(url), raw)) : original(url, init));
    expect(await f.run("prepare")).toMatchObject({ state: "PREPARED", sso_changed: false, actual_inference_requests: 0, telegram_messages: 0 });
    expect(f.state.methods).toHaveLength(0); expect(f.state.envWrites).toHaveLength(4);
  });
  it.each([
    '"same":1,"same":2', '"same":1,"s\\u0061me":2', '"__proto__":{}', '"constructor":{}', '"prototype":{}',
    '"bad":1e309', '"bad":1e-999', '"bad":9007199254740992', '"bad":01', '"bad":NaN', '"bad":"\\ud800"',
    '"bad":' + '['.repeat(34) + 'null' + ']'.repeat(34), '"bad":[' + '0,'.repeat(32768) + '0]',
  ])("rejects invalid or ambiguous Vercel metadata before any writes (%#)", async fragment => {
    const f = fixture(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation((url, init) => String(url).includes("/v2/teams/")
      ? Promise.resolve(rawJson(String(url), JSON.stringify(f.state.team).slice(0, -1) + ',' + fragment + '}')) : original(url, init));
    const result = await f.run("prepare");
    expect(result).toMatchObject({ state: "BLOCKED", reason: "INGRESS_RESPONSE_JSON_INVALID", request_stage: "VERCEL_TEAM", request_http_status: 200, mutation_state: "NOT_ATTEMPTED" });
    expect(f.state.envWrites).toHaveLength(0); expect(f.state.edgeWrites).toHaveLength(0); expect(f.state.queries).toHaveLength(0);
  });
  it("keeps duplicate protected identity fields invalid even when the last value matches the exact target", async () => {
    const f = fixture();
    f.request.mockImplementation(async url => rawJson(String(url), '{"id":"foreign","id":' + JSON.stringify(TARGET.project) + '}'));
    expect(await f.run("prepare")).toMatchObject({ state: "BLOCKED", reason: "INGRESS_RESPONSE_JSON_INVALID", request_stage: "VERCEL_PROJECT", request_http_status: 200 });
    expect(f.request).toHaveBeenCalledOnce(); expect(f.state.envWrites).toHaveLength(0);
  });
  it("retains the1MiB streamed response bound for infrastructure metadata", async () => {
    const f = fixture(); f.request.mockImplementation(async url => rawJson(String(url), '{"padding":"' + "x".repeat(1048576) + '"}'));
    expect(await f.run("prepare")).toMatchObject({ state: "BLOCKED", reason: "INGRESS_RESPONSE_BOUND", request_stage: "VERCEL_PROJECT", request_http_status: 200 });
    expect(f.state.envWrites).toHaveLength(0); expect(f.request).toHaveBeenCalledOnce();
  });
  it("retains strict numbers for Supabase evidence instead of applying the infrastructure parser globally", async () => {
    const f = fixture(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation((url, init) => String(url) === DB
      ? Promise.resolve(rawJson(String(url), '[{"private_beta_program":' + JSON.stringify(f.state.program).slice(0, -1) + ',"value":1e-8}}]')) : original(url, init));
    expect(await f.run("prepare")).toMatchObject({ state: "BLOCKED", reason: "INGRESS_RESPONSE_JSON_INVALID", request_stage: "SUPABASE_PROGRAM", request_http_status: 200, mutation_state: "NOT_ATTEMPTED" });
    expect(f.state.envWrites).toHaveLength(0); expect(f.state.edgeWrites).toHaveLength(0);
  });
  it("reports only static request stage and HTTP status for a denied read, never upstream body or credentials", async () => {
    const f = fixture(), original = f.request.getMockImplementation()!;
    f.request.mockImplementation((url, init) => String(url).includes("/v2/teams/")
      ? Promise.resolve(rawJson(String(url), JSON.stringify({ error: BOT + BYPASS + MANAGEMENT + VERCEL }), 403)) : original(url, init));
    const result = await f.run("prepare");
    expect(result).toMatchObject({ state: "BLOCKED", reason: "INGRESS_RESPONSE_INVALID", request_stage: "VERCEL_TEAM", request_http_status: 403, mutation_state: "NOT_ATTEMPTED" });
    for (const sensitive of [BOT, BYPASS, MANAGEMENT, VERCEL, TARGET.project, TARGET.team, "api.vercel.com"]) expect(JSON.stringify(result)).not.toContain(sensitive);
    expect(f.state.envWrites).toHaveLength(0); expect(f.state.edgeWrites).toHaveLength(0); expect(f.request).toHaveBeenCalledTimes(2);
  });
  it("generates private secrets only when absent, fixes selectors from PostgreSQL and keeps SSO unchanged", async () => {
    const f = fixture(), result = await f.run("prepare");
    expect(result).toMatchObject({ state: "PREPARED", mutation_state: "ACKNOWLEDGED", edge_function_deployed: false, sso_changed: false, actual_inference_requests: 0, telegram_messages: 0, provider_billing: "UNKNOWN", provider_enforced_cap: "UNVERIFIED" });
    expect(f.random).toHaveBeenCalledTimes(2); expect(f.state.envWrites.map(v => v.key)).toEqual([...SECRET_NAMES, ...SELECTORS]);
    expect(f.state.envWrites.map(v => v.type)).toEqual(["encrypted", "encrypted", "plain", "plain"]); for (const v of f.state.envWrites) expect(v.target).toEqual(["production"]);
    expect(f.state.entries.find(v => v.key === SELECTORS[0])?.value).toBe(TENANT); expect(f.state.entries.find(v => v.key === SELECTORS[1])?.value).toBe(PROGRAM);
    expect(f.state.edgeWrites[0]!.map(v => v.name)).toEqual([...SECRET_NAMES, "JEFF_UAT_VERCEL_BYPASS"]); expect(f.state.edgeWrites[0]![2]!.value).toBe(BYPASS);
    const path = join(f.dir, "private-beta-founder-ingress-private.json"); expect(statSync(path).mode & 0o777).toBe(0o600);
    const privateValue = readFileSync(path, "utf8"); expect(privateValue).toContain(BYPASS); expect(JSON.stringify(result)).not.toContain(BYPASS);
    expect(f.state.methods).toEqual([]); expect(f.state.queries).toHaveLength(1); expect(f.state.queries[0]).not.toMatch(/update |insert |set configuration/iu);
    for (const sensitive of [BOT, MANAGEMENT, VERCEL, BYPASS, TENANT, PROGRAM]) expect(JSON.stringify(result)).not.toContain(sensitive);
  });
  it("reuses existing values and is idempotent for private same-job custody", async () => {
    const f = fixture(); f.add(SECRET_NAMES[0]!, "x".repeat(43)); f.add(SECRET_NAMES[1]!, "y".repeat(43)); f.add(SELECTORS[0]!, TENANT); f.add(SELECTORS[1]!, PROGRAM);
    expect(await f.run("prepare")).toMatchObject({ state: "PREPARED", updated_names: [] }); expect(await f.run("prepare")).toMatchObject({ state: "PREPARED", updated_names: [] });
    expect(f.random).not.toHaveBeenCalled(); expect(f.state.envWrites).toHaveLength(0); expect(f.state.edgeWrites).toHaveLength(2); expect(f.state.edgeWrites[0]).toEqual(f.state.edgeWrites[1]);
  });
  it("accepts the documented bodyless201 secret-write ACK without treating it as delivery or secret readback", async () => {
    const f = fixture();
    expect(await f.run("prepare")).toMatchObject({ state: "PREPARED", edge_secret_write: "ACKNOWLEDGED", ingress_authentication_verified: false, upstream_hmac_delivery_verified: false });
    expect(f.state.edgeWrites).toHaveLength(1); expect(f.state.edgeProbes).toHaveLength(0);
  });
  it.each([200, 204, 401, 500])("does not invent a Supabase secret-write ACK from undocumented or denied HTTP%i", async status => {
    const f = fixture(); f.state.secretsStatus = status;
    expect(await f.run("prepare")).toMatchObject({ state: "BLOCKED", mutation_state: "UNVERIFIED", ingress_authentication_verified: false });
    expect(f.state.edgeWrites).toHaveLength(1); expect(f.state.methods).toHaveLength(0);
  });
  it.each([undefined, false])("holds an encrypted value without affirmative decryption (%j), even if value is present", async decrypted => {
    const f = fixture(); f.add(SECRET_NAMES[0]!, "x".repeat(43)); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation((url, init) => String(url).includes("/v1/projects/" + TARGET.project + "/env/")
      ? Promise.resolve(json(String(url), { ...f.state.entries[0], decrypted })) : original(url, init));
    expect(await f.run("prepare")).toMatchObject({ state: "BLOCKED", reason: "INGRESS_EXISTING_SECRET_UNREADABLE", mutation_state: "NOT_ATTEMPTED" });
    expect(f.state.envWrites).toHaveLength(0); expect(f.state.edgeWrites).toHaveLength(0);
  });
  it("accepts documented plain selectors when their optional decryption marker is absent", async () => {
    const f = fixture(); f.add(SELECTORS[0]!, TENANT); f.add(SELECTORS[1]!, PROGRAM); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation((url, init) => {
      const entry = f.state.entries.find(e => SELECTORS.includes(e.key) && String(url).includes("/v1/projects/" + TARGET.project + "/env/" + e.id));
      return entry ? Promise.resolve(json(String(url), { ...entry, decrypted: undefined })) : original(url, init);
    });
    expect(await f.run("prepare")).toMatchObject({ state: "PREPARED" });
  });
  it("can prepare a local technical-passed CANARY without changing the active application or deploying a function", async () => {
    const f = fixture(); f.activate();
    expect(await f.run("prepare")).toMatchObject({ state: "PREPARED", edge_function_deployed: false }); expect(f.state.methods).toHaveLength(0);
  });
  it("prepares the independently eligible continuation without inference, webhook registration or a manufactured owner grant", async () => {
    const f = fixture();
    Object.assign(f.state.program, { stage: "CANARY", owner_only_test: true, continuation_available: true, canary_result_hash: null });
    const result = await f.run("prepare");
    expect(result).toMatchObject({ state: "PREPARED", actual_inference_requests: 0, telegram_messages: 0, webhook_registration: "NOT_ATTEMPTED" });
    expect(f.state.queries.some(sql => sql.includes("private.private_beta_continuation_available(p)"))).toBe(true);
    expect(f.state.methods).toEqual([]);
    expect(f.state.queries.every(sql => sql.startsWith("select "))).toBe(true);
  });
  it("still rejects registration before the real new canary even when continuation is eligible", async () => {
    const f = fixture();
    Object.assign(f.state.program, { stage: "CANARY", owner_only_test: true, continuation_available: true, canary_result_hash: null });
    await f.run("prepare");
    expect(await f.run("register")).toMatchObject({ state: "BLOCKED", reason: "INGRESS_OWNER_BUSINESS_REQUIRED" });
    expect(f.state.setCalls).toHaveLength(0);
  });
  it("prepares only an independently eligible stopped setup without clearing STOP or registering a webhook", async () => {
    const f = fixture(); Object.assign(f.state.program, { stage: "STOPPED", continuation_available: true, owner_only_test: true });
    expect(await f.run("prepare")).toMatchObject({ state: "PREPARED", actual_inference_requests: 0, telegram_messages: 0 });
    expect(f.state.program.stage).toBe("STOPPED"); expect(f.state.methods).toHaveLength(0);
    expect(await f.run("register")).toMatchObject({ state: "BLOCKED", reason: "INGRESS_PROGRAM_REQUIRED" });
  });
  it("never uses continuation eligibility to prepare a non-owner-only program", async () => {
    const f = fixture();
    Object.assign(f.state.program, { stage: "CANARY", continuation_available: true, owner_only_test: false });
    expect(await f.run("prepare")).toMatchObject({ state: "BLOCKED", reason: "INGRESS_PROGRAM_REQUIRED", mutation_state: "NOT_ATTEMPTED" });
    expect(f.state.envWrites).toHaveLength(0);
  });
  it.each(["missing-bypass", "share-bypass", "selector", "unreadable", "duplicate", "preview-scope", "pagination"])("holds %s before any configuration mutation", async kind => {
    const f = fixture();
    if (kind === "missing-bypass") f.state.project.protectionBypass = {};
    if (kind === "share-bypass") f.state.project.protectionBypass[BYPASS]!.scope = "shareable-link";
    if (kind === "selector") f.add(SELECTORS[0]!, "91cc2000-0000-4000-8000-000000000002");
    if (kind === "unreadable") f.add(SECRET_NAMES[0]!, "x".repeat(43), false);
    if (kind === "duplicate") { f.add(SECRET_NAMES[0]!, "x".repeat(43)); f.add(SECRET_NAMES[0]!, "y".repeat(43)); }
    if (kind === "preview-scope") { f.add(SECRET_NAMES[0]!, "x".repeat(43)); f.state.entries[0]!.target = ["preview"]; }
    if (kind === "pagination") f.state.paginationNext = 123;
    const result = await f.run("prepare"); expect(result).toMatchObject({ state: "BLOCKED", mutation_state: "NOT_ATTEMPTED" }); expect(f.state.envWrites).toHaveLength(0); expect(f.state.edgeWrites).toHaveLength(0); expect(f.state.methods).toHaveLength(0);
    if (kind === "unreadable") expect(result.reason).toBe("INGRESS_EXISTING_SECRET_UNREADABLE");
    if (kind === "missing-bypass" || kind === "share-bypass") expect(result.reason).toBe("INGRESS_AUTOMATION_BYPASS_REQUIRED");
  });
  it.each(["team", "project", "sso", "git", "role", "tenant", "outbound", "friends", "legacy-canary"])("rejects incorrect identity/protection/scope %s", async change => {
    const f = fixture();
    if (change === "team") f.state.project.accountId = "team_foreign"; if (change === "project") f.state.project.id = "prj_foreign";
    if (change === "sso") f.state.project.ssoProtection.deploymentType = "preview"; if (change === "git") f.state.project.link.repo = "another-repo";
    if (change === "role") f.state.program.database_role = "service_role"; if (change === "tenant") f.state.program.tenant_slug = "production"; if (change === "outbound") f.state.program.outbound_messaging_enabled = true;
    if (change === "friends") f.state.program.stage = "FRIENDS"; if (change === "legacy-canary") f.state.program.stage = "CANARY";
    expect(await f.run("prepare")).toMatchObject({ state: "BLOCKED", mutation_state: "NOT_ATTEMPTED" }); expect(f.state.envWrites).toHaveLength(0); expect(f.state.edgeWrites).toHaveLength(0);
  });
  it("registers only after current release, technical canary, independent Business permission and exact bot identity", async () => {
    const f = fixture(); await f.run("prepare"); f.activate(); const result = await f.run("register");
    expect(result).toMatchObject({ state: "REGISTERED", webhook_registration: "VERIFIED", webhook_configuration_verified: true, ingress_authentication_verified: true, upstream_hmac_delivery_verified: false, inbound_delivery_observed: false, actual_inference_requests: 0, telegram_messages: 0, provider_billing: "UNKNOWN", provider_enforced_cap: "UNVERIFIED", bot_id: "7012345" });
    expect(f.state.methods).toEqual(["getMe", "getWebhookInfo", "setWebhook", "getWebhookInfo"]); expect(f.state.setCalls).toHaveLength(1);
    expect(f.state.setCalls[0]).toMatchObject({ url: EDGE, allowed_updates: UPDATES, max_connections: 1, drop_pending_updates: false }); expect(f.state.setCalls[0]!.secret_token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(f.state.botProof).toMatchObject({ version: 1, bot_id: "7012345", credential_sha256: digest(BOT), api_environment: "production" });
    const write = f.state.queries.find(q => q.startsWith("do $founder_bot$"))!; expect(write).toContain("p.generation=4"); expect(write).toContain("private.private_beta_business_permitted"); expect(write).toContain("private.private_beta_live_window");
    expect(write).not.toMatch(/account_control_record|reconcile|admin_private_beta_transition|set configuration/iu);
    expect(f.state.edgeProbes).toHaveLength(2);
    expect(f.state.edgeProbes[0]).toEqual({ headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "PRIVATE_BETA_INVALID_PROBE" }, body: "{}" });
    expect(f.state.edgeProbes[1]).toEqual({ headers: { "content-type": "text/plain", "x-telegram-bot-api-secret-token": f.state.setCalls[0]!.secret_token }, body: "" });
    const probeCalls = f.request.mock.calls.filter(call => call[0] === EDGE);
    for (const [, init] of probeCalls) expect(init).toMatchObject({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) });
    expect(f.request.mock.calls.findIndex(call => call[0] === EDGE)).toBeLessThan(f.request.mock.calls.findIndex(call => String(call[0]).endsWith("/setWebhook")));
    for (const sensitive of [BOT, BYPASS, MANAGEMENT, VERCEL, PROGRAM, TENANT, String(f.state.setCalls[0]!.secret_token)]) expect(JSON.stringify(result)).not.toContain(sensitive);
  });
  it.each(["wrong-key", "not-deployed", "jwt-protected", "wrong-status"])("holds failed Edge authentication (%s) before webhook registration", async edgeMode => {
    const f = fixture(); await f.run("prepare"); f.activate(); f.state.edgeMode = edgeMode;
    const result = await f.run("register");
    expect(result).toMatchObject({ state: "BLOCKED", reason: "INGRESS_AUTHENTICATION_UNVERIFIED", ingress_authentication_verified: false, upstream_hmac_delivery_verified: false, webhook_registration: "NOT_ATTEMPTED" });
    expect(f.state.setCalls).toHaveLength(0); expect(f.state.botProof).toBeNull(); expect(JSON.stringify(result)).not.toContain(f.state.edgeWrites[0]![0]!.value);
  });
  it("bounds a stalled Edge authentication probe without retries or registration", async () => {
    const f = fixture(); await f.run("prepare"); f.activate(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation((url, init) => String(url) === EDGE ? new Promise(() => undefined) : original(url, init));
    vi.useFakeTimers(); const pending = f.run("register"); await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({ state: "BLOCKED", reason: "INGRESS_TIMEOUT", ingress_authentication_verified: false, webhook_registration: "NOT_ATTEMPTED" });
    expect(f.request.mock.calls.filter(call => call[0] === EDGE)).toHaveLength(1); expect(f.state.setCalls).toHaveLength(0);
  });
  it.each(["release", "model-release", "canary", "business", "identity", "founder", "legacy", "aliases", "deployment", "sso-drift", "bypass-revoked"])("does not register with missing/mismatched %s", async change => {
    const f = fixture(); await f.run("prepare"); f.activate();
    if (change === "release") f.state.program.repository_sha = "b".repeat(40); if (change === "model-release") f.state.program.model_observation_sha = "b".repeat(40); if (change === "canary") f.state.program.canary_result_hash = null;
    if (change === "business") f.state.program.business_permitted = false; if (change === "identity") f.state.program.bot_credential_hash = "0".repeat(64); if (change === "founder") f.state.program.founder_chat_id = f.state.program.representative_user_id;
    if (change === "legacy") f.state.program.owner_only_test = false; if (change === "aliases") f.state.aliasDeployment = "dpl_foreign"; if (change === "deployment") f.state.deployment.gitSource.sha = "b".repeat(40);
    if (change === "sso-drift") Object.assign(f.state.project.ssoProtection, { enabled: true }); if (change === "bypass-revoked") f.state.project.protectionBypass = {};
    expect(await f.run("register")).toMatchObject({ state: "BLOCKED", webhook_registration: "NOT_ATTEMPTED" }); expect(f.state.setCalls).toHaveLength(0);
  });
  it("cuts over the exact previous ingress only after all existing protected checks", async () => {
    const f = fixture(); await f.run("prepare"); f.activate();
    f.state.webhook = IDENTITY_NAMES_V1.betaIngress;
    const result = await f.run("register");
    expect(result).toMatchObject({ state: "REGISTERED", webhook_registration: "VERIFIED", ingress_authentication_verified: true });
    expect(f.state.methods).toEqual(["getMe", "getWebhookInfo", "setWebhook", "getWebhookInfo"]);
    expect(f.state.setCalls).toHaveLength(1);
    expect(f.state.setCalls[0]).toMatchObject({ url: EDGE, drop_pending_updates: false });
  });
  it.each(["foreign-webhook", "wrong-bot", "no-business-capability", "readback", "private-file-mode"])("blocks %s before setWebhook", async change => {
    const f = fixture(); await f.run("prepare"); f.activate();
    if (change === "foreign-webhook") f.state.webhook = "https://other-owner.invalid/webhook"; if (change === "wrong-bot") f.state.me.id++;
    if (change === "no-business-capability") f.state.me.can_connect_to_business = false; if (change === "readback") f.state.readbackValid = false;
    if (change === "private-file-mode") chmodSync(join(f.dir, "private-beta-founder-ingress-private.json"), 0o644);
    expect(await f.run("register")).toMatchObject({ state: "BLOCKED", webhook_registration: "NOT_ATTEMPTED" }); expect(f.state.setCalls).toHaveLength(0);
  });
  it.each(["transport", "http", "updates", "telegram-error"])("never retries an uncertain or unverified registration (%s)", async change => {
    const f = fixture(); await f.run("prepare"); f.activate();
    if (change === "transport") f.state.setThrows = true; if (change === "http") f.state.setStatus = 500;
    if (change === "updates") f.state.afterUpdates = ["message"]; if (change === "telegram-error") f.state.afterError = BOT + BYPASS;
    const result = await f.run("register"); expect(result).toMatchObject({ state: "BLOCKED", webhook_registration: "UNKNOWN", telegram_messages: 0 }); expect(f.state.setCalls).toHaveLength(1);
    expect(f.state.methods.filter(m => m === "setWebhook")).toHaveLength(1); expect(JSON.stringify(result)).not.toContain(BOT); expect(JSON.stringify(result)).not.toContain(BYPASS);
  });
  it("allows the existing canonical webhook and narrows updates without dropping or acknowledging pending input", async () => {
    const f = fixture(); await f.run("prepare"); f.activate(); f.state.webhook = EDGE;
    expect(await f.run("register")).toMatchObject({ state: "REGISTERED", inbound_delivery_observed: false }); expect(f.state.setCalls[0]!.drop_pending_updates).toBe(false);
    expect(f.state.methods).not.toContain("getUpdates"); expect(f.state.methods).not.toContain("sendMessage"); expect(f.state.methods).not.toContain("deleteWebhook");
  });
  it.each(["branch", "sha", "event", "actions", "program", "credential"])("requires protected exact input %s before HTTP", async kind => {
    const f = fixture();
    if (kind === "branch") f.env.GITHUB_REF = "refs/heads/feature"; if (kind === "sha") f.env.GITHUB_SHA = "b".repeat(40); if (kind === "event") f.env.GITHUB_EVENT_NAME = "pull_request"; if (kind === "actions") f.env.GITHUB_ACTIONS = "false";
    if (kind === "program") f.env.PRIVATE_BETA_PROGRAM_ID = "' or true--"; if (kind === "credential") delete f.env.VERCEL_TOKEN;
    expect(await f.run("prepare")).toMatchObject({ state: "BLOCKED", mutation_state: "NOT_ATTEMPTED" }); expect(f.request).not.toHaveBeenCalled();
  });
  it("does not reflect an invalid command or accept it as a configuration override", async () => {
    const f = fixture();
    const result = await runPrivateBetaFounderIngress({ command: BOT as "prepare", env: f.env, request: f.request });
    expect(result).toMatchObject({ state: "BLOCKED", operation: "INVALID", mutation_state: "NOT_ATTEMPTED" }); expect(JSON.stringify(result)).not.toContain(BOT); expect(f.request).not.toHaveBeenCalled();
  });
  it("redacts unexpected transport errors and times out without retries", async () => {
    const f = fixture(); f.request.mockRejectedValue(Error(BOT + MANAGEMENT + BYPASS));
    const result = await f.run("prepare"); expect(result).toMatchObject({ state: "BLOCKED", reason: "INGRESS_READ_UNAVAILABLE", request_stage: "VERCEL_PROJECT", mutation_state: "NOT_ATTEMPTED" }); expect(result.request_http_status).toBeUndefined(); expect(JSON.stringify(result)).not.toContain(BOT); expect(f.request).toHaveBeenCalledOnce();
    vi.useFakeTimers(); const stalled = fixture(); stalled.request.mockImplementation(() => new Promise(() => undefined));
    const pending = stalled.run("prepare"); await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({ state: "BLOCKED", reason: "INGRESS_TIMEOUT" }); expect(stalled.request).toHaveBeenCalledOnce();
  });
});
