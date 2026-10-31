import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { polatBridgeBindingSchema, polatBridgeHashSchema, polatBridgeMoneySchema, POLAT_CLAUDE_MODEL, CLAUDE_MESSAGES_API_VERSION, POLAT_OPENAI_MODEL, POLAT_OPENAI_PROTOCOL, type PolatBridgeBinding } from "@gold-revenue-os/contracts";
import { polatGuardDigest } from "./polat-experiment-journal";
import { canonicalFinancialJson } from "./financial-source-canonical";
import { preparePolatClaudeRequest } from "./polat-claude-adapter";
import { polatClaudeCanaryPlan } from "./polat-claude-canary";
import { polatOpenAICanaryPlan } from "./polat-openai-canary";
import { preparePolatOpenAIRequest } from "./polat-openai-adapter";
import type { ModelRequest } from "./agent-runtime";
import { polatCampaignAccountSchema, polatCampaignBindingSchema, type PolatCampaignBinding } from "@gold-revenue-os/contracts";

const proof = z.strictObject({ key_id: z.string().regex(/^[a-zA-Z0-9:_-]{1,80}$/u), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/u) });
const payloadSchema = z.strictObject({
  version: z.literal(1), purpose: z.literal("POLAT_CONTROLLED_EXPERIMENT"), run_id: z.uuid(), attempt_id: z.uuid(),
  binding_hash: polatBridgeHashSchema, request_hash: polatBridgeHashSchema, body_hash: polatBridgeHashSchema,
  account_scope_hash: polatBridgeHashSchema, authorization_record_hash: polatBridgeHashSchema,
  reserved_request_count: z.number().int().min(1).max(290), reserved_liability: polatBridgeMoneySchema,
  issued_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }), nonce: z.uuid(),
});
const envelopeSchema = z.strictObject({ payload: payloadSchema, owner: proof, account_control: proof, committed_reservation: proof });
export type PolatBridgeSignatureEnvelope = z.infer<typeof envelopeSchema>;
type Role = "owner" | "account_control" | "committed_reservation";
export type PolatBridgePublicKeys = Readonly<Record<Role, Readonly<{ key_id: string; key: KeyObject }>>>;
export function polatBridgeSignatureBytes(role: Role, keyId: string, payload: PolatBridgeSignatureEnvelope["payload"]) {
  return Buffer.from(canonicalFinancialJson(["POLAT_EXPERIMENT_AUTH1", role, keyId, payloadSchema.parse(payload)]), "utf8");
}
/** Pure cryptographic verification; never mints a transport permit or trusts keys from experiment JSON. */
export function verifyPolatBridgeSignatures(raw: unknown, keys: PolatBridgePublicKeys, rawBinding: unknown, expected: { run_id: string; attempt_id: string; request_hash: string; body_hash: string }, now: number) {
  try {
    const e=envelopeSchema.parse(raw), b=polatBridgeBindingSchema.parse(rawBinding), p=e.payload;
    if (!Number.isFinite(now) || Date.parse(p.issued_at)>now || now-Date.parse(p.issued_at)>60000 || Date.parse(p.expires_at)<=now || Date.parse(p.expires_at)>Date.parse(p.issued_at)+60000 || Date.parse(p.expires_at)>Date.parse(b.expires_at)) return false;
    if (Object.entries(expected).some(([k,v])=>p[k as keyof typeof expected]!==v) || p.binding_hash!==polatGuardDigest(b) || p.account_scope_hash!==b.account_scope_hash || p.authorization_record_hash!==b.authorization_record_hash || p.reserved_request_count>b.maximum_requests) return false;
    const units=(s:string)=>{const [a,d=""]=s.split(".");return BigInt(a!)*10n**18n+BigInt(d.padEnd(18,"0"));};
    if (units(p.reserved_liability)>units(b.maximum_spend)||units(p.reserved_liability)!==units(b.maximum_attempt_liability)*BigInt(p.reserved_request_count)) return false;
    const fingerprints=new Set<string>();
    for (const role of ["owner","account_control","committed_reservation"] as const) {
      const root=keys[role], publicKey=createPublicKey(root.key.export({format:"pem",type:"spki"}));
      if (root.key.type!=="public" || publicKey.asymmetricKeyType!=="ed25519" || e[role].key_id!==root.key_id) return false;
      fingerprints.add(polatGuardDigest(publicKey.export({format:"pem",type:"spki"}).toString()));
      if (!verify(null,polatBridgeSignatureBytes(role,root.key_id,p),publicKey,Buffer.from(e[role].signature,"base64url"))) return false;
    }
    return fingerprints.size===3;
  } catch { return false; }
}

