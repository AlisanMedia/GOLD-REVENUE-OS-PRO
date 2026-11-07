import { IDENTITY_DOMAINS_V1 } from "@gold-revenue-os/contracts";
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { jeffBridgeBindingSchema, jeffBridgeHashSchema, jeffBridgeMoneySchema, JEFF_CLAUDE_MODEL, CLAUDE_MESSAGES_API_VERSION, JEFF_OPENAI_MODEL, JEFF_OPENAI_PROTOCOL, type JeffBridgeBinding } from "@gold-revenue-os/contracts";
import { jeffGuardDigest } from "./jeff-experiment-journal";
import { canonicalFinancialJson } from "./financial-source-canonical";
import { prepareJeffClaudeRequest } from "./jeff-claude-adapter";
import { jeffClaudeCanaryPlan } from "./jeff-claude-canary";
import { jeffOpenAICanaryPlan } from "./jeff-openai-canary";
import { prepareJeffOpenAIRequest } from "./jeff-openai-adapter";
import type { ModelRequest } from "./agent-runtime";
import { jeffCampaignAccountSchema, jeffCampaignBindingSchema, type JeffCampaignBinding } from "@gold-revenue-os/contracts";

const proof = z.strictObject({ key_id: z.string().regex(/^[a-zA-Z0-9:_-]{1,80}$/u), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/u) });
const payloadSchema = z.strictObject({
  version: z.literal(1), purpose: z.literal("JEFF_CONTROLLED_EXPERIMENT"), run_id: z.uuid(), attempt_id: z.uuid(),
  binding_hash: jeffBridgeHashSchema, request_hash: jeffBridgeHashSchema, body_hash: jeffBridgeHashSchema,
  account_scope_hash: jeffBridgeHashSchema, authorization_record_hash: jeffBridgeHashSchema,
  reserved_request_count: z.number().int().min(1).max(290), reserved_liability: jeffBridgeMoneySchema,
  issued_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }), nonce: z.uuid(),
});
const envelopeSchema = z.strictObject({ payload: payloadSchema, owner: proof, account_control: proof, committed_reservation: proof });
export type JeffBridgeSignatureEnvelope = z.infer<typeof envelopeSchema>;
type Role = "owner" | "account_control" | "committed_reservation";
export type JeffBridgePublicKeys = Readonly<Record<Role, Readonly<{ key_id: string; key: KeyObject }>>>;
export function jeffBridgeSignatureBytes(role: Role, keyId: string, payload: JeffBridgeSignatureEnvelope["payload"]) {
  return Buffer.from(canonicalFinancialJson([IDENTITY_DOMAINS_V1["JEFF_EXPERIMENT_AUTH1"], role, keyId, payloadSchema.parse(payload)]), "utf8");
}
/** Pure cryptographic verification; never mints a transport permit or trusts keys from experiment JSON. */
export function verifyJeffBridgeSignatures(raw: unknown, keys: JeffBridgePublicKeys, rawBinding: unknown, expected: { run_id: string; attempt_id: string; request_hash: string; body_hash: string }, now: number) {
  try {
    const e=envelopeSchema.parse(raw), b=jeffBridgeBindingSchema.parse(rawBinding), p=e.payload;
    if (!Number.isFinite(now) || Date.parse(p.issued_at)>now || now-Date.parse(p.issued_at)>60000 || Date.parse(p.expires_at)<=now || Date.parse(p.expires_at)>Date.parse(p.issued_at)+60000 || Date.parse(p.expires_at)>Date.parse(b.expires_at)) return false;
    if (Object.entries(expected).some(([k,v])=>p[k as keyof typeof expected]!==v) || p.binding_hash!==jeffGuardDigest(b) || p.account_scope_hash!==b.account_scope_hash || p.authorization_record_hash!==b.authorization_record_hash || p.reserved_request_count>b.maximum_requests) return false;
    const units=(s:string)=>{const [a,d=""]=s.split(".");return BigInt(a!)*10n**18n+BigInt(d.padEnd(18,"0"));};
    if (units(p.reserved_liability)>units(b.maximum_spend)||units(p.reserved_liability)!==units(b.maximum_attempt_liability)*BigInt(p.reserved_request_count)) return false;
    const fingerprints=new Set<string>();
    for (const role of ["owner","account_control","committed_reservation"] as const) {
      const root=keys[role], publicKey=createPublicKey(root.key.export({format:"pem",type:"spki"}));
      if (root.key.type!=="public" || publicKey.asymmetricKeyType!=="ed25519" || e[role].key_id!==root.key_id) return false;
      fingerprints.add(jeffGuardDigest(publicKey.export({format:"pem",type:"spki"}).toString()));
      if (!verify(null,jeffBridgeSignatureBytes(role,root.key_id,p),publicKey,Buffer.from(e[role].signature,"base64url"))) return false;
    }
    return fingerprints.size===3;
  } catch { return false; }
}

// The historical fixture/full-corpus experiment remains dormant. The separately scoped
// private UAT authority below never activates this legacy or fixture gate.
const RELEASE=Object.freeze({ state:"DORMANT" as const, pinned_authority_keys:null, credential_custody:null, authorized_external_requests:0 });
export function jeffGenuineExecutionGate() {
  return Object.freeze({state:"BLOCKED" as const,release:RELEASE.state,owner_account_authority:"UNVERIFIED",committed_durable_authority:"NOT_PROVISIONED",authorized_external_requests:0,execution_enabled:false,real_model_execution:false,financial_authority:"NONE",live_operations_authorized:false});
}
// The HTTP boundary accepts only a module-owned capability. No JSON/hash/flag/API key is one.
export interface JeffNetworkPermit { readonly kind: "AUTHENTICATED_JEFF_NETWORK_PERMIT" }
export interface JeffVerifiedNetworkContext {
  binding: JeffBridgeBinding | JeffPrivateBetaBinding | JeffCampaignBinding; run_id:string; attempt_id:string; request_hash:string; body_hash:string; credential:string;
  workspace_id?: string; organization_id?: string; project_id?: string;
}
const permits=new WeakMap<object,JeffVerifiedNetworkContext>();
export function requireJeffNetworkPermit(permit: unknown): JeffVerifiedNetworkContext {
  const context=permit&&typeof permit==="object"?permits.get(permit):undefined;
  if (!context) throw Error("JEFF_GENUINE_EXECUTION_BLOCKED");
  permits.delete(permit as object);
  return context;
}

