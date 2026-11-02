import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createPrivateBetaProviderFromDatabase } from "./private-beta-provider";
import { executePolatPrivateBetaCanary, privateBetaCanaryScopeSchema } from "../../../../../packages/domain/src/polat-private-beta-canary";


export class CanaryFreshMfaRequiredError extends Error {
  constructor() { super("CANARY_MFA_REQUIRED"); }
}
// This classification is confined to authenticated SQL calls BEFORE provider
// creation/reservation. Provider errors or text never establish a safe retry.
function checkFreshMfa(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "42501"
    && "message" in error && error.message === "PRIVATE_BETA_FRESH_AUTH_REQUIRED") throw new CanaryFreshMfaRequiredError();
}
/** One fixed synthetic-input genuine canary. Existing MFA owner grant, independent
 * account proof and committed reservation are still required by the actual provider.
 * No customer, Telegram transport, fixture response, retry or automatic phase advance. */
export async function runPrivateBetaCanaryForOwner(input: { tenantId: string; programId: string; expectedGeneration?: number }) {
  const ids = z.strictObject({ tenantId: z.uuid(), programId: z.uuid(), expectedGeneration: z.number().int().min(1).max(999999999).optional() }).parse(input);
  const auth = await createSupabaseServerClient();
  const args = { target_tenant_id: ids.tenantId, program_id_value: ids.programId };
  let guarded = await auth.rpc("admin_private_beta_canary_scope_v1", args);
  checkFreshMfa(guarded.error);
  // A DRAFT click explicitly requests this ONE canary. Reuse the authenticated
  // owner/MFA/window/account transition and its generation lock; never manufacture
  // a grant, change configuration or use the service role to advance the stage.
  if (guarded.error && ids.expectedGeneration !== undefined) {
    const read = await auth.rpc("admin_private_beta_workspace_v1", { target_tenant_id: ids.tenantId, page_size_value: 25, cursor_value: null });
    checkFreshMfa(read.error);
    const recovery = z.object({ program: z.object({ id: z.literal(ids.programId), stage: z.literal("CANARY"), generation: z.literal(String(ids.expectedGeneration)), canary_state: z.literal("RECOVERY_AVAILABLE") }) }).safeParse(read.data);
    if (!read.error && recovery.success) {
      const declared = process.env.POLAT_UAT_RELEASE_SHA, observed = process.env.VERCEL_GIT_COMMIT_SHA;
      if (!declared || !/^[a-f0-9]{40}$/u.test(declared) || observed !== undefined && observed !== declared) throw Error("PRIVATE_BETA_CANARY_RELEASE_SCOPE_DENIED");
      const resumed = await auth.rpc("admin_private_beta_recover_founder_test_v1", { ...args, expected_generation_value: ids.expectedGeneration, repository_sha_value: declared });
      checkFreshMfa(resumed.error);
      const receipt = z.strictObject({ program_id: z.literal(ids.programId), stage: z.literal("CANARY"), generation: z.literal(String(ids.expectedGeneration + 1)) }).safeParse(resumed.data);
      if (resumed.error || !receipt.success) throw Error("PRIVATE_BETA_CANARY_OWNER_OR_ACCOUNT_REQUIRED");
    } else {
    const draft = z.object({ program: z.object({ id: z.literal(ids.programId), stage: z.literal("DRAFT"), generation: z.literal(String(ids.expectedGeneration)),
      repository_sha: z.string().regex(/^[a-f0-9]{40}$/u).nullable(), global_requests: z.literal(0), canary_state: z.literal("NOT_STARTED"), account_state: z.enum(["OBSERVED", "OWNER_TEST_AVAILABLE"]), model_provider: z.string().optional(), model_name: z.string().optional() }) }).safeParse(read.data);
    if (read.error || !draft.success) throw Error("PRIVATE_BETA_CANARY_OWNER_OR_ACCOUNT_REQUIRED");
    let generation = ids.expectedGeneration;
    if (draft.data.program.account_state === "OWNER_TEST_AVAILABLE") {
      const declared = process.env.POLAT_UAT_RELEASE_SHA, observed = process.env.VERCEL_GIT_COMMIT_SHA;
      if (!declared || !/^[a-f0-9]{40}$/u.test(declared) || observed !== undefined && observed !== declared || draft.data.program.model_provider !== "openai" || draft.data.program.model_name !== "gpt-6.1-sol") throw Error("PRIVATE_BETA_CANARY_RELEASE_SCOPE_DENIED");
      // This RPC uses the real owner session and fresh MFA, then binds only
      // protected model observations to this personal test. No provider cap or
      // independently reconciled bill is asserted or supplied by the browser.
      const prepared = await auth.rpc("admin_private_beta_prepare_founder_test_v1", { ...args, expected_generation_value: generation, repository_sha_value: declared });
      checkFreshMfa(prepared.error);
      const receipt = z.strictObject({ program_id: z.literal(ids.programId), stage: z.literal("DRAFT"), generation: z.literal(String(generation + 1)) }).safeParse(prepared.data);
      if (prepared.error || !receipt.success) throw Error("PRIVATE_BETA_CANARY_OWNER_OR_ACCOUNT_REQUIRED");
      generation++;
    } else if (draft.data.program.repository_sha !== process.env.POLAT_UAT_RELEASE_SHA) throw Error("PRIVATE_BETA_CANARY_OWNER_OR_ACCOUNT_REQUIRED");
    const transitioned = await auth.rpc("admin_private_beta_transition_v1", { ...args, stage_value: "CANARY", expected_generation_value: generation });
    checkFreshMfa(transitioned.error);
    const acknowledged = z.strictObject({ program_id: z.literal(ids.programId), stage: z.literal("CANARY"), generation: z.literal(String(generation + 1)) }).safeParse(transitioned.data);
    if (transitioned.error || !acknowledged.success) throw Error("PRIVATE_BETA_CANARY_OWNER_OR_ACCOUNT_REQUIRED");
    }
    // Independently reread scope after the committed transition. A timeout or
    // lost transition ACK never triggers a second transition or inference.
    guarded = await auth.rpc("admin_private_beta_canary_scope_v1", args);
    checkFreshMfa(guarded.error);
  }
  if (guarded.error) throw Error("PRIVATE_BETA_CANARY_OWNER_OR_ACCOUNT_REQUIRED");
  const scope = privateBetaCanaryScopeSchema.parse(guarded.data);
  if (scope.tenant_id !== ids.tenantId || scope.program_id !== ids.programId || process.env.POLAT_UAT_RELEASE_SHA !== scope.repository_sha) throw Error("PRIVATE_BETA_CANARY_RELEASE_SCOPE_DENIED");
  return executePolatPrivateBetaCanary(scope, createPrivateBetaProviderFromDatabase);
}
