import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { polatBridgeHashSchema, polatBridgeMoneySchema } from "@gold-revenue-os/contracts";
import { ModelProviderError, type ModelProvider, type ModelRequest, type ModelResponse } from "./agent-runtime";
import { preparePolatClaudeRequest, PolatClaudeFailure } from "./polat-claude-adapter";
import { sendPolatClaudeHttpsOnce } from "./polat-claude-https-boundary";
import { polatPrivateBetaBindingSchema, type createPolatPrivateBetaNetworkAuthority } from "./polat-experiment-execution-gate";
import { polatGuardDigest } from "./polat-experiment-journal";
import { parsePolatClaudeJson } from "./polat-claude-json";

export const polatPrivateBetaReservationSchema = z.strictObject({
  version: z.literal(1), mode: z.literal("PRIVATE_BETA_UAT"), program_id: z.uuid(), tenant_id: z.uuid(), run_id: z.uuid(), native_run_id: z.uuid(), attempt_id: z.uuid(),
  binding_hash: polatBridgeHashSchema, request_hash: polatBridgeHashSchema, body_hash: polatBridgeHashSchema,
  replay: z.boolean(), dispatch_started: z.boolean(), liability: polatBridgeMoneySchema,
});
export type PolatPrivateBetaReservation = z.infer<typeof polatPrivateBetaReservationSchema>;
const liabilityPricingProof = z.strictObject({
  version: z.literal(1), origin: z.literal("INDEPENDENT_OFFICIAL_PRICING_READ"), model: z.literal("claude-haiku-5-5"), currency: z.literal("USD"),
  source_url: z.literal("https://platform.claude.com/docs/en/models/haiku-5-5/overview"), source_hash: polatBridgeHashSchema,
  maximum_input_tokens: z.literal(1000000), maximum_input_usd_per_million: z.literal("0.50"), maximum_output_usd_per_million: z.literal("2.50"),
  observed_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }), all_billable_components_covered: z.literal(true),
});
/** Conservative liability bound, never an actual bill or an entitlement. Uses the model's full documented input limit rather than an estimated tokenizer count. */
export function boundPolatPrivateBetaLiability(request: ModelRequest, maximumOutputTokens: number, rawPricingProof: unknown, now = Date.now()) {
  const wire = preparePolatClaudeRequest(request, maximumOutputTokens);
  return boundPolatPrivateBetaWireLiability({ request_hash: wire.request_hash, body_hash: wire.body_hash, maximum_output_tokens: maximumOutputTokens }, rawPricingProof, now);
}
/** Same deterministic bound for a wire binding obtained internally from preparePolatClaudeRequest, never a client-provided hash approval. */
export function boundPolatPrivateBetaWireLiability(rawWire: { request_hash: string; body_hash: string; maximum_output_tokens: number }, rawPricingProof: unknown, now = Date.now()) {
  const pricing = liabilityPricingProof.parse(rawPricingProof), wire = z.strictObject({ request_hash: polatBridgeHashSchema, body_hash: polatBridgeHashSchema, maximum_output_tokens: z.number().int().min(1).max(512) }).parse(rawWire), maximumOutputTokens = wire.maximum_output_tokens;
  if (!Number.isFinite(now) || Date.parse(pricing.observed_at) > now || now - Date.parse(pricing.observed_at) > 86400000 || Date.parse(pricing.expires_at) <= now || Date.parse(pricing.expires_at) > Date.parse(pricing.observed_at) + 86400000) throw Error("POLAT_UAT_PRICING_STALE");
  const liability = (500000000000000000n * BigInt(pricing.maximum_input_tokens) + 2500000000000000000n * BigInt(maximumOutputTokens)) / 1000000n;
  return Object.freeze({ request_hash: wire.request_hash, body_hash: wire.body_hash, maximum_output_tokens: maximumOutputTokens, maximum_possible_charge: usdString(liability),
    pricing_evidence_hash: polatGuardDigest(pricing), valid_until: new Date(Math.min(Date.parse(pricing.expires_at), now + 300000)).toISOString() });
}
/** Public documentation read in the isolated account-control process. No credential, arbitrary URL, inference or price assumption fallback. */
export async function readPolatPrivateBetaOfficialPricing(now = Date.now()) {
  const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 10000);
  try {
    if (!Number.isFinite(now)) throw Error("clock");
    const url = "https://platform.claude.com/docs/en/models/haiku-5-5/overview.md";
    const response = await fetch(url, { method: "GET", redirect: "error", headers: { accept: "text/markdown, text/plain" }, signal: controller.signal });
    if (response.status !== 200 || response.redirected || response.url !== url || !/^text\/(?:markdown|plain)(?:;|$)/iu.test(response.headers.get("content-type") ?? "") || !response.body) throw Error("response");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; const chunk: unknown = part.value; if (!(chunk instanceof Uint8Array)) throw Error("body"); size += chunk.length; if (size > 131072) throw Error("bound"); chunks.push(chunk); } }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), normalized = raw.replaceAll(",", "");
    const section = /^#{2,3}\s+Pricing\s*$/imu.exec(normalized), pricing = section ? normalized.slice(section.index + section[0].length).split(/^#{2,3}\s/mu)[0] ?? "" : "";
    if (!/^(?:#\s+Claude Haiku 5\.5\b|title:\s*["']?Claude Haiku 5\.5["']?\s*$)/mu.test(normalized) || !/Context window[\s\S]{0,180}\b1M tokens\b/iu.test(normalized)
      || !/\bInput\b[\s\S]{0,180}\$0\.10[\s\S]{0,180}\b100000 tokens\b[\s\S]{0,180}\$0\.50[\s\S]{0,180}\bOutput\b[\s\S]{0,180}\$0\.50[\s\S]{0,180}\b100000 tokens\b[\s\S]{0,180}\$2\.50/iu.test(pricing)) throw Error("pricing-format-or-rate-drift");
    const proof = liabilityPricingProof.omit({ all_billable_components_covered: true }).parse({ version: 1, origin: "INDEPENDENT_OFFICIAL_PRICING_READ", model: "claude-haiku-5-5", currency: "USD", source_url: "https://platform.claude.com/docs/en/models/haiku-5-5/overview", source_hash: createHash("sha256").update(raw, "utf8").digest("hex"), maximum_input_tokens: 1000000, maximum_input_usd_per_million: "0.50", maximum_output_usd_per_million: "2.50", observed_at: new Date(now).toISOString(), expires_at: new Date(now + 86400000).toISOString() });
    // A public price page cannot prove account-specific surcharges, region or service tier.
    return Object.freeze({ state: "PRICES_OBSERVED" as const, proof: Object.freeze(proof), account_billable_scope: "UNVERIFIED" as const, external_inference_requests: 0 as const, actual_billed_amount: null });
  } catch { return Object.freeze({ state: "BLOCKED" as const, reason: "CURRENT_OFFICIAL_PRICING_UNVERIFIED" as const, external_inference_requests: 0 as const, actual_billed_amount: null }); }
  finally { clearTimeout(deadline); }
}
export type PolatPrivateBetaProviderOutcome = Readonly<{
  version: 1; stage: "PROVIDER_RESULT" | "RESULT_UNKNOWN"; status: "SUCCEEDED" | "FAILED" | "UNKNOWN";
  response_hash: string | null; response_identity_hash: string | null; elapsed_ms: string | null;
  input_tokens: number | null; output_tokens: number | null; qa: "APPROVED" | "HELD" | "NOT_EVALUATED";
  actual_billed_amount: null; actual_billed_currency: null; financial_authority: "NONE";
  error_code: string | null; provider_usage_hash: string | null;
}>;
export interface PolatPrivateBetaAttemptStore {
  /** Must COMMIT the global/program/participant request and exact-decimal reservation before returning. */
  reserve(value: { program_id: string; native_run_id: string; conversation_id: string; request_hash: string; body_hash: string; source_message_id: string | null }): Promise<unknown>;
  /** Exactly one COMMITTED start. A timeout or restart never makes a begun attempt dispatchable again. */
  begin(reservation: PolatPrivateBetaReservation): Promise<{ dispatch: boolean }>;
  record(reservation: PolatPrivateBetaReservation, outcome: PolatPrivateBetaProviderOutcome): Promise<void>;
}