// The historical fixture/full-corpus experiment remains dormant. The separately scoped
// private UAT authority below never activates this legacy or fixture gate.
const RELEASE=Object.freeze({ state:"DORMANT" as const, pinned_authority_keys:null, credential_custody:null, authorized_external_requests:0 });
export function polatGenuineExecutionGate() {
  return Object.freeze({state:"BLOCKED" as const,release:RELEASE.state,owner_account_authority:"UNVERIFIED",committed_durable_authority:"NOT_PROVISIONED",authorized_external_requests:0,execution_enabled:false,real_model_execution:false,financial_authority:"NONE",live_operations_authorized:false});
}
// The HTTP boundary accepts only a module-owned capability. No JSON/hash/flag/API key is one.
export interface PolatNetworkPermit { readonly kind: "AUTHENTICATED_POLAT_NETWORK_PERMIT" }
export interface PolatVerifiedNetworkContext {
  binding: PolatBridgeBinding | PolatPrivateBetaBinding | PolatCampaignBinding; run_id:string; attempt_id:string; request_hash:string; body_hash:string; credential:string;
  workspace_id?: string; organization_id?: string; project_id?: string;
}
const permits=new WeakMap<object,PolatVerifiedNetworkContext>();
export function requirePolatNetworkPermit(permit: unknown): PolatVerifiedNetworkContext {
  const context=permit&&typeof permit==="object"?permits.get(permit):undefined;
  if (!context) throw Error("POLAT_GENUINE_EXECUTION_BLOCKED");
  permits.delete(permit as object);
  return context;
}