/** Versioned genuine-UAT extension. Historical OFFLINE_SYNTHETIC bindings and their zero authority remain unchanged. */
const claudeBetaBinding = z.strictObject({
  version: z.literal(1), mode: z.literal("PRIVATE_BETA_UAT"), program_id: z.uuid(), tenant_id: z.uuid(), conversation_style: z.literal("DIRECT"),
  provider: z.literal("anthropic"), model: z.literal(JEFF_CLAUDE_MODEL), model_version: z.literal(JEFF_CLAUDE_MODEL), protocol_version: z.literal(CLAUDE_MESSAGES_API_VERSION),
  repository_sha: z.string().regex(/^[a-f0-9]{40}$/u), manifest_hash: jeffBridgeHashSchema, authorization_record_hash: jeffBridgeHashSchema, account_scope_hash: jeffBridgeHashSchema,
  corpus_version: z.enum(["jeff-claude-canary-v1", "jeff-private-beta-conversation-v1"]), corpus_hash: jeffBridgeHashSchema, plan_hash: jeffBridgeHashSchema,
  maximum_requests: z.number().int().min(1).max(350), maximum_spend: jeffBridgeMoneySchema, maximum_attempt_liability: jeffBridgeMoneySchema, currency: z.literal("USD"),
  maximum_output_tokens: z.number().int().min(1).max(512), timeout_ms: z.number().int().min(1).max(10000), expires_at: z.iso.datetime({ offset: true }),
  financial_authority: z.literal("NONE"), commercial_sales: z.literal(false),
});
const openaiBetaBinding = claudeBetaBinding.omit({ version: true, provider: true, model: true, model_version: true, protocol_version: true, corpus_version: true }).extend({
  version: z.literal(2), provider: z.literal("openai"), model: z.literal(JEFF_OPENAI_MODEL), model_version: z.literal(JEFF_OPENAI_MODEL), protocol_version: z.literal(JEFF_OPENAI_PROTOCOL),
  corpus_version: z.enum(["jeff-openai-canary-v1", "jeff-private-beta-conversation-v1"]),
});
const ownerOnlyOpenaiBetaBinding = openaiBetaBinding.omit({ version: true }).extend({
  version: z.literal(3), scope: z.literal("OWNER_ONLY"), effective_limit_kind: z.literal("LOCAL_DURABLE_RESERVATION_CAP"), maximum_spend: z.literal("5.00"),
});
const ownerRecoveryBinding = ownerOnlyOpenaiBetaBinding.omit({ version: true }).extend({
  version: z.literal(4), maximum_input_tokens: z.literal(4096),
  retained_unknown_attempt_id: z.uuid(), retained_unknown_run_id: z.uuid(), recovery_authorization_hash: jeffBridgeHashSchema,
  recovery_authority: z.enum(["OWNER_FRESH_MFA", "PROTECTED_EXISTING_OWNER_GRANT"]), recovery_execution_ref: z.string().regex(/^(?:OWNER_RPC|GITHUB_RUN:[1-9][0-9]{0,20}:[a-f0-9]{40})$/u),
});
const retainedUnknownAttempt = z.strictObject({ attempt_id: z.uuid(), run_id: z.uuid(), liability: jeffBridgeMoneySchema });
const continuationFields = {
  continuation_authority: z.literal("OWNER_FRESH_MFA"), continuation_execution_ref: z.literal("OWNER_RPC"),
  continuation_authorization_hash: jeffBridgeHashSchema,
  continuation_authenticated_at: z.iso.datetime({ offset: true }), continuation_approved_at: z.iso.datetime({ offset: true }),
  continuation_source_generation: z.string().regex(/^[1-9][0-9]{0,8}$/u),
  retained_unknown_attempts: z.union([z.tuple([retainedUnknownAttempt, retainedUnknownAttempt]), z.tuple([retainedUnknownAttempt, retainedUnknownAttempt, retainedUnknownAttempt])]),
};
// One fresh owner action renews the expired second-attempt program. Historical
// v4 recovery provenance and both unknown debts remain bound, never reconciled.
const ownerContinuationBinding = ownerRecoveryBinding.omit({ version: true }).extend({ version: z.literal(5), ...continuationFields });
export const jeffPrivateBetaBindingSchema = z.discriminatedUnion("version", [claudeBetaBinding, openaiBetaBinding, ownerOnlyOpenaiBetaBinding, ownerRecoveryBinding, ownerContinuationBinding]);
export type JeffPrivateBetaBinding = z.infer<typeof jeffPrivateBetaBindingSchema>;
export function prepareJeffPrivateBetaWire(request: ModelRequest, binding: JeffPrivateBetaBinding) {
  return binding.provider === "openai" ? prepareJeffOpenAIRequest(request, binding.maximum_output_tokens) : prepareJeffClaudeRequest(request, binding.maximum_output_tokens);
}
const betaOwner = z.strictObject({
  version: z.literal(1), origin: z.literal("SERVER_AUTHENTICATED_OWNER_GRANT"), program_id: z.uuid(), tenant_id: z.uuid(), owner_user_id: z.uuid(),
  role: z.literal("super_admin"), aal: z.literal("aal2"), authenticated_at: z.iso.datetime({ offset: true }), approved_at: z.iso.datetime({ offset: true }),
  starts_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }), revoked: z.literal(false),
  phase: z.enum(["CANARY", "FOUNDER", "FRIENDS"]), binding_hash: jeffBridgeHashSchema, policy_hash: jeffBridgeHashSchema, credential_custody_hash: jeffBridgeHashSchema,
});
const claudeBetaAccount = z.strictObject({
  version: z.literal(1), origin: z.literal("INDEPENDENT_ACCOUNT_CONTROL"), program_id: z.uuid(), tenant_id: z.uuid(), account_scope_hash: jeffBridgeHashSchema,
  workspace_id: z.string().regex(/^wrkspc_[A-Za-z0-9]{1,120}$/u),
  repository_sha: z.string().regex(/^[a-f0-9]{40}$/u), manifest_hash: jeffBridgeHashSchema, authorization_record_hash: jeffBridgeHashSchema,
  provider: z.literal("anthropic"), model: z.literal(JEFF_CLAUDE_MODEL), model_access: z.literal(true), policy_hash: jeffBridgeHashSchema, credential_custody_hash: jeffBridgeHashSchema,
  region_evidence_hash: jeffBridgeHashSchema, retention_evidence_hash: jeffBridgeHashSchema, training_evidence_hash: jeffBridgeHashSchema,
  effective_limit_kind: z.literal("ENFORCED_EXPERIMENT_HARD_CAP"), currency: z.literal("USD"), enforced_maximum_spend: jeffBridgeMoneySchema,
  independently_observed_spend: jeffBridgeMoneySchema, remaining_allowance: jeffBridgeMoneySchema, billing_state: z.enum(["RECONCILED", "BOUNDED_LIABILITY_RESERVED"]), billing_evidence_hash: jeffBridgeHashSchema,
  canary_reconciliation_hash: jeffBridgeHashSchema.nullable(), unknown_outcome_count: z.number().int().min(0).max(350),
  request_bound: z.strictObject({ request_hash: jeffBridgeHashSchema, body_hash: jeffBridgeHashSchema, maximum_output_tokens: z.number().int().min(1).max(512), maximum_possible_charge: jeffBridgeMoneySchema, pricing_evidence_hash: jeffBridgeHashSchema, valid_until: z.iso.datetime({ offset: true }) }).nullable(),
  observed_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
});
const openaiBetaAccount = claudeBetaAccount.omit({ version: true, workspace_id: true, provider: true, model: true }).extend({
  version: z.literal(2), provider: z.literal("openai"), model: z.literal(JEFF_OPENAI_MODEL),
  organization_id: z.string().regex(/^org[-_][A-Za-z0-9_-]{1,120}$/u), project_id: z.string().regex(/^proj_[A-Za-z0-9_-]{1,120}$/u), credential_sha256: jeffBridgeHashSchema,
});
/** Local owner UAT policy is not independent account control or reconciled billing.
 * The server derives exposure and canary acceptance from its durable attempt journal. */
