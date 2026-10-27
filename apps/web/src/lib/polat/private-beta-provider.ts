import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createPolatPrivateBetaProvider, boundPolatPrivateBetaWireLiability, type PolatPrivateBetaAttemptStore } from "../../../../../packages/domain/src/polat-private-beta-provider";
import { createPolatPrivateBetaNetworkAuthority, polatPrivateBetaBindingSchema, polatPrivateBetaAccountEvidenceSchema } from "../../../../../packages/domain/src/polat-experiment-execution-gate";

// Keep the genuine provider/control boundary out of browser imports. No environment loader or automatic selection.
export {
  createPolatPrivateBetaProvider,
  readPolatAnthropicUatAccount,
  boundPolatPrivateBetaLiability,
  readPolatPrivateBetaOfficialPricing,
  polatPrivateBetaReservationSchema,
  type PolatPrivateBetaAttemptStore,
  type PolatPrivateBetaProviderOutcome,
  type PolatPrivateBetaReservation,
} from "../../../../../packages/domain/src/polat-private-beta-provider";
export {
  createPolatPrivateBetaNetworkAuthority,
  polatPrivateBetaBindingSchema,
  type PolatPrivateBetaBinding,
} from "../../../../../packages/domain/src/polat-experiment-execution-gate";

/** Existing server-owned native worker supplies the verified tenant/program scope; an HTTP body cannot create this provider. */
export async function createPrivateBetaProviderFromDatabase(input: {
  tenantId: string;
  programId: string;
  scope: "CANARY" | "CONVERSATION";
  assess: Parameters<typeof createPolatPrivateBetaProvider>[0]["assess"];
}) {
  const scope = z.strictObject({ tenantId: z.uuid(), programId: z.uuid(), scope: z.enum(["CANARY", "CONVERSATION"]) }).parse({ tenantId: input.tenantId, programId: input.programId, scope: input.scope });
  const declared = process.env.POLAT_UAT_RELEASE_SHA, observed = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!declared || !/^[a-f0-9]{40}$/u.test(declared) || observed !== undefined && observed !== declared) throw Error("PRIVATE_BETA_RELEASE_NOT_CONFIGURED");
  const db = createSupabaseAdminClient(), nonce = new Map<string, string>();
  const common = { target_tenant_id: scope.tenantId, program_id_value: scope.programId };
  const rpc = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const result = z.object({ data: z.unknown(), error: z.unknown() }).parse(await db.rpc(name, { ...common, ...args }));
    if (result.error) throw Error("PRIVATE_BETA_SERVER_RPC_UNAVAILABLE");
    return result.data;
  };
  const binding = polatPrivateBetaBindingSchema.parse(await rpc("private_beta_binding_v1", { scope_value: scope.scope }));
  if (binding.program_id !== scope.programId || binding.tenant_id !== scope.tenantId || binding.repository_sha !== declared) throw Error("PRIVATE_BETA_BINDING_SCOPE_DENIED");
  const authority = createPolatPrivateBetaNetworkAuthority({
    deployed_sha: declared,
    readOwnerGrant: async programId => { if (programId !== scope.programId) throw Error("PRIVATE_BETA_SCOPE_DENIED"); return rpc("private_beta_owner_grant_v1", {}); },
    readIndependentAccount: async (programId, requestBinding) => {
      if (programId !== scope.programId) throw Error("PRIVATE_BETA_SCOPE_DENIED");
      // This row can only be written by the protected postgres account-control job. The application has no writer grant.
      const sealed = z.strictObject({ payload: polatPrivateBetaAccountEvidenceSchema, pricing: z.unknown() }).parse(await rpc("private_beta_account_control_v1", {}));
      const payload = sealed.payload;
      if (requestBinding) {
        const bounded = boundPolatPrivateBetaWireLiability(requestBinding, sealed.pricing);
        payload.request_bound = { ...bounded, valid_until: new Date(Math.min(Date.parse(bounded.valid_until), Date.parse(payload.expires_at))).toISOString() };
      } else payload.request_bound = null;
      return { payload };
    },
    readCommittedAttempt: async (programId, attemptId) => {
      if (programId !== scope.programId) throw Error("PRIVATE_BETA_SCOPE_DENIED");
      const proof = await rpc("private_beta_committed_attempt_v1", { attempt_id_value: attemptId });
      if (!proof || typeof proof !== "object" || !("dispatch_nonce" in proof) || proof.dispatch_nonce !== nonce.get(attemptId)) throw Error("PRIVATE_BETA_OWNED_DISPATCH_REQUIRED");
      return proof;
    },
    resolveCredential: async accountScopeHash => {
      if (accountScopeHash !== binding.account_scope_hash) return Promise.reject(Error("PRIVATE_BETA_SCOPE_DENIED"));
      // Only reached after independent owner/account/committed-reservation checks. Never loaded during module import or setup views.
      const key = binding.provider === "openai" ? process.env.OPENAI_API_KEY : process.env.POLAT_UAT_ANTHROPIC_API_KEY;
      if (binding.provider === "openai") {
        const sealed = z.strictObject({ payload: polatPrivateBetaAccountEvidenceSchema, pricing: z.unknown() }).parse(await rpc("private_beta_account_control_v1", {}));
        if (sealed.payload.provider !== "openai" || sealed.payload.account_scope_hash !== accountScopeHash || !key
          || createHash("sha256").update(key, "utf8").digest("hex") !== sealed.payload.credential_sha256) throw Error("PRIVATE_BETA_OPENAI_CREDENTIAL_UNVERIFIED");
      }
      return key ? Promise.resolve(key) : Promise.reject(Error("PRIVATE_BETA_PROVIDER_CREDENTIAL_UNAVAILABLE"));
    },
  });
  const store: PolatPrivateBetaAttemptStore = {
    reserve: value => {
      if (value.program_id !== scope.programId) return Promise.reject(Error("PRIVATE_BETA_SCOPE_DENIED"));
      return rpc("private_beta_reserve_v1", { native_run_id_value: value.native_run_id, conversation_id_value: value.conversation_id, request_hash_value: value.request_hash, body_hash_value: value.body_hash, source_message_id_value: value.source_message_id, liability_value: binding.maximum_attempt_liability });
    },
    begin: async reservation => {
      const key = randomUUID(); nonce.set(reservation.attempt_id, key);
      const started = z.object({ dispatch: z.boolean() }).parse(await rpc("private_beta_begin_v1", { attempt_id_value: reservation.attempt_id, dispatch_nonce_value: key }));
      return { dispatch: started.dispatch };
    },
    record: async (reservation, outcome) => {
      const key = nonce.get(reservation.attempt_id); if (!key) throw Error("PRIVATE_BETA_OWNED_DISPATCH_REQUIRED");
      const result = z.object({ recorded: z.literal(true) }).parse(await rpc("private_beta_record_v1", { attempt_id_value: reservation.attempt_id, dispatch_nonce_value: key, raw_outcome_value: JSON.stringify(outcome) }));
      if (!result.recorded) throw Error("PRIVATE_BETA_EVIDENCE_UNAVAILABLE");
    },
  };
  return createPolatPrivateBetaProvider({ binding, authority, store, assess: input.assess });
}