/** Versioned genuine-UAT extension. Historical OFFLINE_SYNTHETIC bindings and their zero authority remain unchanged. */
const claudeBetaBinding = z.strictObject({
  version: z.literal(1), mode: z.literal("PRIVATE_BETA_UAT"), program_id: z.uuid(), tenant_id: z.uuid(), conversation_style: z.literal("DIRECT"),
  provider: z.literal("anthropic"), model: z.literal(POLAT_CLAUDE_MODEL), model_version: z.literal(POLAT_CLAUDE_MODEL), protocol_version: z.literal(CLAUDE_MESSAGES_API_VERSION),
  repository_sha: z.string().regex(/^[a-f0-9]{40}$/u), manifest_hash: polatBridgeHashSchema, authorization_record_hash: polatBridgeHashSchema, account_scope_hash: polatBridgeHashSchema,
  corpus_version: z.enum(["polat-claude-canary-v1", "polat-private-beta-conversation-v1"]), corpus_hash: polatBridgeHashSchema, plan_hash: polatBridgeHashSchema,
  maximum_requests: z.number().int().min(1).max(350), maximum_spend: polatBridgeMoneySchema, maximum_attempt_liability: polatBridgeMoneySchema, currency: z.literal("USD"),
  maximum_output_tokens: z.number().int().min(1).max(512), timeout_ms: z.number().int().min(1).max(10000), expires_at: z.iso.datetime({ offset: true }),
  financial_authority: z.literal("NONE"), commercial_sales: z.literal(false),
});
const openaiBetaBinding = claudeBetaBinding.omit({ version: true, provider: true, model: true, model_version: true, protocol_version: true, corpus_version: true }).extend({
  version: z.literal(2), provider: z.literal("openai"), model: z.literal(POLAT_OPENAI_MODEL), model_version: z.literal(POLAT_OPENAI_MODEL), protocol_version: z.literal(POLAT_OPENAI_PROTOCOL),
  corpus_version: z.enum(["polat-openai-canary-v1", "polat-private-beta-conversation-v1"]),
});
export const polatPrivateBetaBindingSchema = z.discriminatedUnion("version", [claudeBetaBinding, openaiBetaBinding]);
export type PolatPrivateBetaBinding = z.infer<typeof polatPrivateBetaBindingSchema>;
export function preparePolatPrivateBetaWire(request: ModelRequest, binding: PolatPrivateBetaBinding) {
  return binding.provider === "openai" ? preparePolatOpenAIRequest(request, binding.maximum_output_tokens) : preparePolatClaudeRequest(request, binding.maximum_output_tokens);
}
const betaOwner = z.strictObject({
  version: z.literal(1), origin: z.literal("SERVER_AUTHENTICATED_OWNER_GRANT"), program_id: z.uuid(), tenant_id: z.uuid(), owner_user_id: z.uuid(),
  role: z.literal("super_admin"), aal: z.literal("aal2"), authenticated_at: z.iso.datetime({ offset: true }), approved_at: z.iso.datetime({ offset: true }),
  starts_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }), revoked: z.literal(false),
  phase: z.enum(["CANARY", "FOUNDER", "FRIENDS"]), binding_hash: polatBridgeHashSchema, policy_hash: polatBridgeHashSchema, credential_custody_hash: polatBridgeHashSchema,
});
const claudeBetaAccount = z.strictObject({
  version: z.literal(1), origin: z.literal("INDEPENDENT_ACCOUNT_CONTROL"), program_id: z.uuid(), tenant_id: z.uuid(), account_scope_hash: polatBridgeHashSchema,
  workspace_id: z.string().regex(/^wrkspc_[A-Za-z0-9]{1,120}$/u),
  repository_sha: z.string().regex(/^[a-f0-9]{40}$/u), manifest_hash: polatBridgeHashSchema, authorization_record_hash: polatBridgeHashSchema,
  provider: z.literal("anthropic"), model: z.literal(POLAT_CLAUDE_MODEL), model_access: z.literal(true), policy_hash: polatBridgeHashSchema, credential_custody_hash: polatBridgeHashSchema,
  region_evidence_hash: polatBridgeHashSchema, retention_evidence_hash: polatBridgeHashSchema, training_evidence_hash: polatBridgeHashSchema,
  effective_limit_kind: z.literal("ENFORCED_EXPERIMENT_HARD_CAP"), currency: z.literal("USD"), enforced_maximum_spend: polatBridgeMoneySchema,
  independently_observed_spend: polatBridgeMoneySchema, remaining_allowance: polatBridgeMoneySchema, billing_state: z.enum(["RECONCILED", "BOUNDED_LIABILITY_RESERVED"]), billing_evidence_hash: polatBridgeHashSchema,
  canary_reconciliation_hash: polatBridgeHashSchema.nullable(), unknown_outcome_count: z.number().int().min(0).max(350),
  request_bound: z.strictObject({ request_hash: polatBridgeHashSchema, body_hash: polatBridgeHashSchema, maximum_output_tokens: z.number().int().min(1).max(512), maximum_possible_charge: polatBridgeMoneySchema, pricing_evidence_hash: polatBridgeHashSchema, valid_until: z.iso.datetime({ offset: true }) }).nullable(),
  observed_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
});
const openaiBetaAccount = claudeBetaAccount.omit({ version: true, workspace_id: true, provider: true, model: true }).extend({
  version: z.literal(2), provider: z.literal("openai"), model: z.literal(POLAT_OPENAI_MODEL),
  organization_id: z.string().regex(/^org[-_][A-Za-z0-9_-]{1,120}$/u), project_id: z.string().regex(/^proj_[A-Za-z0-9_-]{1,120}$/u), credential_sha256: polatBridgeHashSchema,
});
export const polatPrivateBetaAccountEvidenceSchema = z.discriminatedUnion("version", [claudeBetaAccount, openaiBetaAccount]);
const betaAccountEnvelope = z.strictObject({ payload: polatPrivateBetaAccountEvidenceSchema, proof: proof.optional() });
export const polatPrivateBetaAttemptPayloadSchema = z.strictObject({
  version: z.literal(2), purpose: z.literal("POLAT_PRIVATE_BETA_UAT"), program_id: z.uuid(), tenant_id: z.uuid(), run_id: z.uuid(), native_run_id: z.uuid(), conversation_id: z.uuid(), attempt_id: z.uuid(),
  participant_id: z.uuid().nullable(), scope: z.enum(["CANARY", "FOUNDER", "FRIEND"]), source_message_id: z.uuid().nullable(),
  binding_hash: polatBridgeHashSchema, request_hash: polatBridgeHashSchema, body_hash: polatBridgeHashSchema, account_scope_hash: polatBridgeHashSchema, authorization_record_hash: polatBridgeHashSchema,
  global_ordinal: z.number().int().min(1).max(350), participant_ordinal: z.number().int().min(0).max(30), liability: polatBridgeMoneySchema, reserved_liability: polatBridgeMoneySchema,
  generation: z.string().regex(/^[1-9][0-9]{0,8}$/u), dispatch_nonce: z.uuid(), issued_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
});
const betaSignatures = z.strictObject({ payload: polatPrivateBetaAttemptPayloadSchema, owner: proof, account_control: proof, committed_reservation: proof });
const betaCommitted = z.strictObject({
  version: z.literal(1), mode: z.literal("PRIVATE_BETA_UAT"), state: z.literal("DISPATCH_STARTED"), ownership: z.literal("AI_ACTIVE"), participation: z.literal("ACTIVE"),
  program_id: z.uuid(), tenant_id: z.uuid(), run_id: z.uuid(), native_run_id: z.uuid(), conversation_id: z.uuid(), attempt_id: z.uuid(), request_hash: polatBridgeHashSchema, body_hash: polatBridgeHashSchema, binding_hash: polatBridgeHashSchema,
  generation: z.string().regex(/^[1-9][0-9]{0,8}$/u), dispatch_nonce: z.uuid(), payload: polatPrivateBetaAttemptPayloadSchema, signatures: betaSignatures.optional(),
});
export type PolatPrivateBetaAttemptPayload = z.infer<typeof polatPrivateBetaAttemptPayloadSchema>;
export type PolatPrivateBetaAccountEvidence = z.infer<typeof polatPrivateBetaAccountEvidenceSchema>;
export function polatPrivateBetaSignatureBytes(role: Role, keyId: string, payload: PolatPrivateBetaAttemptPayload) {
  return Buffer.from(canonicalFinancialJson(["POLAT_EXPERIMENT_AUTH2", role, keyId, polatPrivateBetaAttemptPayloadSchema.parse(payload)]), "utf8");
}
export function polatPrivateBetaAccountSigningBytes(keyId: string, payload: PolatPrivateBetaAccountEvidence) {
  return Buffer.from(canonicalFinancialJson(["POLAT_ACCOUNT_CONTROL_UAT1", keyId, polatPrivateBetaAccountEvidenceSchema.parse(payload)]), "utf8");
}
const betaUnits = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole!) * 10n ** 18n + BigInt(fraction.padEnd(18, "0")); };