/** Genuine ModelProvider extension of the existing codec/gate/journal. No environment or credential loader, fallback, retry, regeneration, browser import or network URL parameter. */
export function createPolatPrivateBetaProvider(dependencies: Readonly<{
  binding: unknown;
  authority: ReturnType<typeof createPolatPrivateBetaNetworkAuthority>;
  store: PolatPrivateBetaAttemptStore;
  assess: (request: ModelRequest, response: ModelResponse) => "APPROVED" | "HELD" | Promise<"APPROVED" | "HELD">;
}>) {
  const binding = polatPrivateBetaBindingSchema.parse(dependencies.binding), pending = new Set<string>();
  let last: Readonly<{ attempt_id: string; outcome: PolatPrivateBetaProviderOutcome }> | null = null;
  const provider: ModelProvider = Object.freeze({
    provider: "anthropic", model: binding.model,
    async invoke(raw: ModelRequest): Promise<ModelResponse> {
      const request = structuredClone(raw);
      if (request.timeoutMs !== binding.timeout_ms || request.context.tenantId !== binding.tenant_id || pending.has(request.requestId)) throw new ModelProviderError("PROVIDER_ERROR", "POLAT_UAT_SCOPE_OR_CONCURRENT_REPLAY_DENIED", false);
      if ((await dependencies.authority.preflight(binding)).state !== "READY") throw new ModelProviderError("PROVIDER_ERROR", "POLAT_UAT_OWNER_ACCOUNT_PREFLIGHT_BLOCKED", false);
      const wire = preparePolatClaudeRequest(request, binding.maximum_output_tokens);
      pending.add(request.requestId);
      let reservation: PolatPrivateBetaReservation;
      try {
        reservation = polatPrivateBetaReservationSchema.parse(await dependencies.store.reserve({ program_id: binding.program_id, native_run_id: request.requestId, conversation_id: request.context.conversationId, request_hash: wire.request_hash, body_hash: wire.body_hash, source_message_id: binding.corpus_version === "polat-claude-canary-v1" ? null : request.context.recentMessages.at(-1)?.id ?? null }));
        if (reservation.program_id !== binding.program_id || reservation.tenant_id !== binding.tenant_id || reservation.native_run_id !== request.requestId || reservation.binding_hash !== polatGuardDigest(binding) || reservation.request_hash !== wire.request_hash || reservation.body_hash !== wire.body_hash || reservation.liability !== binding.maximum_attempt_liability || reservation.replay || reservation.dispatch_started) throw Error("RESERVATION_DENIED");
        if (!(await dependencies.store.begin(reservation)).dispatch) throw Error("ALREADY_STARTED");
      } catch {
        throw new ModelProviderError("PROVIDER_ERROR", "POLAT_UAT_RESERVATION_UNAVAILABLE_OR_REPLAY", false);
      } finally {
        // DB custody, not this process-local set, prevents a second dispatch after restart.
        pending.delete(request.requestId);
      }
      let response: ModelResponse | null = null, outcome: PolatPrivateBetaProviderOutcome;
      const start = performance.now();
      try {
        const permit = await dependencies.authority.issue({ binding, run_id: reservation.run_id, attempt_id: reservation.attempt_id, request });
        const result = await sendPolatClaudeHttpsOnce(permit, request);
        response = result.response;
        const usageMissing = response.usage.inputTokens === null || response.usage.outputTokens === null;
        const qa = await dependencies.assess(request, response);
        outcome = { version: 1, stage: "PROVIDER_RESULT", status: "SUCCEEDED", response_hash: result.response_hash,
          response_identity_hash: response.providerRequestId ? createHash("sha256").update(JSON.stringify([response.provider, response.providerRequestId]), "utf8").digest("hex") : null,
          elapsed_ms: response.latencyMs.toFixed(6), input_tokens: response.usage.inputTokens, output_tokens: response.usage.outputTokens,
          qa: usageMissing ? "HELD" : qa, actual_billed_amount: null, actual_billed_currency: null, financial_authority: "NONE",
          error_code: usageMissing ? "POLAT_UAT_USAGE_UNAVAILABLE" : null, provider_usage_hash: createHash("sha256").update(JSON.stringify(result.provider_usage), "utf8").digest("hex") };
      } catch (error) {
        const elapsed = performance.now() - start, unknown = error instanceof PolatClaudeFailure && error.outcome_unknown;
        outcome = { version: 1, stage: unknown ? "RESULT_UNKNOWN" : "PROVIDER_RESULT", status: unknown ? "UNKNOWN" : "FAILED", response_hash: null, response_identity_hash: null,
          elapsed_ms: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed.toFixed(6) : null, input_tokens: null, output_tokens: null, qa: "NOT_EVALUATED",
          actual_billed_amount: null, actual_billed_currency: null, financial_authority: "NONE", error_code: error instanceof ModelProviderError && /^(?:CLAUDE|POLAT_UAT)_[A-Z0-9_]{1,100}$/u.test(error.code) ? error.code : "POLAT_UAT_AUTHORITY_OR_PROVIDER_UNAVAILABLE", provider_usage_hash: null };
      }
      try { await dependencies.store.record(reservation, outcome); }
      catch { throw new ModelProviderError("PROVIDER_ERROR", "POLAT_UAT_EVIDENCE_COMMIT_UNKNOWN_REVIEW_REQUIRED", false); }
      last = Object.freeze({ attempt_id: reservation.attempt_id, outcome: Object.freeze(outcome) });
      if (!response || outcome.error_code === "POLAT_UAT_USAGE_UNAVAILABLE" || outcome.status !== "SUCCEEDED") throw new ModelProviderError(outcome.status === "UNKNOWN" ? "TIMEOUT" : "PROVIDER_ERROR", outcome.error_code ?? "POLAT_UAT_QA_HELD", false);
      return response; // The actual provider output is never replaced with a fixture or a safe substitute.
    },
  });
  return Object.freeze({ provider, evidence: () => last, automatic_retries: 0 as const, automatic_fallbacks: 0 as const, qa_regenerations: 0 as const, financial_authority: "NONE" as const });
}

