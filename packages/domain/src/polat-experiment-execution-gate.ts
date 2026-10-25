import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { polatBridgeBindingSchema, polatBridgeHashSchema, polatBridgeMoneySchema, type PolatBridgeBinding } from "@gold-revenue-os/contracts";
import { polatGuardDigest } from "./polat-experiment-journal";
import { canonicalFinancialJson } from "./financial-source-canonical";

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

// No keys, environment loader, grant issuer or owner/account configuration exists in this release.
// A separately reviewed release must supply authenticated control-plane roots and committed DB custody.
const RELEASE=Object.freeze({ state:"DORMANT" as const, pinned_authority_keys:null, credential_custody:null, authorized_external_requests:0 });
export function polatGenuineExecutionGate() {
  return Object.freeze({state:"BLOCKED" as const,release:RELEASE.state,owner_account_authority:"UNVERIFIED",committed_durable_authority:"NOT_PROVISIONED",authorized_external_requests:0,execution_enabled:false,real_model_execution:false,financial_authority:"NONE",live_operations_authorized:false});
}
// The HTTP boundary accepts only a module-owned capability. No JSON/hash/flag/API key is one.
export interface PolatNetworkPermit { readonly kind: "AUTHENTICATED_POLAT_NETWORK_PERMIT" }
export interface PolatVerifiedNetworkContext {
  binding: PolatBridgeBinding; run_id:string; attempt_id:string; request_hash:string; body_hash:string; credential:string;
}
const permits=new WeakMap<object,PolatVerifiedNetworkContext>();
export function requirePolatNetworkPermit(permit: unknown): PolatVerifiedNetworkContext {
  const context=permit&&typeof permit==="object"?permits.get(permit):undefined;
  if (RELEASE.state==="DORMANT" || !context) throw Error("POLAT_GENUINE_EXECUTION_BLOCKED");
  permits.delete(permit as object);
  return context;
}
