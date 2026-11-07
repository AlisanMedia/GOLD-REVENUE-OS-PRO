import { request as httpsRequest } from "node:https";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { parseJeffClaudeJson } from "./jeff-claude-json";
import { prepareJeffOpenAIRequest, decodeJeffOpenAIResponse, JeffOpenAIFailure } from "./jeff-openai-adapter";
import { requireJeffNetworkPermit } from "./jeff-experiment-execution-gate";
import type { ModelRequest, ModelResponse } from "./agent-runtime";

export const JEFF_OPENAI_ENDPOINT = "https://api.openai.com/v1/responses" as const;
/** Fixed host/path and one consumed module permit. No SDK, retry, redirect, fallback, environment loader or callable URL. */
export async function sendJeffOpenAIHttpsOnce(permit: unknown, request: ModelRequest, signal?: AbortSignal) {
  const context = requireJeffNetworkPermit(permit);
  if (context.binding.provider !== "openai" || ![2, 3, 4].includes(context.binding.version) || !context.organization_id || !context.project_id) throw new JeffOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_RESERVED_PROVIDER_MISMATCH");
  const snapshot = structuredClone(request), wire = prepareJeffOpenAIRequest(snapshot, context.binding.maximum_output_tokens);
  if (wire.request_hash !== context.request_hash || wire.body_hash !== context.body_hash || context.binding.timeout_ms !== request.timeoutMs || Date.parse(context.binding.expires_at) <= Date.now()) throw new JeffOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_RESERVED_REQUEST_DRIFT");
  if (signal?.aborted) throw new JeffOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_ABORT_BEFORE_ATTEMPT");
  const start = performance.now(), body = JSON.stringify(wire.body);
  const read = async (path: "/v1/responses" | "/v1/responses/input_tokens", body: string, clientId: string, limit: number) => {
    const unknown = path === "/v1/responses";
    const remaining = context.binding.timeout_ms - (performance.now() - start);
    if (remaining <= 0 || signal?.aborted || Date.parse(context.binding.expires_at) <= Date.now()) throw new JeffOpenAIFailure("TIMEOUT", "OPENAI_UAT_PREFLIGHT_EXPIRED", false);
    return new Promise<{ body: string; provider_request_id_hash: string | null }>((resolve, reject) => {
    let settled = false; const deadline = { timer: null as ReturnType<typeof setTimeout> | null };
    const finish = (error: JeffOpenAIFailure | null, value?: { body: string; provider_request_id_hash: string | null }) => {
      if (settled) return; settled = true; if (deadline.timer) clearTimeout(deadline.timer); signal?.removeEventListener("abort", cancel);
      if (error) { socket.destroy(); reject(error); } else resolve(value!);
    };
    const cancel = () => finish(new JeffOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_ABORT_UNKNOWN", unknown));
    const socket = httpsRequest({ protocol: "https:", hostname: "api.openai.com", port: 443, path, method: "POST", maxHeaderSize: 8192, rejectUnauthorized: true, minVersion: "TLSv1.2",
      headers: { ...wire.headers, authorization: `Bearer ${context.credential}`, "OpenAI-Organization": context.organization_id, "OpenAI-Project": context.project_id, "x-client-request-id": clientId, "content-length": Buffer.byteLength(body) },
    }, response => {
      const status = response.statusCode ?? 0;
      if (status !== 200) {
        response.resume(); finish(new JeffOpenAIFailure(status === 429 ? "RATE_LIMIT" : status === 408 || status === 504 ? "TIMEOUT" : "PROVIDER_ERROR",
          status >= 300 && status < 400 ? "OPENAI_UAT_REDIRECT_DENIED" : status === 401 || status === 403 ? "OPENAI_UAT_AUTH_DENIED" : status === 429 ? "OPENAI_UAT_RATE_LIMIT" : "OPENAI_UAT_HTTP_FAILURE", unknown && (status >= 500 || status === 408))); return;
      }
      const echoed = response.headers["x-client-request-id"], type = response.headers["content-type"], organization = response.headers["openai-organization"], project = response.headers["openai-project"];
      // OpenAI documents organization response metadata, not an ID echo contract.
      // A display name/slug (including legacy user-* labels) is not an org ID.
      // Canonical IDs, if supplied, must still match the sealed outbound scope.
      // Credentials, account proof, fixed TLS origin and request/socket binding
      // establish authority; optional display metadata never grants it.
      const metadataInvalid = (value: unknown) => value !== undefined && (typeof value !== "string" || !/^[\x20-\x7e]{1,256}$/u.test(value));
      const mismatch = echoed !== undefined && echoed !== clientId ? "CLIENT_ID"
        : metadataInvalid(organization) || typeof organization === "string" && /^org[-_]/u.test(organization) && organization !== context.organization_id ? "ORGANIZATION"
        : metadataInvalid(project) || typeof project === "string" && /^proj_/u.test(project) && project !== context.project_id ? "PROJECT"
        : typeof type !== "string" || !/^application\/json(?:\s*;|$)/iu.test(type) ? "CONTENT_TYPE" : null;
      if (mismatch) { response.resume(); finish(new JeffOpenAIFailure("INVALID_OUTPUT", "OPENAI_UAT_RESPONSE_CORRELATION_INVALID_" + mismatch, unknown)); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => { if (settled) return; bytes += chunk.length; if (bytes > limit) { finish(new JeffOpenAIFailure("INVALID_OUTPUT", "OPENAI_UAT_RESPONSE_BOUND", unknown)); return; } chunks.push(chunk); });
      response.on("aborted", () => finish(new JeffOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_PARTIAL_RESPONSE_UNKNOWN", unknown)));
      response.on("error", () => finish(new JeffOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_CONNECTION_UNKNOWN", unknown)));
      response.on("end", () => {
        if (settled) return;
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), id = response.headers["x-request-id"];
          if (id !== undefined && (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/u.test(id))) throw Error("invalid");
          finish(null, { body: text, provider_request_id_hash: typeof id === "string" ? createHash("sha256").update(id, "utf8").digest("hex") : null });
        } catch { finish(new JeffOpenAIFailure("INVALID_OUTPUT", "OPENAI_UAT_RESPONSE_ENCODING_INVALID", unknown)); }
      });
    });
    socket.on("error", () => finish(new JeffOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_CONNECTION_UNKNOWN", unknown)));
    deadline.timer = setTimeout(() => finish(new JeffOpenAIFailure("TIMEOUT", "OPENAI_UAT_TIMEOUT_UNKNOWN", unknown)), Math.max(1, Math.floor(remaining)));
    signal?.addEventListener("abort", cancel, { once: true });
    try { socket.end(body); } catch { finish(new JeffOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_REQUEST_START_UNKNOWN", unknown)); }
  }).catch((error: unknown) => { throw error instanceof JeffOpenAIFailure ? error : new JeffOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_REQUEST_START_UNKNOWN", unknown); });
  };
  if (context.binding.version === 4) {
    // Count the exact model/input/reasoning/schema/tool representation. This is
    // not a generation or a substitute response and never enters native QA.
    const { model, input, reasoning, text, tools, tool_choice, truncation } = wire.body;
    const counted = await read("/v1/responses/input_tokens", JSON.stringify({ model, input, reasoning, text, tools, tool_choice, truncation }), context.attempt_id + "-tokens", 4096);
    let tokens: number;
    try { tokens = z.strictObject({ object: z.literal("response.input_tokens"), input_tokens: z.number().int().min(1).max(context.binding.maximum_input_tokens) }).parse(parseJeffClaudeJson(counted.body, 4096)).input_tokens; }
    catch { throw new JeffOpenAIFailure("INVALID_OUTPUT", "OPENAI_UAT_INPUT_TOKEN_BOUND", false); }
    if (!Number.isSafeInteger(tokens)) throw new JeffOpenAIFailure("INVALID_OUTPUT", "OPENAI_UAT_INPUT_TOKEN_BOUND", false);
  }
  const raw = await read("/v1/responses", body, context.attempt_id, 65536);
  const decoded = decodeJeffOpenAIResponse(raw.body, snapshot, context.binding.maximum_output_tokens), elapsed = performance.now() - start;
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new JeffOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_CLOCK_INVALID", true);
  const response: ModelResponse = { provider: "openai", model: context.binding.model, providerRequestId: decoded.providerRequestId, output: decoded.output, evidenceResolution: decoded.evidenceResolution, latencyMs: elapsed,
    usage: { inputTokens: decoded.usage?.input_tokens ?? null, outputTokens: decoded.usage?.output_tokens ?? null, totalTokens: decoded.usage?.total_tokens ?? null, billedAmount: null, billedCurrency: null } };
  return { response, provider_usage: decoded.usage, response_hash: decoded.response_hash, provider_request_id_hash: raw.provider_request_id_hash, metadata: decoded.metadata, actual_billed_amount: null, automatic_retries: 0 as const };
}