export const POLAT_UAT_ACCOUNT_API_VERSION = "2026-10-21" as const;
const providerId = (prefix: string) => z.string().regex(new RegExp("^" + prefix + "_[A-Za-z0-9]{1,120}$", "u"));
export const polatAnthropicAccountReadConfigSchema = z.strictObject({
  workspace_id: providerId("wrkspc"), spend_limit_id: providerId("spl"), api_key_id: providerId("apikey"),
  program_starts_at: z.iso.datetime({ offset: true }), program_expires_at: z.iso.datetime({ offset: true }),
});
const cents = z.string().regex(/^(0|[1-9][0-9]*)(?:\.[0-9]{1,16})?$/u).refine(v => v.replace(".", "").length <= 30);
const centUnits = (raw: string) => { const [a, d = ""] = cents.parse(raw).split("."); return BigInt(a!) * 10n ** 16n + BigInt(d.padEnd(16, "0")); };
const usdString = (atomic: bigint) => { const a = atomic / 10n ** 18n, d = (atomic % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/u, ""); return a + (d ? "." + d : ""); };
const workspaceSchema = z.object({ id: providerId("wrkspc"), name: z.string().min(1).max(200), archived_at: z.iso.datetime({ offset: true }).nullable().optional() });
const spendLimitSchema = z.object({
  type: z.literal("spend_limit"), id: providerId("spl"), amount: z.string().regex(/^(0|[1-9][0-9]{0,20})$/u), currency: z.literal("USD"),
  is_enabled: z.literal(true), period: z.literal("monthly"), scope: z.strictObject({ type: z.literal("workspace"), workspace_id: providerId("wrkspc") }),
  created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }),
});
const keyListSchema = z.object({ data: z.array(z.object({ id: providerId("apikey"), status: z.literal("active"), scope: z.strictObject({ type: z.literal("workspace"), workspace_id: providerId("wrkspc") }), expires_at: z.iso.datetime({ offset: true }).nullable() })).max(2), has_more: z.literal(false) });
const costReportSchema = z.object({
  data: z.array(z.object({ starting_at: z.iso.datetime({ offset: true }), ending_at: z.iso.datetime({ offset: true }), results: z.array(z.object({ amount: cents, currency: z.literal("USD"), workspace_id: providerId("wrkspc").nullable() })).max(256) })).max(31),
  has_more: z.literal(false), next_page: z.null(),
});