/** Server-only extension of the existing control plane. The three independent readers must be the authenticated owner DB, official account-control adapter and committed reservation DB; never decoded HTTP fields or experiment JSON. Optional external signatures reuse the existing distinct authority roots. No fixture reader is accepted by the private-beta server wrapper. */
export function createPolatPrivateBetaNetworkAuthority(dependencies: Readonly<{
  roots?: PolatBridgePublicKeys; deployed_sha: string;
  readOwnerGrant: (programId: string) => Promise<unknown>;
  readIndependentAccount: (programId: string, requestBinding?: { request_hash: string; body_hash: string; maximum_output_tokens: number }) => Promise<unknown>;
  readCommittedAttempt: (programId: string, attemptId: string) => Promise<unknown>;
  resolveCredential: (accountScopeHash: string) => Promise<string>;
}>) {
  const sha = z.string().regex(/^[a-f0-9]{40}$/u).parse(dependencies.deployed_sha);
  const roots = dependencies.roots ? Object.fromEntries((["owner", "account_control", "committed_reservation"] as const).map(role => {
    const root = dependencies.roots![role];
    if (root.key.type !== "public" || root.key.asymmetricKeyType !== "ed25519") throw Error("POLAT_UAT_ROOTS_INVALID");
    return [role, Object.freeze({ key_id: root.key_id, key: createPublicKey(root.key.export({ format: "pem", type: "spki" })) })];
  })) as PolatBridgePublicKeys : null;
  if (roots && new Set(Object.values(roots).map(r => polatGuardDigest(r.key.export({ format: "pem", type: "spki" }).toString()))).size !== 3) throw Error("POLAT_UAT_INDEPENDENT_ROOTS_REQUIRED");
  const issued = new Set<string>();
  async function inspect(raw: unknown, now: number, requestBinding?: { request_hash: string; body_hash: string; maximum_output_tokens: number }) {
    const binding = polatPrivateBetaBindingSchema.parse(raw), bh = polatGuardDigest(binding);
    if (!Number.isFinite(now) || sha !== binding.repository_sha || Date.parse(binding.expires_at) <= now || betaUnits(binding.maximum_spend) > betaUnits("5.00") || betaUnits(binding.maximum_attempt_liability) <= 0n || betaUnits(binding.maximum_attempt_liability) > betaUnits(binding.maximum_spend)) throw Error("POLAT_UAT_RELEASE_OR_BUDGET_DENIED");
    const owner = betaOwner.parse(await dependencies.readOwnerGrant(binding.program_id));
    if (owner.program_id !== binding.program_id || owner.tenant_id !== binding.tenant_id || owner.binding_hash !== bh || Date.parse(owner.starts_at) > now || Date.parse(owner.expires_at) <= now || Date.parse(owner.expires_at) < Date.parse(binding.expires_at) || Date.parse(owner.authenticated_at) > Date.parse(owner.approved_at) || Date.parse(owner.approved_at) - Date.parse(owner.authenticated_at) > 300000 || Date.parse(owner.approved_at) > now) throw Error("POLAT_UAT_AUTHENTICATED_OWNER_REQUIRED");
    const account = betaAccountEnvelope.parse(await dependencies.readIndependentAccount(binding.program_id, requestBinding)), a = account.payload;
    const accountScope = a.provider === "openai" ? polatGuardDigest(["OPENAI_PROJECT1", a.organization_id, a.project_id]) : polatGuardDigest(["ANTHROPIC_WORKSPACE1", a.workspace_id]);
    if (a.provider !== binding.provider || a.model !== binding.model || a.program_id !== binding.program_id || a.tenant_id !== binding.tenant_id || a.account_scope_hash !== binding.account_scope_hash || accountScope !== binding.account_scope_hash || a.repository_sha !== sha || a.manifest_hash !== binding.manifest_hash || a.authorization_record_hash !== binding.authorization_record_hash || a.policy_hash !== owner.policy_hash || a.credential_custody_hash !== owner.credential_custody_hash) throw Error("POLAT_UAT_INDEPENDENT_ACCOUNT_REQUIRED");
    if (account.proof && (!roots || account.proof.key_id !== roots.account_control.key_id || !verify(null, polatPrivateBetaAccountSigningBytes(account.proof.key_id, a), roots.account_control.key, Buffer.from(account.proof.signature, "base64url")))) throw Error("POLAT_UAT_ACCOUNT_SIGNATURE_INVALID");
    if (a.unknown_outcome_count !== 0 || a.billing_state === "BOUNDED_LIABILITY_RESERVED" && (owner.phase === "CANARY" || a.canary_reconciliation_hash === null)) throw Error("POLAT_UAT_CANARY_OR_UNKNOWN_OUTCOME_UNRESOLVED");
    if (Date.parse(a.observed_at) > now || now - Date.parse(a.observed_at) > 300000 || Date.parse(a.expires_at) <= now || Date.parse(a.expires_at) > Date.parse(a.observed_at) + 300000 || betaUnits(a.enforced_maximum_spend) > betaUnits("5.00") || betaUnits(a.independently_observed_spend) > betaUnits(a.enforced_maximum_spend) || betaUnits(a.remaining_allowance) > betaUnits(a.enforced_maximum_spend) - betaUnits(a.independently_observed_spend) || betaUnits(a.remaining_allowance) < betaUnits(binding.maximum_attempt_liability)) throw Error("POLAT_UAT_ACCOUNT_STALE_OR_ALLOWANCE_UNKNOWN");
    return { binding, bindingHash: bh, owner, account: a };
  }
  return Object.freeze({
    async preflight(raw: unknown, now = Date.now()) {
      try { const s = await inspect(raw, now); return Object.freeze({ state: "READY" as const, program_id: s.binding.program_id, binding_hash: s.bindingHash, financial_authority: "NONE" as const }); }
      catch { return Object.freeze({ state: "BLOCKED" as const, reason: "OWNER_ACCOUNT_OR_RELEASE_UNVERIFIED", financial_authority: "NONE" as const }); }
    },
    async issue(input: { binding: unknown; run_id: string; attempt_id: string; request: ModelRequest }, now = Date.now()): Promise<PolatNetworkPermit> {
      const initial = polatPrivateBetaBindingSchema.parse(input.binding), r = input.request, wire = preparePolatPrivateBetaWire(r, initial);
      const s = await inspect(input.binding, now, { request_hash: wire.request_hash, body_hash: wire.body_hash, maximum_output_tokens: initial.maximum_output_tokens }), b = s.binding;
      if (r.context.tenantId !== b.tenant_id || r.timeoutMs !== b.timeout_ms) throw Error("POLAT_UAT_REQUEST_SCOPE_DENIED");
      const committed = betaCommitted.parse(await dependencies.readCommittedAttempt(b.program_id, input.attempt_id)), envelope = committed.signatures, p = committed.payload;
      const bound = s.account.request_bound;
      if (!bound || bound.request_hash !== wire.request_hash || bound.body_hash !== wire.body_hash || bound.maximum_output_tokens !== b.maximum_output_tokens || Date.parse(bound.valid_until) <= now || Date.parse(bound.valid_until) > Date.parse(s.account.expires_at) || betaUnits(bound.maximum_possible_charge) <= 0n || betaUnits(bound.maximum_possible_charge) > betaUnits(b.maximum_attempt_liability)) throw Error("POLAT_UAT_REQUEST_PRICING_BOUND_UNVERIFIED");
      if (committed.program_id !== b.program_id || committed.tenant_id !== b.tenant_id || committed.run_id !== input.run_id || committed.native_run_id !== r.requestId || committed.conversation_id !== r.context.conversationId || committed.attempt_id !== input.attempt_id || committed.binding_hash !== s.bindingHash || committed.request_hash !== wire.request_hash || committed.body_hash !== wire.body_hash || committed.generation !== p.generation || committed.dispatch_nonce !== p.dispatch_nonce) throw Error("POLAT_UAT_COMMITTED_RESERVATION_REQUIRED");
      if (p.program_id !== b.program_id || p.tenant_id !== b.tenant_id || p.run_id !== input.run_id || p.native_run_id !== r.requestId || p.conversation_id !== r.context.conversationId || p.attempt_id !== input.attempt_id || p.binding_hash !== s.bindingHash || p.request_hash !== wire.request_hash || p.body_hash !== wire.body_hash || p.account_scope_hash !== b.account_scope_hash || p.authorization_record_hash !== b.authorization_record_hash || p.global_ordinal > b.maximum_requests || betaUnits(p.liability) !== betaUnits(b.maximum_attempt_liability) || betaUnits(p.reserved_liability) < betaUnits(p.liability) || betaUnits(p.reserved_liability) > betaUnits(b.maximum_spend) || betaUnits(p.liability) > betaUnits(s.account.remaining_allowance)) throw Error("POLAT_UAT_RESERVATION_BINDING_DENIED");
      if (Date.parse(p.issued_at) > now || now - Date.parse(p.issued_at) > 60000 || Date.parse(p.expires_at) <= now || Date.parse(p.expires_at) > Date.parse(p.issued_at) + 60000 || Date.parse(p.expires_at) > Date.parse(b.expires_at)) throw Error("POLAT_UAT_RESERVATION_STALE");
      if (p.scope === "CANARY") {
        const c = b.provider === "openai" ? polatOpenAICanaryPlan() : polatClaudeCanaryPlan();
        if (s.owner.phase !== "CANARY" || b.corpus_version !== c.plan.version || b.corpus_hash !== c.corpus_hash || b.plan_hash !== c.plan_hash || b.maximum_requests !== 1 || b.maximum_output_tokens !== c.plan.proposed_maximum_output_tokens || b.timeout_ms !== c.plan.proposed_timeout_ms || p.global_ordinal !== 1 || p.participant_id !== null || p.source_message_id !== null || p.participant_ordinal !== 0 || r.context.recentMessages.length !== 1 || r.context.recentMessages[0]?.content !== "Hi" || r.styleProfile?.language !== "en") throw Error("POLAT_UAT_CANARY_SCOPE_DENIED");
      } else if (s.owner.phase !== "FOUNDER" && s.owner.phase !== "FRIENDS" || p.scope === "FRIEND" && s.owner.phase !== "FRIENDS" || b.corpus_version !== "polat-private-beta-conversation-v1" || p.participant_id === null || p.source_message_id === null || p.source_message_id !== r.context.recentMessages.at(-1)?.id || p.participant_ordinal < 1 || p.participant_ordinal > (p.scope === "FOUNDER" ? 20 : 30)) throw Error("POLAT_UAT_PARTICIPANT_SCOPE_DENIED");
      if (envelope) for (const role of ["owner", "account_control", "committed_reservation"] as const) {
        if (!roots || polatGuardDigest(envelope.payload) !== polatGuardDigest(p)) throw Error("POLAT_UAT_AUTHORITY_SIGNATURES_REQUIRED");
        const signature = envelope[role], root = roots[role];
        if (signature.key_id !== root.key_id || !verify(null, polatPrivateBetaSignatureBytes(role, root.key_id, p), root.key, Buffer.from(signature.signature, "base64url"))) throw Error("POLAT_UAT_AUTHORITY_SIGNATURES_REQUIRED");
      }
      const identity = [b.program_id, input.run_id, input.attempt_id].join(":");
      if (issued.has(identity)) throw Error("POLAT_UAT_PERMIT_ALREADY_ISSUED");
      issued.add(identity); // Never reset after credential failure, unknown result or process-local retry.
      const credential = await dependencies.resolveCredential(b.account_scope_hash);
      if (typeof credential !== "string" || credential.length < 16 || credential.length > 4096 || /[\r\n\0]/u.test(credential)) throw Error("POLAT_UAT_CREDENTIAL_CUSTODY_UNAVAILABLE");
      if (polatGuardDigest(["POLAT_UAT_CREDENTIAL_CUSTODY1", b.account_scope_hash, createHash("sha256").update(credential, "utf8").digest("hex")]) !== s.account.credential_custody_hash) throw Error("POLAT_UAT_CREDENTIAL_CUSTODY_CHANGED");
      if (s.account.provider === "openai" && createHash("sha256").update(credential, "utf8").digest("hex") !== s.account.credential_sha256) throw Error("POLAT_UAT_CREDENTIAL_CUSTODY_CHANGED");
      const permit = Object.freeze({ kind: "AUTHENTICATED_POLAT_NETWORK_PERMIT" as const });
      const accountIdentity = s.account.provider === "openai" ? { organization_id: s.account.organization_id, project_id: s.account.project_id } : { workspace_id: s.account.workspace_id };
      permits.set(permit, Object.freeze({ binding: structuredClone(b), run_id: input.run_id, attempt_id: input.attempt_id, request_hash: wire.request_hash, body_hash: wire.body_hash, credential, ...accountIdentity }));
      return permit;
    },
  });
}