const ownerOnlyOpenaiBetaAccount = openaiBetaAccount.omit({
  version: true, origin: true, region_evidence_hash: true, retention_evidence_hash: true, training_evidence_hash: true,
  effective_limit_kind: true, enforced_maximum_spend: true, independently_observed_spend: true, remaining_allowance: true,
  billing_state: true, billing_evidence_hash: true, canary_reconciliation_hash: true,
}).extend({
  version: z.literal(3), origin: z.literal("SERVER_DERIVED_OWNER_ONLY_UAT_CONTROL"), scope: z.literal("OWNER_ONLY"),
  effective_limit_kind: z.literal("LOCAL_DURABLE_RESERVATION_CAP"), local_maximum_spend: z.literal("5.00"),
  local_reserved_liability: jeffBridgeMoneySchema, local_remaining_allowance: jeffBridgeMoneySchema,
  provider_billing: z.literal("UNKNOWN"), provider_enforced_cap: z.literal("UNVERIFIED"), canary_result_hash: jeffBridgeHashSchema.nullable(),
});
const ownerRecoveryAccount = ownerOnlyOpenaiBetaAccount.omit({ version: true, request_bound: true }).extend({
  version: z.literal(4), retained_unknown_attempt_id: z.uuid(), retained_unknown_run_id: z.uuid(),
  recovery_authorization_hash: jeffBridgeHashSchema,
  recovery_authority: z.enum(["OWNER_FRESH_MFA", "PROTECTED_EXISTING_OWNER_GRANT"]), recovery_execution_ref: z.string().regex(/^(?:OWNER_RPC|GITHUB_RUN:[1-9][0-9]{0,20}:[a-f0-9]{40})$/u), retained_unknown_liability: jeffBridgeMoneySchema,
  request_bound: claudeBetaAccount.shape.request_bound.unwrap().extend({ maximum_input_tokens: z.literal(4096) }).nullable(),
});
const ownerContinuationAccount = ownerRecoveryAccount.omit({ version: true }).extend({ version: z.literal(5), ...continuationFields });
export const jeffPrivateBetaAccountEvidenceSchema = z.discriminatedUnion("version", [claudeBetaAccount, openaiBetaAccount, ownerOnlyOpenaiBetaAccount, ownerRecoveryAccount, ownerContinuationAccount]);
const betaAccountEnvelope = z.strictObject({ payload: jeffPrivateBetaAccountEvidenceSchema, proof: proof.optional() });
export const jeffPrivateBetaAttemptPayloadSchema = z.strictObject({
  version: z.literal(2), purpose: z.literal("JEFF_PRIVATE_BETA_UAT"), program_id: z.uuid(), tenant_id: z.uuid(), run_id: z.uuid(), native_run_id: z.uuid(), conversation_id: z.uuid(), attempt_id: z.uuid(),
  participant_id: z.uuid().nullable(), scope: z.enum(["CANARY", "FOUNDER", "FRIEND"]), source_message_id: z.uuid().nullable(),
  binding_hash: jeffBridgeHashSchema, request_hash: jeffBridgeHashSchema, body_hash: jeffBridgeHashSchema, account_scope_hash: jeffBridgeHashSchema, authorization_record_hash: jeffBridgeHashSchema,
  global_ordinal: z.number().int().min(1).max(350), participant_ordinal: z.number().int().min(0).max(30), liability: jeffBridgeMoneySchema, reserved_liability: jeffBridgeMoneySchema,
  generation: z.string().regex(/^[1-9][0-9]{0,8}$/u), dispatch_nonce: z.uuid(), issued_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
});
const betaSignatures = z.strictObject({ payload: jeffPrivateBetaAttemptPayloadSchema, owner: proof, account_control: proof, committed_reservation: proof });
const betaCommitted = z.strictObject({
  version: z.literal(1), mode: z.literal("PRIVATE_BETA_UAT"), state: z.literal("DISPATCH_STARTED"), ownership: z.literal("AI_ACTIVE"), participation: z.literal("ACTIVE"),
  program_id: z.uuid(), tenant_id: z.uuid(), run_id: z.uuid(), native_run_id: z.uuid(), conversation_id: z.uuid(), attempt_id: z.uuid(), request_hash: jeffBridgeHashSchema, body_hash: jeffBridgeHashSchema, binding_hash: jeffBridgeHashSchema,
  generation: z.string().regex(/^[1-9][0-9]{0,8}$/u), dispatch_nonce: z.uuid(), payload: jeffPrivateBetaAttemptPayloadSchema, signatures: betaSignatures.optional(),
});
export type JeffPrivateBetaAttemptPayload = z.infer<typeof jeffPrivateBetaAttemptPayloadSchema>;
export type JeffPrivateBetaAccountEvidence = z.infer<typeof jeffPrivateBetaAccountEvidenceSchema>;
export function jeffPrivateBetaSignatureBytes(role: Role, keyId: string, payload: JeffPrivateBetaAttemptPayload) {
  return Buffer.from(canonicalFinancialJson(["JEFF_EXPERIMENT_AUTH2", role, keyId, jeffPrivateBetaAttemptPayloadSchema.parse(payload)]), "utf8");
}
export function jeffPrivateBetaAccountSigningBytes(keyId: string, payload: JeffPrivateBetaAccountEvidence) {
  return Buffer.from(canonicalFinancialJson([IDENTITY_DOMAINS_V1["JEFF_ACCOUNT_CONTROL_UAT1"], keyId, jeffPrivateBetaAccountEvidenceSchema.parse(payload)]), "utf8");
}
const betaUnits = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole!) * 10n ** 18n + BigInt(fraction.padEnd(18, "0")); };