/** Read-only official account boundary. No provider setting changes, inference, retry, redirect, URL injection or response-body logging. */
async function accountGet(path: string, credential: string, signal?: AbortSignal) {
  if (credential.length < 16 || credential.length > 4096 || /[\r\n\0]/u.test(credential) || signal?.aborted) throw Error("POLAT_UAT_ACCOUNT_CREDENTIAL_UNAVAILABLE");
  const response = await new Promise<{ body: string; workspace: string | null; response_hash: string }>((resolve, reject) => {
    let ended = false, timer: ReturnType<typeof setTimeout> | null = null;
    const done = (value: { body: string; workspace: string | null; response_hash: string } | null) => {
      if (ended) return; ended = true; if (timer) clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (value) resolve(value); else { socket.destroy(); reject(Error("POLAT_UAT_ACCOUNT_READ_BLOCKED")); }
    };
    const abort = () => done(null);
    const socket = httpsRequest({ protocol: "https:", hostname: "api.anthropic.com", port: 443, path, method: "GET", maxHeaderSize: 8192, minVersion: "TLSv1.2", rejectUnauthorized: true,
      headers: { "anthropic-version": POLAT_UAT_ACCOUNT_API_VERSION, "x-api-key": credential, accept: "application/json" } }, incoming => {
      if (incoming.statusCode !== 200 || typeof incoming.headers["content-type"] !== "string" || !/^application\/json(?:\s*;|$)/iu.test(incoming.headers["content-type"])) { incoming.resume(); done(null); return; }
      const parts: Buffer[] = []; let size = 0;
      incoming.on("data", (chunk: Buffer) => { if (ended) return; size += chunk.length; if (size > 262144) { done(null); return; } parts.push(chunk); });
      incoming.on("aborted", abort); incoming.on("error", abort);
      incoming.on("end", () => { if (ended) return; try {
        const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)), workspace = incoming.headers["anthropic-workspace-id"];
        if (workspace !== undefined && (typeof workspace !== "string" || !/^wrkspc_[A-Za-z0-9]{1,120}$/u.test(workspace))) throw Error("invalid");
        done({ body, workspace: typeof workspace === "string" ? workspace : null, response_hash: createHash("sha256").update(body, "utf8").digest("hex") });
      } catch { done(null); } });
    });
    socket.on("error", abort); timer = setTimeout(abort, 10000); signal?.addEventListener("abort", abort, { once: true }); socket.end();
  });
  return { ...response, json: parsePolatClaudeJson(response.body, 262144) };
}

