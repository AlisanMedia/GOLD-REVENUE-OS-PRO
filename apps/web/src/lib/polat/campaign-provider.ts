import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { polatCampaignBindingSchema, polatCampaignReservationSchema } from "@gold-revenue-os/contracts";
import { ModelProviderError, type ModelProvider, type ModelRequest, type ModelResponse } from "@gold-revenue-os/domain";
import { createPolatCampaignNetworkAuthority } from "../../../../../packages/domain/src/polat-experiment-execution-gate";
import { preparePolatOpenAIRequest, PolatOpenAIFailure } from "../../../../../packages/domain/src/polat-openai-adapter";
import { sendPolatOpenAIHttpsOnce } from "../../../../../packages/domain/src/polat-openai-https-boundary";
import { polatGuardDigest } from "../../../../../packages/domain/src/polat-experiment-journal";
import type { PolatPrivateBetaProviderOutcome } from "../../../../../packages/domain/src/polat-private-beta-provider";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Fixed server-owned readers reuse the existing experiment ledger and HTTPS codec.
 * This factory is never selectable by a browser/model ID/environment flag alone. */
export async function createCampaignProvider(input: {
  tenantId: string; campaignId: string; jobId: string;
  assess: (request: ModelRequest, response: ModelResponse) => "APPROVED" | "HELD";
}) {
  const tenant = z.uuid().parse(input.tenantId), campaign = z.uuid().parse(input.campaignId), job = z.uuid().parse(input.jobId);
  const deployed = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!deployed || !/^[a-f0-9]{40}$/u.test(deployed)) throw Error("CAMPAIGN_DEPLOYED_SHA_REQUIRED");
  const db = createSupabaseAdminClient(), nonce = new Map<string, string>();
  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const result = await db.rpc(name, { target_tenant_id: tenant, campaign_id_value: campaign, ...args });
    if (result.error) throw Error("CAMPAIGN_PROVIDER_DB_UNAVAILABLE");
    return result.data as unknown;
  }
  const control = await rpc("campaign_execution_control_v1");
  const binding = polatCampaignBindingSchema.parse(z.object({ binding: z.unknown() }).parse(control).binding);
  if (binding.tenant_id !== tenant || binding.campaign_id !== campaign || binding.repository_sha !== deployed) throw Error("CAMPAIGN_PROVIDER_SCOPE_DENIED");
  const authority = createPolatCampaignNetworkAuthority({ deployed_sha: deployed,
    readControl: () => rpc("campaign_execution_control_v1"),
    readCommittedAttempt: async id => {
      const proof = z.object({ dispatch_nonce: z.string() }).passthrough().parse(await rpc("campaign_committed_attempt_v1", { attempt_id_value: id }));
      if (proof.dispatch_nonce !== nonce.get(id)) throw Error("CAMPAIGN_OWNED_DISPATCH_REQUIRED");
      return proof;
    },
    resolveCredential: async () => {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw Error("CAMPAIGN_PROVIDER_CREDENTIAL_UNAVAILABLE");
      return key;
    },
  });
  const provider: ModelProvider = Object.freeze({ provider: binding.provider, model: binding.model,
    async invoke(raw: ModelRequest) {
      const request = structuredClone(raw);
      if ((await authority.preflight(binding)).state !== "READY") throw new ModelProviderError("PROVIDER_ERROR", "CAMPAIGN_PROVIDER_ACCOUNT_BLOCKED", false);
      const wire = preparePolatOpenAIRequest(request, binding.maximum_output_tokens);
      const reservation = polatCampaignReservationSchema.parse(await rpc("campaign_reserve_model_v1", {
        job_id_value: job, native_run_id_value: request.requestId, request_hash_value: wire.request_hash, body_hash_value: wire.body_hash,
      }));
      if (reservation.tenant_id !== tenant || reservation.campaign_id !== campaign || reservation.job_id !== job
        || reservation.native_run_id !== request.requestId || reservation.binding_hash !== polatGuardDigest(binding)
        || reservation.request_hash !== wire.request_hash || reservation.body_hash !== wire.body_hash
        || reservation.replay || reservation.dispatch_started) throw new ModelProviderError("PROVIDER_ERROR", "CAMPAIGN_RESERVATION_REPLAY_OR_DRIFT", false);
      const dispatchNonce = randomUUID(); nonce.set(reservation.attempt_id, dispatchNonce);
      const started = z.strictObject({ dispatch: z.boolean() }).parse(await rpc("campaign_begin_model_v1", { attempt_id_value: reservation.attempt_id, dispatch_nonce_value: dispatchNonce }));
      if (!started.dispatch) throw new ModelProviderError("PROVIDER_ERROR", "CAMPAIGN_ALREADY_STARTED", false);
      const at = performance.now();
      let response: ModelResponse | null = null, outcome: PolatPrivateBetaProviderOutcome;
      try {
        const permit = await authority.issue({ binding, run_id: reservation.run_id, attempt_id: reservation.attempt_id, request });
        const result = await sendPolatOpenAIHttpsOnce(permit, request);
        response = result.response;
        const missingUsage = response.usage.inputTokens === null || response.usage.outputTokens === null;
        outcome = { version: 1, stage: "PROVIDER_RESULT", status: "SUCCEEDED", response_hash: result.response_hash,
          response_identity_hash: response.providerRequestId ? createHash("sha256").update(JSON.stringify([response.provider, response.providerRequestId])).digest("hex") : null,
          elapsed_ms: response.latencyMs.toFixed(6), input_tokens: response.usage.inputTokens, output_tokens: response.usage.outputTokens,
          qa: missingUsage ? "HELD" : input.assess(request, response), actual_billed_amount: null, actual_billed_currency: null,
          financial_authority: "NONE", error_code: missingUsage ? "CAMPAIGN_USAGE_UNAVAILABLE" : null,
          provider_usage_hash: createHash("sha256").update(JSON.stringify(result.provider_usage)).digest("hex") };
      } catch (error) {
        const unknown = error instanceof PolatOpenAIFailure && error.outcome_unknown, elapsed = performance.now() - at;
        outcome = { version: 1, stage: unknown ? "RESULT_UNKNOWN" : "PROVIDER_RESULT", status: unknown ? "UNKNOWN" : "FAILED",
          response_hash: null, response_identity_hash: null, elapsed_ms: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed.toFixed(6) : null,
          input_tokens: null, output_tokens: null, qa: "NOT_EVALUATED", actual_billed_amount: null, actual_billed_currency: null,
          financial_authority: "NONE", error_code: error instanceof ModelProviderError && /^(?:OPENAI_UAT|CAMPAIGN)_[A-Z0-9_]{1,100}$/u.test(error.code) ? error.code : "CAMPAIGN_PROVIDER_OR_AUTHORITY_UNAVAILABLE", provider_usage_hash: null };
      }
      try {
        z.strictObject({ recorded: z.literal(true) }).parse(await rpc("campaign_record_model_v1", { attempt_id_value: reservation.attempt_id,
          dispatch_nonce_value: dispatchNonce, raw_outcome_value: JSON.stringify(outcome) }));
      } catch { throw new ModelProviderError("PROVIDER_ERROR", "CAMPAIGN_EVIDENCE_COMMIT_UNKNOWN", false); }
      if (!response || outcome.status !== "SUCCEEDED" || outcome.qa !== "APPROVED") throw new ModelProviderError(outcome.status === "UNKNOWN" ? "TIMEOUT" : "PROVIDER_ERROR", outcome.error_code ?? "CAMPAIGN_QA_HELD", false);
      return response;
    },
  });
  return { provider, binding, automatic_retries: 0 as const, qa_regenerations: 0 as const };
}