/** Server-only control plane: authenticated owner DB, sealed account control and
 * committed reservation DB, never HTTP fields or pasted experiment JSON. v1/v2
 * retain independent provider-control requirements; v3 is explicitly owner-only
 * local journal policy. Optional signatures reuse the distinct authority roots. */
export function createJeffPrivateBetaNetworkAuthority(dependencies: Readonly<{
  roots?: JeffBridgePublicKeys; deployed_sha: string;
  readOwnerGrant: (programId: string) => Promise<unknown>;
  readIndependentAccount: (programId: string, requestBinding?: { request_hash: string; body_hash: string; maximum_output_tokens: number }) => Promise<unknown>;
  readCommittedAttempt: (programId: string, attemptId: string) => Promise<unknown>;
  resolveCredential: (accountScopeHash: string) => Promise<string>;
}>) {
  const sha = z.string().regex(/^[a-f0-9]{40}$/u).parse(dependencies.deployed_sha);
  const roots = dependencies.roots ? Object.fromEntries((["owner", "account_control", "committed_reservation"] as const).map(role => {
    const root = dependencies.roots![role];
    if (root.key.type !== "public" || root.key.asymmetricKeyType !== "ed25519") throw Error("JEFF_UAT_ROOTS_INVALID");
    return [role, Object.freeze({ key_id: root.key_id, key: createPublicKey(root.key.export({ format: "pem", type: "spki" })) })];
  })) as JeffBridgePublicKeys : null;
  if (roots && new Set(Object.values(roots).map(r => jeffGuardDigest(r.key.export({ format: "pem", type: "spki" }).toString()))).size !== 3) throw Error("JEFF_UAT_INDEPENDENT_ROOTS_REQUIRED");
  const issued = new Set<string>();
  async function inspect(raw: unknown, now: number, requestBinding?: { request_hash: string; body_hash: string; maximum_output_tokens: number }) {
    const binding = jeffPrivateBetaBindingSchema.parse(raw), bh = jeffGuardDigest(binding);
    if (!Number.isFinite(now) || sha !== binding.repository_sha || Date.parse(binding.expires_at) <= now || betaUnits(binding.maximum_spend) > betaUnits("5.00") || betaUnits(binding.maximum_attempt_liability) <= 0n || betaUnits(binding.maximum_attempt_liability) > betaUnits(binding.maximum_spend)) throw Error("JEFF_UAT_RELEASE_OR_BUDGET_DENIED");
    const owner = betaOwner.parse(await dependencies.readOwnerGrant(binding.program_id));
    if (owner.program_id !== binding.program_id || owner.tenant_id !== binding.tenant_id || owner.binding_hash !== bh || Date.parse(owner.starts_at) > now || Date.parse(owner.expires_at) <= now || Date.parse(owner.expires_at) < Date.parse(binding.expires_at) || Date.parse(owner.authenticated_at) > Date.parse(owner.approved_at) || Date.parse(owner.approved_at) - Date.parse(owner.authenticated_at) > 300000 || Date.parse(owner.approved_at) > now) throw Error("JEFF_UAT_AUTHENTICATED_OWNER_REQUIRED");
    const account = betaAccountEnvelope.parse(await dependencies.readIndependentAccount(binding.program_id, requestBinding)), a = account.payload;
    if (a.version !== binding.version) throw Error("JEFF_UAT_OWNER_ONLY_SCOPE_REQUIRED");
    if ((a.version === 4 || a.version === 5) && ((binding.version !== 4 && binding.version !== 5) || a.retained_unknown_attempt_id !== binding.retained_unknown_attempt_id
      || a.retained_unknown_run_id !== binding.retained_unknown_run_id || a.recovery_authorization_hash !== binding.recovery_authorization_hash || a.recovery_authority !== binding.recovery_authority || a.recovery_execution_ref !== binding.recovery_execution_ref
      || a.version === 4 && a.recovery_authority === "PROTECTED_EXISTING_OWNER_GRANT" && !a.recovery_execution_ref.endsWith(":" + binding.repository_sha)
      || a.recovery_authority === "OWNER_FRESH_MFA" && a.recovery_execution_ref !== "OWNER_RPC"
      || betaUnits(a.retained_unknown_liability) <= 0n || betaUnits(a.retained_unknown_liability) > betaUnits(a.local_reserved_liability))) throw Error("JEFF_UAT_RECOVERY_DEBT_REQUIRED");
    if (a.version === 5) {
      if (binding.version !== 5) throw Error("JEFF_UAT_CONTINUATION_REQUIRED");
      const keys = ["continuation_authority", "continuation_execution_ref", "continuation_authorization_hash", "continuation_authenticated_at", "continuation_approved_at", "continuation_source_generation"] as const;
      const [first] = a.retained_unknown_attempts;
      const debt = a.retained_unknown_attempts.reduce((sum, old) => sum + betaUnits(old.liability), 0n);
      if (keys.some(key => a[key] !== binding[key]) || jeffGuardDigest(a.retained_unknown_attempts) !== jeffGuardDigest(binding.retained_unknown_attempts)
        || first.attempt_id !== a.retained_unknown_attempt_id || first.run_id !== a.retained_unknown_run_id || first.liability !== a.retained_unknown_liability
        || new Set(a.retained_unknown_attempts.map(old => old.attempt_id)).size !== a.retained_unknown_attempts.length
        || new Set(a.retained_unknown_attempts.map(old => old.run_id)).size !== a.retained_unknown_attempts.length
        || a.retained_unknown_attempts.some(old => betaUnits(old.liability) <= 0n)
        || debt > betaUnits(a.local_reserved_liability) || Date.parse(a.continuation_authenticated_at) > Date.parse(a.continuation_approved_at)
        || Date.parse(a.continuation_approved_at) - Date.parse(a.continuation_authenticated_at) > 300000
        || Date.parse(a.continuation_approved_at) > Date.parse(owner.approved_at)
        || owner.phase === "CANARY" && (Date.parse(a.continuation_authenticated_at) !== Date.parse(owner.authenticated_at) || Date.parse(a.continuation_approved_at) !== Date.parse(owner.approved_at))
        || Date.parse(owner.starts_at) !== Date.parse(a.continuation_approved_at)
        || Date.parse(owner.expires_at) > Date.parse(a.continuation_approved_at) + 86400000) throw Error("JEFF_UAT_CONTINUATION_DEBT_OR_AUTH_REQUIRED");
    }
    const accountScope = a.provider === "openai" ? jeffGuardDigest(["OPENAI_PROJECT1", a.organization_id, a.project_id]) : jeffGuardDigest(["ANTHROPIC_WORKSPACE1", a.workspace_id]);
    if (a.provider !== binding.provider || a.model !== binding.model || a.program_id !== binding.program_id || a.tenant_id !== binding.tenant_id || a.account_scope_hash !== binding.account_scope_hash || accountScope !== binding.account_scope_hash || a.repository_sha !== sha || a.manifest_hash !== binding.manifest_hash || a.authorization_record_hash !== binding.authorization_record_hash || a.policy_hash !== owner.policy_hash || a.credential_custody_hash !== owner.credential_custody_hash) throw Error("JEFF_UAT_INDEPENDENT_ACCOUNT_REQUIRED");
    if (account.proof && (!roots || account.proof.key_id !== roots.account_control.key_id || !verify(null, jeffPrivateBetaAccountSigningBytes(account.proof.key_id, a), roots.account_control.key, Buffer.from(account.proof.signature, "base64url")))) throw Error("JEFF_UAT_ACCOUNT_SIGNATURE_INVALID");
    if (a.version === 3 || a.version === 4 || a.version === 5) {
      if (a.unknown_outcome_count !== 0 || owner.phase === "FRIENDS" || owner.phase === "FOUNDER" && a.canary_result_hash === null || owner.phase === "CANARY" && a.canary_result_hash !== null) throw Error("JEFF_UAT_OWNER_ONLY_CANARY_OR_UNKNOWN_UNRESOLVED");
      const cap = betaUnits(a.local_maximum_spend), reserved = betaUnits(a.local_reserved_liability), remaining = betaUnits(a.local_remaining_allowance);
      // During issue the DB has already reserved this attempt. Its committed
      // identity and inclusion in exposure are checked below before credential use.
      const available = remaining + (requestBinding ? betaUnits(binding.maximum_attempt_liability) : 0n);
      if (Date.parse(a.observed_at) > now || now - Date.parse(a.observed_at) > 86400000 || Date.parse(a.expires_at) <= now
        || Date.parse(a.expires_at) > Date.parse(a.observed_at) + 86400000 || Date.parse(a.expires_at) > Date.parse(owner.expires_at)
        || reserved > cap || remaining !== cap - reserved || available < betaUnits(binding.maximum_attempt_liability)) throw Error("JEFF_UAT_LOCAL_ALLOWANCE_UNAVAILABLE");
    } else {
      if (a.unknown_outcome_count !== 0 || a.billing_state === "BOUNDED_LIABILITY_RESERVED" && (owner.phase === "CANARY" || a.canary_reconciliation_hash === null)) throw Error("JEFF_UAT_CANARY_OR_UNKNOWN_OUTCOME_UNRESOLVED");
      if (Date.parse(a.observed_at) > now || now - Date.parse(a.observed_at) > 300000 || Date.parse(a.expires_at) <= now || Date.parse(a.expires_at) > Date.parse(a.observed_at) + 300000 || betaUnits(a.enforced_maximum_spend) > betaUnits("5.00") || betaUnits(a.independently_observed_spend) > betaUnits(a.enforced_maximum_spend) || betaUnits(a.remaining_allowance) > betaUnits(a.enforced_maximum_spend) - betaUnits(a.independently_observed_spend) || betaUnits(a.remaining_allowance) < betaUnits(binding.maximum_attempt_liability)) throw Error("JEFF_UAT_ACCOUNT_STALE_OR_ALLOWANCE_UNKNOWN");
    }
    return { binding, bindingHash: bh, owner, account: a };
  }
  return Object.freeze({
    async preflight(raw: unknown, now = Date.now()) {
      try { const s = await inspect(raw, now); return Object.freeze({ state: "READY" as const, program_id: s.binding.program_id, binding_hash: s.bindingHash, financial_authority: "NONE" as const }); }
      catch { return Object.freeze({ state: "BLOCKED" as const, reason: "OWNER_ACCOUNT_OR_RELEASE_UNVERIFIED", financial_authority: "NONE" as const }); }
    },
    async issue(input: { binding: unknown; run_id: string; attempt_id: string; request: ModelRequest }, now = Date.now()): Promise<JeffNetworkPermit> {
      const initial = jeffPrivateBetaBindingSchema.parse(input.binding), r = input.request, wire = prepareJeffPrivateBetaWire(r, initial);
      const s = await inspect(input.binding, now, { request_hash: wire.request_hash, body_hash: wire.body_hash, maximum_output_tokens: initial.maximum_output_tokens }), b = s.binding;
      if (r.context.tenantId !== b.tenant_id || r.timeoutMs !== b.timeout_ms) throw Error("JEFF_UAT_REQUEST_SCOPE_DENIED");
      const committed = betaCommitted.parse(await dependencies.readCommittedAttempt(b.program_id, input.attempt_id)), envelope = committed.signatures, p = committed.payload;
      const bound = s.account.request_bound;
      if (!bound || bound.request_hash !== wire.request_hash || bound.body_hash !== wire.body_hash || bound.maximum_output_tokens !== b.maximum_output_tokens || Date.parse(bound.valid_until) <= now || Date.parse(bound.valid_until) > Date.parse(s.account.expires_at) || betaUnits(bound.maximum_possible_charge) <= 0n || betaUnits(bound.maximum_possible_charge) > betaUnits(b.maximum_attempt_liability)) throw Error("JEFF_UAT_REQUEST_PRICING_BOUND_UNVERIFIED");
      if (committed.program_id !== b.program_id || committed.tenant_id !== b.tenant_id || committed.run_id !== input.run_id || committed.native_run_id !== r.requestId || committed.conversation_id !== r.context.conversationId || committed.attempt_id !== input.attempt_id || committed.binding_hash !== s.bindingHash || committed.request_hash !== wire.request_hash || committed.body_hash !== wire.body_hash || committed.generation !== p.generation || committed.dispatch_nonce !== p.dispatch_nonce) throw Error("JEFF_UAT_COMMITTED_RESERVATION_REQUIRED");
      const allowance = s.account.version === 3 || s.account.version === 4 || s.account.version === 5 ? betaUnits(s.account.local_remaining_allowance) + betaUnits(p.liability) : betaUnits(s.account.remaining_allowance);
      if (p.program_id !== b.program_id || p.tenant_id !== b.tenant_id || p.run_id !== input.run_id || p.native_run_id !== r.requestId || p.conversation_id !== r.context.conversationId || p.attempt_id !== input.attempt_id || p.binding_hash !== s.bindingHash || p.request_hash !== wire.request_hash || p.body_hash !== wire.body_hash || p.account_scope_hash !== b.account_scope_hash || p.authorization_record_hash !== b.authorization_record_hash || p.global_ordinal > b.maximum_requests || betaUnits(p.liability) !== betaUnits(b.maximum_attempt_liability) || betaUnits(p.reserved_liability) < betaUnits(p.liability) || betaUnits(p.reserved_liability) > betaUnits(b.maximum_spend) || betaUnits(p.liability) > allowance) throw Error("JEFF_UAT_RESERVATION_BINDING_DENIED");
      if ((s.account.version === 3 || s.account.version === 4 || s.account.version === 5) && (p.scope === "FRIEND" || betaUnits(p.reserved_liability) !== betaUnits(s.account.local_reserved_liability)
        || betaUnits(s.account.local_remaining_allowance) + betaUnits(p.liability) < betaUnits(bound.maximum_possible_charge))) throw Error("JEFF_UAT_OWNER_ONLY_RESERVATION_REQUIRED");
      if ((b.version === 4 || b.version === 5) && ((s.account.version !== 4 && s.account.version !== 5) || !('maximum_input_tokens' in bound) || bound.maximum_input_tokens !== b.maximum_input_tokens
        || p.attempt_id === b.retained_unknown_attempt_id || p.run_id === b.retained_unknown_run_id)) throw Error("JEFF_UAT_RECOVERY_DEBT_REQUIRED");
      if (b.version === 5 && (b.retained_unknown_attempts.some(old => old.attempt_id === p.attempt_id || old.run_id === p.run_id)
        || betaUnits(p.reserved_liability) < b.retained_unknown_attempts.reduce((sum, old) => sum + betaUnits(old.liability), 0n) + betaUnits(p.liability)
        || BigInt(p.generation) <= BigInt(b.continuation_source_generation))) throw Error("JEFF_UAT_CONTINUATION_DEBT_OR_AUTH_REQUIRED");
      if (Date.parse(p.issued_at) > now || now - Date.parse(p.issued_at) > 60000 || Date.parse(p.expires_at) <= now || Date.parse(p.expires_at) > Date.parse(p.issued_at) + 60000 || Date.parse(p.expires_at) > Date.parse(b.expires_at)) throw Error("JEFF_UAT_RESERVATION_STALE");
      if (p.scope === "CANARY") {
        const c = b.provider === "openai" ? jeffOpenAICanaryPlan() : jeffClaudeCanaryPlan();
        const ordinal = b.version === 5 ? b.retained_unknown_attempts.length + 1 : b.version === 4 ? 2 : 1;
        if (s.owner.phase !== "CANARY" || b.corpus_version !== c.plan.version || b.corpus_hash !== c.corpus_hash || b.plan_hash !== c.plan_hash || b.maximum_requests !== ordinal || b.maximum_output_tokens !== c.plan.proposed_maximum_output_tokens || b.timeout_ms !== c.plan.proposed_timeout_ms || p.global_ordinal !== ordinal || p.participant_id !== null || p.source_message_id !== null || p.participant_ordinal !== 0 || r.context.recentMessages.length !== 1 || r.context.recentMessages[0]?.content !== "Hi" || r.styleProfile?.language !== "en") throw Error("JEFF_UAT_CANARY_SCOPE_DENIED");
      } else if (s.owner.phase !== "FOUNDER" && s.owner.phase !== "FRIENDS" || p.scope === "FRIEND" && s.owner.phase !== "FRIENDS" || b.corpus_version !== "jeff-private-beta-conversation-v1" || p.participant_id === null || p.source_message_id === null || p.source_message_id !== r.context.recentMessages.at(-1)?.id || p.participant_ordinal < 1 || p.participant_ordinal > (p.scope === "FOUNDER" ? 20 : 30)) throw Error("JEFF_UAT_PARTICIPANT_SCOPE_DENIED");
      if (envelope) for (const role of ["owner", "account_control", "committed_reservation"] as const) {
        if (!roots || jeffGuardDigest(envelope.payload) !== jeffGuardDigest(p)) throw Error("JEFF_UAT_AUTHORITY_SIGNATURES_REQUIRED");
        const signature = envelope[role], root = roots[role];
        if (signature.key_id !== root.key_id || !verify(null, jeffPrivateBetaSignatureBytes(role, root.key_id, p), root.key, Buffer.from(signature.signature, "base64url"))) throw Error("JEFF_UAT_AUTHORITY_SIGNATURES_REQUIRED");
      }
      const identity = [b.program_id, input.run_id, input.attempt_id].join(":");
      if (issued.has(identity)) throw Error("JEFF_UAT_PERMIT_ALREADY_ISSUED");
      issued.add(identity); // Never reset after credential failure, unknown result or process-local retry.
      const credential = await dependencies.resolveCredential(b.account_scope_hash);
      if (typeof credential !== "string" || credential.length < 16 || credential.length > 4096 || /[\r\n\0]/u.test(credential)) throw Error("JEFF_UAT_CREDENTIAL_CUSTODY_UNAVAILABLE");
      if (jeffGuardDigest([IDENTITY_DOMAINS_V1["JEFF_UAT_CREDENTIAL_CUSTODY1"], b.account_scope_hash, createHash("sha256").update(credential, "utf8").digest("hex")]) !== s.account.credential_custody_hash) throw Error("JEFF_UAT_CREDENTIAL_CUSTODY_CHANGED");
      if (s.account.provider === "openai" && createHash("sha256").update(credential, "utf8").digest("hex") !== s.account.credential_sha256) throw Error("JEFF_UAT_CREDENTIAL_CUSTODY_CHANGED");
      const permit = Object.freeze({ kind: "AUTHENTICATED_JEFF_NETWORK_PERMIT" as const });
      const accountIdentity = s.account.provider === "openai" ? { organization_id: s.account.organization_id, project_id: s.account.project_id } : { workspace_id: s.account.workspace_id };
      permits.set(permit, Object.freeze({ binding: structuredClone(b), run_id: input.run_id, attempt_id: input.attempt_id, request_hash: wire.request_hash, body_hash: wire.body_hash, credential, ...accountIdentity }));
      return permit;
    },
  });
}