const campaignOwner = z.strictObject({
  origin: z.literal("SERVER_AUTHENTICATED_CAMPAIGN_START"), tenant_id: z.uuid(), campaign_id: z.uuid(),
  owner_user_id: z.uuid(), role: z.literal("super_admin"), aal: z.literal("aal2"), state: z.literal("ACTIVE"),
  revision: z.number().int().positive(), binding_hash: polatBridgeHashSchema,
  configuration_hash: polatBridgeHashSchema, activated_at: z.iso.datetime({ offset: true }),
});
const campaignCommitted = z.strictObject({
  mode: z.literal("FOUNDER_CAMPAIGN"), tenant_id: z.uuid(), campaign_id: z.uuid(),
  run_id: z.uuid(), native_run_id: z.uuid(), attempt_id: z.uuid(), job_id: z.uuid(), conversation_id: z.uuid(),
  source_message_id: z.uuid(), revision: z.number().int().positive(), binding_hash: polatBridgeHashSchema,
  request_hash: polatBridgeHashSchema, body_hash: polatBridgeHashSchema, dispatch_nonce: z.uuid(),
  ordinal: z.number().int().positive(), reserved_liability: polatBridgeMoneySchema,
  issued_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
});

/** Campaign extension of the SAME one-use network capability and durable journal.
 * Server wrapper supplies fixed authenticated-DB/account readers; no UAT grant,
 * HTTP JSON, environment switch or deployment can substitute for campaign START. */
