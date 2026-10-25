import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { polatBridgeBindingSchema, polatBridgeHashSchema, polatBridgeMoneySchema } from "@gold-revenue-os/contracts";
import { canonicalFinancialJson } from "./financial-source-canonical";
import { polatGuardDigest } from "./polat-experiment-journal";
import { preparePolatClaudeRequest } from "./polat-claude-adapter";
import { verifyPolatBridgeSignatures, polatGenuineExecutionGate, type PolatBridgePublicKeys } from "./polat-experiment-execution-gate";
import type { ModelRequest } from "./agent-runtime";

const hash = polatBridgeHashSchema;
const principal = z.strictObject({ user_id: z.uuid(), tenant_id: z.uuid(), role: z.literal("super_admin"), mfa: z.literal(true), authenticated_at: z.iso.datetime({ offset: true }) });
/** Evidence from the independent account-control authority; never self-reported by experiment JSON. */
export const polatAccountControlEvidenceSchema = z.strictObject({
  version: z.literal(1), origin: z.enum(["SYNTHETIC", "INDEPENDENT_ACCOUNT_CONTROL"]), provider: z.literal("anthropic"), model: z.literal("claude-haiku-5-5"),
  account_scope_hash: hash, manifest_hash: hash, authorization_record_hash: hash, repository_sha: z.string().regex(/^[a-f0-9]{40}$/u),
  owner_user_id: z.uuid(), tenant_id: z.uuid(), policy_hash: hash, data_region: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
  retention_evidence_hash: hash, training_evidence_hash: hash, credential_custody_hash: hash,
  effective_limit_kind: z.literal("ENFORCED_EXPERIMENT_HARD_CAP"), account_limit: polatBridgeMoneySchema, currency: z.string().regex(/^[A-Z]{3}$/u),
  observed_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
});
type AccountEvidence = z.infer<typeof polatAccountControlEvidenceSchema>;
const signedAccount = z.strictObject({ payload: polatAccountControlEvidenceSchema, key_id: z.string().regex(/^[A-Za-z0-9:_-]{1,80}$/u), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/u) });
export function polatAccountControlSigningBytes(keyId: string, evidence: AccountEvidence) {
  return Buffer.from(canonicalFinancialJson(["POLAT_ACCOUNT_CONTROL1", keyId, polatAccountControlEvidenceSchema.parse(evidence)]), "utf8");
}
const units = (v: string) => { const [a, d = ""] = v.split("."); return BigInt(a!) * 10n ** 18n + BigInt(d.padEnd(18, "0")); };

/** Reuses the existing three-authority verifier and binding. No alternative grant, credential loader or network sender. */
export function createPolatProviderControlPlane(dependencies: Readonly<{
  // Trusted server adapters only. Neither principal nor roots are taken from an HTTP body/CLI/environment flag.
  authenticate: () => Promise<unknown>;
  roots: PolatBridgePublicKeys;
  deployed_sha: string;
  approved_policy_hash: string;
  approved_custody_hash: string;
}>) {
  const authenticate = dependencies.authenticate;
  const snapshot = (role: keyof PolatBridgePublicKeys) => Object.freeze({ key_id: dependencies.roots[role].key_id, key: createPublicKey(dependencies.roots[role].key.export({ type: "spki", format: "pem" })) });
  const roots = Object.freeze({ owner: snapshot("owner"), account_control: snapshot("account_control"), committed_reservation: snapshot("committed_reservation") }), deployment = z.string().regex(/^[a-f0-9]{40}$/u).parse(dependencies.deployed_sha), policy = hash.parse(dependencies.approved_policy_hash), custody = hash.parse(dependencies.approved_custody_hash);
  return Object.freeze({
    async inspect(input: { binding: unknown; signatures: unknown; account: unknown; run_id: string; attempt_id: string; request: ModelRequest }, now = Date.now()) {
      const blocked = (reason: string) => Object.freeze({ state: "BLOCKED" as const, reason, independent_account_verified: false, authorized_external_requests: 0, credential_accesses: 0, network_calls: 0, financial_authority: "NONE", live_operations_authorized: false });
      try {
        const user = principal.parse(await authenticate()), b = polatBridgeBindingSchema.parse(input.binding), a = signedAccount.parse(input.account), p = a.payload;
        if (!Number.isFinite(now) || Date.parse(user.authenticated_at) > now || now - Date.parse(user.authenticated_at) > 300000) return blocked("AUTHENTICATED_OWNER_REQUIRED");
        if (p.origin !== "INDEPENDENT_ACCOUNT_CONTROL") return blocked("INDEPENDENT_ACCOUNT_EVIDENCE_REQUIRED");
        if (p.tenant_id !== user.tenant_id || p.owner_user_id !== user.user_id || input.request.context.tenantId !== user.tenant_id) return blocked("OWNER_TENANT_SCOPE_DENIED");
        if (deployment !== b.repository_sha || deployment !== p.repository_sha || p.manifest_hash !== b.manifest_hash || p.authorization_record_hash !== b.authorization_record_hash || p.account_scope_hash !== b.account_scope_hash || p.policy_hash !== policy || p.credential_custody_hash !== custody || p.currency !== b.currency) return blocked("CONTROL_BINDING_DRIFT");
        if (Date.parse(p.observed_at) > now || now - Date.parse(p.observed_at) > 300000 || Date.parse(p.expires_at) <= now || Date.parse(p.expires_at) > Date.parse(p.observed_at) + 300000 || units(p.account_limit) < units(b.maximum_spend)) return blocked("ACCOUNT_CONTROL_STALE_OR_INSUFFICIENT");
        if (a.key_id !== roots.account_control.key_id || !verify(null, polatAccountControlSigningBytes(a.key_id, p), roots.account_control.key, Buffer.from(a.signature, "base64url"))) return blocked("ACCOUNT_SIGNATURE_INVALID");
        const wire = preparePolatClaudeRequest(input.request, b.maximum_output_tokens);
        if (input.request.timeoutMs !== b.timeout_ms || !verifyPolatBridgeSignatures(input.signatures, roots, b, { run_id: input.run_id, attempt_id: input.attempt_id, request_hash: wire.request_hash, body_hash: wire.body_hash }, now)) return blocked("OWNER_ACCOUNT_RESERVATION_SIGNATURES_REQUIRED");
        // Current persistence and release are fixture-only. Verified signatures alone never activate networking.
        return Object.freeze({ ...blocked("GENUINE_RELEASE_AND_HOSTED_CUSTODY_NOT_AUTHORIZED"), independent_account_verified: true, binding_hash: polatGuardDigest(b), release: polatGenuineExecutionGate().release });
      } catch { return blocked("CONTROL_EVIDENCE_INVALID"); }
    },
  });
}
