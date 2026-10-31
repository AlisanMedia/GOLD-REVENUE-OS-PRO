import { request as httpsRequest } from "node:https";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { preparePolatOpenAIRequest, decodePolatOpenAIResponse, PolatOpenAIFailure } from "./polat-openai-adapter";
import { requirePolatNetworkPermit } from "./polat-experiment-execution-gate";
import type { ModelRequest, ModelResponse } from "./agent-runtime";

export const POLAT_OPENAI_ENDPOINT = "https://api.openai.com/v1/responses" as const;
/** Fixed host/path and one consumed module permit. No SDK, retry, redirect, fallback, environment loader or callable URL. */
export async function sendPolatOpenAIHttpsOnce(permit: unknown, request: ModelRequest, signal?: AbortSignal) {
  const context = requirePolatNetworkPermit(permit);
  if (context.binding.provider !== "openai" || ![2, 3].includes(context.binding.version) || !context.organization_id || !context.project_id) throw new PolatOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_RESERVED_PROVIDER_MISMATCH");
  const snapshot = structuredClone(request), wire = preparePolatOpenAIRequest(snapshot, context.binding.maximum_output_tokens);
  if (wire.request_hash !== context.request_hash || wire.body_hash !== context.body_hash || context.binding.timeout_ms !== request.timeoutMs || Date.parse(context.binding.expires_at) <= Date.now()) throw new PolatOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_RESERVED_REQUEST_DRIFT");
  if (signal?.aborted) throw new PolatOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_ABORT_BEFORE_ATTEMPT");
  const start = performance.now(), body = JSON.stringify(wire.body);
  const raw = await new Promise<{ body: string; provider_request_id_hash: string | null }>((resolve, reject) => {
    let settled = false; const deadline = { timer: null as ReturnType<typeof setTimeout> | null };
    const finish = (error: PolatOpenAIFailure | null, value?: { body: string; provider_request_id_hash: string | null }) => {
      if (settled) return; settled = true; if (deadline.timer) clearTimeout(deadline.timer); signal?.removeEventListener("abort", cancel);
      if (error) { socket.destroy(); reject(error); } else resolve(value!);
    };
    const cancel = () => finish(new PolatOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_ABORT_UNKNOWN", true));
    const socket = httpsRequest({ protocol: "https:", hostname: "api.openai.com", port: 443, path: "/v1/responses", method: "POST", maxHeaderSize: 8192, rejectUnauthorized: true, minVersion: "TLSv1.2",
      headers: { ...wire.headers, authorization: `Bearer ${context.credential}`, "OpenAI-Organization": context.organization_id, "OpenAI-Project": context.project_id, "x-client-request-id": context.attempt_id, "content-length": Buffer.byteLength(body) },
    }, response => {
      const status = response.statusCode ?? 0;
      if (status !== 200) {
        response.resume(); finish(new PolatOpenAIFailure(status === 429 ? "RATE_LIMIT" : status === 408 || status === 504 ? "TIMEOUT" : "PROVIDER_ERROR",
          status >= 300 && status < 400 ? "OPENAI_UAT_REDIRECT_DENIED" : status === 401 || status === 403 ? "OPENAI_UAT_AUTH_DENIED" : status === 429 ? "OPENAI_UAT_RATE_LIMIT" : "OPENAI_UAT_HTTP_FAILURE", status >= 500 || status === 408)); return;
      }
      const echoed = response.headers["x-client-request-id"], type = response.headers["content-type"], organization = response.headers["openai-organization"], project = response.headers["openai-project"];
      // These response headers are optional metadata; their absence is not invented account proof.
      // Outbound identities come only from the independent sealed account control above.
      if (echoed !== undefined && echoed !== context.attempt_id || organization !== undefined && organization !== context.organization_id || project !== undefined && project !== context.project_id
        || typeof type !== "string" || !/^application\/json(?:\s*;|$)/iu.test(type)) { response.resume(); finish(new PolatOpenAIFailure("INVALID_OUTPUT", "OPENAI_UAT_RESPONSE_CORRELATION_INVALID", true)); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => { if (settled) return; bytes += chunk.length; if (bytes > 65536) { finish(new PolatOpenAIFailure("INVALID_OUTPUT", "OPENAI_UAT_RESPONSE_BOUND", true)); return; } chunks.push(chunk); });
      response.on("aborted", () => finish(new PolatOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_PARTIAL_RESPONSE_UNKNOWN", true)));
      response.on("error", () => finish(new PolatOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_CONNECTION_UNKNOWN", true)));
      response.on("end", () => {
        if (settled) return;
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), id = response.headers["x-request-id"];
          if (id !== undefined && (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/u.test(id))) throw Error("invalid");
          finish(null, { body: text, provider_request_id_hash: typeof id === "string" ? createHash("sha256").update(id, "utf8").digest("hex") : null });
        } catch { finish(new PolatOpenAIFailure("INVALID_OUTPUT", "OPENAI_UAT_RESPONSE_ENCODING_INVALID", true)); }
      });
    });
    socket.on("error", () => finish(new PolatOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_CONNECTION_UNKNOWN", true)));
    deadline.timer = setTimeout(() => finish(new PolatOpenAIFailure("TIMEOUT", "OPENAI_UAT_TIMEOUT_UNKNOWN", true)), context.binding.timeout_ms);
    signal?.addEventListener("abort", cancel, { once: true });
    try { socket.end(body); } catch { finish(new PolatOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_REQUEST_START_UNKNOWN", true)); }
  }).catch((error: unknown) => { throw error instanceof PolatOpenAIFailure ? error : new PolatOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_REQUEST_START_UNKNOWN", true); });
  const decoded = decodePolatOpenAIResponse(raw.body, snapshot, context.binding.maximum_output_tokens), elapsed = performance.now() - start;
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new PolatOpenAIFailure("PROVIDER_ERROR", "OPENAI_UAT_CLOCK_INVALID", true);
  const response: ModelResponse = { provider: "openai", model: context.binding.model, providerRequestId: decoded.providerRequestId, output: decoded.output, evidenceResolution: decoded.evidenceResolution, latencyMs: elapsed,
    usage: { inputTokens: decoded.usage?.input_tokens ?? null, outputTokens: decoded.usage?.output_tokens ?? null, totalTokens: decoded.usage?.total_tokens ?? null, billedAmount: null, billedCurrency: null } };
  return { response, provider_usage: decoded.usage, response_hash: decoded.response_hash, provider_request_id_hash: raw.provider_request_id_hash, metadata: decoded.metadata, actual_billed_amount: null, automatic_retries: 0 as const };
}