const campaignOwner = z.strictObject({
  origin: z.literal("SERVER_AUTHENTICATED_CAMPAIGN_START"), tenant_id: z.uuid(), campaign_id: z.uuid(),
  owner_user_id: z.uuid(), role: z.literal("super_admin"), aal: z.literal("aal2"), state: z.literal("ACTIVE"),
  revision: z.number().int().positive(), binding_hash: jeffBridgeHashSchema,
  configuration_hash: jeffBridgeHashSchema, activated_at: z.iso.datetime({ offset: true }),
});
const campaignCommitted = z.strictObject({
  mode: z.literal("FOUNDER_CAMPAIGN"), tenant_id: z.uuid(), campaign_id: z.uuid(),
  run_id: z.uuid(), native_run_id: z.uuid(), attempt_id: z.uuid(), job_id: z.uuid(), conversation_id: z.uuid(),
  source_message_id: z.uuid(), revision: z.number().int().positive(), binding_hash: jeffBridgeHashSchema,
  request_hash: jeffBridgeHashSchema, body_hash: jeffBridgeHashSchema, dispatch_nonce: z.uuid(),
  ordinal: z.number().int().positive(), reserved_liability: jeffBridgeMoneySchema,
  issued_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
});

/** Campaign extension of the SAME one-use network capability and durable journal.
 * Server wrapper supplies fixed authenticated-DB/account readers; no UAT grant,
 * HTTP JSON, environment switch or deployment can substitute for campaign START. */