export function createPolatCampaignNetworkAuthority(dependencies: Readonly<{
  deployed_sha: string;
  readControl: () => Promise<unknown>;
  readCommittedAttempt: (attemptId: string) => Promise<unknown>;
  resolveCredential: () => Promise<string>;
}>) {
  const deployed = z.string().regex(/^[a-f0-9]{40}$/u).parse(dependencies.deployed_sha);
  const issued = new Set<string>();
  async function inspect(raw: unknown, now: number) {
    const binding = polatCampaignBindingSchema.parse(raw);
    const control = z.strictObject({ binding: polatCampaignBindingSchema, account: polatCampaignAccountSchema,
      owner: campaignOwner }).parse(await dependencies.readControl());
    const a = control.account, o = control.owner, h = polatGuardDigest(binding);
    if (!Number.isFinite(now) || deployed !== binding.repository_sha || Date.parse(binding.expires_at) <= now
      || polatGuardDigest(control.binding) !== h || a.binding_hash !== h || o.binding_hash !== h
      || a.tenant_id !== binding.tenant_id || o.tenant_id !== binding.tenant_id
      || a.campaign_id !== binding.campaign_id || o.campaign_id !== binding.campaign_id
      || o.configuration_hash !== binding.configuration_hash || Date.parse(o.activated_at) > now
      || polatGuardDigest(["OPENAI_PROJECT1", a.organization_id, a.project_id]) !== binding.account_scope_hash
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
    async issue(input: { binding: unknown; run_id: string; attempt_id: string; request: ModelRequest }, now = Date.now()): Promise<PolatNetworkPermit> {
      const s = await inspect(input.binding, now), b = s.binding, r = input.request;
      const p = campaignCommitted.parse(await dependencies.readCommittedAttempt(input.attempt_id));
      const wire = preparePolatOpenAIRequest(r, b.maximum_output_tokens);
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
        || polatGuardDigest(["POLAT_CAMPAIGN_CREDENTIAL1", b.account_scope_hash, s.account.credential_sha256]) !== b.credential_custody_hash) throw Error("CAMPAIGN_CREDENTIAL_CUSTODY_UNVERIFIED");
      const latest = await inspect(input.binding, Date.now());
      if (latest.owner.revision !== p.revision) throw Error("CAMPAIGN_GENERATION_CHANGED");
      const permit = Object.freeze({ kind: "AUTHENTICATED_POLAT_NETWORK_PERMIT" as const });
      permits.set(permit, Object.freeze({ binding: structuredClone(b), run_id: p.run_id, attempt_id: p.attempt_id,
        request_hash: wire.request_hash, body_hash: wire.body_hash, credential,
        organization_id: s.account.organization_id, project_id: s.account.project_id }));
      return permit;
    },
  });
}