/** Run only in the protected account-control process. The Admin credential must not be placed in the general application environment. Returns observations, never a self-authorizing grant or a per-attempt bill. */
export async function readPolatAnthropicUatAccount(dependencies: Readonly<{
  config: unknown; adminCredential: () => Promise<string>; inferenceCredential: () => Promise<string>; now?: number; signal?: AbortSignal;
}>) {
  try {
    const config = polatAnthropicAccountReadConfigSchema.parse(dependencies.config), now = dependencies.now ?? Date.now(), clock = new Date(now), starts = Date.parse(config.program_starts_at), expires = Date.parse(config.program_expires_at);
    const monthStart = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), 1), monthEnd = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth() + 1, 1), nextDay = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate() + 1);
    if (!Number.isFinite(now) || starts < monthStart || starts > now || expires <= now || expires > monthEnd) throw Error("window");
    const admin = await dependencies.adminCredential();
    const workspace = await accountGet("/v1/organizations/workspaces/" + config.workspace_id, admin, dependencies.signal), w = workspaceSchema.parse(workspace.json);
    if (w.id !== config.workspace_id || w.name === "Default" || w.archived_at != null) throw Error("workspace");
    const limit = await accountGet("/v1/organizations/spend_limits/" + config.spend_limit_id, admin, dependencies.signal), l = spendLimitSchema.parse(limit.json);
    if (l.id !== config.spend_limit_id || l.scope.workspace_id !== config.workspace_id || BigInt(l.amount) < 1n || BigInt(l.amount) > 500n || Date.parse(l.updated_at) > now) throw Error("cap");
    const list = await accountGet("/v1/organizations/api_keys?" + new URLSearchParams({ workspace_id: config.workspace_id, status: "active", limit: "2" }).toString(), admin, dependencies.signal), keys = keyListSchema.parse(list.json);
    if (keys.data.length !== 1 || keys.data[0]?.id !== config.api_key_id || keys.data[0].scope.workspace_id !== config.workspace_id || keys.data[0].expires_at != null && Date.parse(keys.data[0].expires_at) <= now) throw Error("key");
    const inferenceCredential = await dependencies.inferenceCredential(), model = await accountGet("/v1/models/claude-haiku-5-5", inferenceCredential, dependencies.signal), m = z.object({ id: z.literal("claude-haiku-5-5"), type: z.literal("model") }).parse(model.json);
    if (m.id !== "claude-haiku-5-5" || model.workspace !== config.workspace_id) throw Error("model-workspace");
    const query = new URLSearchParams({ starting_at: new Date(monthStart).toISOString(), ending_at: new Date(nextDay).toISOString(), bucket_width: "1d", limit: "31" }); query.append("group_by[]", "workspace_id");
    const cost = await accountGet("/v1/organizations/cost_report?" + query.toString(), admin, dependencies.signal), report = costReportSchema.parse(cost.json);
    let boundary = monthStart, amount = 0n;
    for (const bucket of report.data) {
      if (Date.parse(bucket.starting_at) !== boundary || Date.parse(bucket.ending_at) !== boundary + 86400000) throw Error("history");
      for (const row of bucket.results) if (row.workspace_id === config.workspace_id) amount += centUnits(row.amount);
      boundary += 86400000;
    }
    if (boundary !== nextDay || amount > BigInt(l.amount) * 10n ** 16n) throw Error("incomplete-or-cap");
    return Object.freeze({ state: "OBSERVED" as const, observed_at: new Date(now).toISOString(), expires_at: new Date(Math.min(now + 300000, expires)).toISOString(),
      provider: "anthropic" as const, model: "claude-haiku-5-5" as const, workspace_scope_hash: polatGuardDigest(["ANTHROPIC_WORKSPACE1", config.workspace_id]),
      workspace_id: config.workspace_id, credential_custody_hash: polatGuardDigest(["POLAT_UAT_CREDENTIAL_CUSTODY1", polatGuardDigest(["ANTHROPIC_WORKSPACE1", config.workspace_id]), createHash("sha256").update(inferenceCredential, "utf8").digest("hex")]),
      configured_monthly_cap_usd: usdString(BigInt(l.amount) * 10n ** 16n), observed_month_to_date_usd: usdString(amount), observed_remaining_usd: usdString(BigInt(l.amount) * 10n ** 16n - amount),
      model_access_observed: true, active_workspace_keys_observed: 1, actual_attempt_billing: "UNKNOWN" as const,
      experiment_transaction_cap: "REQUIRES_COMMITTED_DURABLE_RESERVATION" as const, cost_report_may_lag: true,
      evidence_hash: polatGuardDigest(["ANTHROPIC_ACCOUNT_READ1", config, workspace.response_hash, limit.response_hash, list.response_hash, model.response_hash, cost.response_hash]),
      financial_authority: "NONE" as const, account_settings_changed: false as const, inference_requests: 0 as const });
  } catch {
    return Object.freeze({ state: "BLOCKED" as const, reason: "OFFICIAL_ACCOUNT_CAP_OR_USAGE_UNVERIFIED" as const, financial_authority: "NONE" as const, account_settings_changed: false as const, inference_requests: 0 as const });
  }
}