export function createJeffCampaignNetworkAuthority(dependencies: Readonly<{
  deployed_sha: string;
  readControl: () => Promise<unknown>;
  readCommittedAttempt: (attemptId: string) => Promise<unknown>;
  resolveCredential: () => Promise<string>;
}>) {
  const deployed = z.string().regex(/^[a-f0-9]{40}$/u).parse(dependencies.deployed_sha);
  const issued = new Set<string>();
  async function inspect(raw: unknown, now: number) {
    const binding = jeffCampaignBindingSchema.parse(raw);
    const control = z.strictObject({ binding: jeffCampaignBindingSchema, account: jeffCampaignAccountSchema,
      owner: campaignOwner }).parse(await dependencies.readControl());
    const a = control.account, o = control.owner, h = jeffGuardDigest(binding);
    if (!Number.isFinite(now) || deployed !== binding.repository_sha || Date.parse(binding.expires_at) <= now
      || jeffGuardDigest(control.binding) !== h || a.binding_hash !== h || o.binding_hash !== h
      || a.tenant_id !== binding.tenant_id || o.tenant_id !== binding.tenant_id
      || a.campaign_id !== binding.campaign_id || o.campaign_id !== binding.campaign_id
      || o.configuration_hash !== binding.configuration_hash || Date.parse(o.activated_at) > now
      || jeffGuardDigest(["OPENAI_PROJECT1", a.organization_id, a.project_id]) !== binding.account_scope_hash
      || Date.parse(a.observed_at) > now || now - Date.parse(a.observed_at) > 300000
      || Date.parse(a.expires_at) <= now || Date.parse(a.expires_at) > Date.parse(a.observed_at) + 300000
      || betaUnits(binding.maximum_spend) <= 0n || betaUnits(binding.maximum_attempt_liability) <= 0n
      || betaUnits(binding.maximum_attempt_liability) > betaUnits(binding.maximum_spend)
      || betaUnits(a.enforced_maximum_spend) < betaUnits(binding.maximum_spend)
      || betaUnits(a.independently_observed_spend) > betaUnits(a.enforced_maximum_spend)
      || betaUnits(a.remaining_allowance) > betaUnits(a.enforced_maximum_spend) - betaUnits(a.independently_observed_spend)
      || betaUnits(a.remaining_allowance) < betaUnits(binding.maximum_attempt_liability)) throw Error("CAMPAIGN_OWNER_ACCOUNT_OR_RELEASE_UNVERIFIED");
    // Full documented model-context bound, not an optimistic tokenizer estimate.
    const charge = (BigInt(a.pricing.maximum_input_tokens) * betaUnits(a.pricing.maximum_input_usd_per_million)
      + BigInt(binding.maximum_output_tokens) * betaUnits(a.pricing.maximum_output_usd_per_million) + 999999n) / 1000000n;
    if (charge <= 0n || charge > betaUnits(binding.maximum_attempt_liability)) throw Error("CAMPAIGN_PRICING_LIABILITY_UNVERIFIED");
    return { binding, account: a, owner: o, hash: h };
  }
  return Object.freeze({
    async preflight(binding: unknown, now = Date.now()) {
      try { await inspect(binding, now); return { state: "READY" as const }; }
      catch { return { state: "BLOCKED" as const }; }
    },
    async issue(input: { binding: unknown; run_id: string; attempt_id: string; request: ModelRequest }, now = Date.now()): Promise<JeffNetworkPermit> {
      const s = await inspect(input.binding, now), b = s.binding, r = input.request;
      const p = campaignCommitted.parse(await dependencies.readCommittedAttempt(input.attempt_id));
      const wire = prepareJeffOpenAIRequest(r, b.maximum_output_tokens);
      if (p.tenant_id !== b.tenant_id || r.context.tenantId !== b.tenant_id || p.campaign_id !== b.campaign_id
        || p.binding_hash !== s.hash || p.run_id !== input.run_id || p.attempt_id !== input.attempt_id
        || p.native_run_id !== r.requestId || p.conversation_id !== r.context.conversationId
        || p.source_message_id !== r.context.recentMessages.at(-1)?.id || p.revision !== s.owner.revision
        || p.request_hash !== wire.request_hash || p.body_hash !== wire.body_hash || r.timeoutMs !== b.timeout_ms
        || p.ordinal > b.maximum_requests || betaUnits(p.reserved_liability) > betaUnits(b.maximum_spend)
        || betaUnits(p.reserved_liability) < betaUnits(b.maximum_attempt_liability)
        || Date.parse(p.issued_at) > now || now - Date.parse(p.issued_at) > 60000 || Date.parse(p.expires_at) <= now
        || Date.parse(p.expires_at) > Date.parse(p.issued_at) + 60000 || Date.parse(p.expires_at) > Date.parse(b.expires_at)) throw Error("CAMPAIGN_COMMITTED_ATTEMPT_REQUIRED");
      if (issued.has(p.attempt_id)) throw Error("CAMPAIGN_ATTEMPT_ALREADY_ISSUED");
      issued.add(p.attempt_id);
      const credential = await dependencies.resolveCredential();
      if (typeof credential !== "string" || credential.length < 16 || credential.length > 4096 || /[\r\n\0]/u.test(credential)
        || createHash("sha256").update(credential, "utf8").digest("hex") !== s.account.credential_sha256
        || jeffGuardDigest([IDENTITY_DOMAINS_V1["JEFF_CAMPAIGN_CREDENTIAL1"], b.account_scope_hash, s.account.credential_sha256]) !== b.credential_custody_hash) throw Error("CAMPAIGN_CREDENTIAL_CUSTODY_UNVERIFIED");
      const latest = await inspect(input.binding, Date.now());
      if (latest.owner.revision !== p.revision) throw Error("CAMPAIGN_GENERATION_CHANGED");
      const permit = Object.freeze({ kind: "AUTHENTICATED_JEFF_NETWORK_PERMIT" as const });
      permits.set(permit, Object.freeze({ binding: structuredClone(b), run_id: p.run_id, attempt_id: p.attempt_id,
        request_hash: wire.request_hash, body_hash: wire.body_hash, credential,
        organization_id: s.account.organization_id, project_id: s.account.project_id }));
      return permit;
    },
  });
}
