import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it, expect } from "vitest";
import { createPolatProviderControlPlane, polatAccountControlSigningBytes, polatAccountControlEvidenceSchema } from "./polat-provider-control";
import { polatBridgeSignatureBytes } from "./polat-experiment-execution-gate";
import { preparePolatClaudeRequest } from "./polat-claude-adapter";
import { polatGuardDigest } from "./polat-experiment-journal";
import { preparePolatConversation } from "./polat-conversation";
import { polatFixture } from "./polat-conversation.fixtures";
import { polatBridgeFixtureBinding } from "../../../tests/helpers/polat-bridge-fixtures";
function fixture() {
  const now = Date.parse("2026-10-25T23:00:00Z"), pairs = { owner: generateKeyPairSync("ed25519"), account_control: generateKeyPairSync("ed25519"), committed_reservation: generateKeyPairSync("ed25519") };
  const roots = Object.fromEntries(Object.entries(pairs).map(([k, p]) => [k, { key_id: k, key: p.publicKey }])) as { [K in keyof typeof pairs]: { key_id: string; key: typeof pairs[K]["publicKey"] } };
  const request = preparePolatConversation(polatFixture("Hi", "en")).request,b = polatBridgeFixtureBinding({ timeout_ms: request.timeoutMs, expires_at: new Date(now + 600000).toISOString() }), user = { user_id: "91cc1000-0000-4000-8000-000000000001", tenant_id: request.context.tenantId, role: "super_admin", mfa: true, authenticated_at: new Date(now).toISOString() };
  const account = polatAccountControlEvidenceSchema.parse({ version: 1, origin: "INDEPENDENT_ACCOUNT_CONTROL", provider: "anthropic", model: "claude-haiku-5-5", account_scope_hash: b.account_scope_hash, manifest_hash: b.manifest_hash, authorization_record_hash: b.authorization_record_hash, repository_sha: b.repository_sha, owner_user_id: user.user_id, tenant_id: user.tenant_id, policy_hash: "e".repeat(64), credential_custody_hash: "f".repeat(64), data_region: "SYNTHETIC_REGION", retention_evidence_hash: "1".repeat(64), training_evidence_hash: "2".repeat(64), effective_limit_kind: "ENFORCED_EXPERIMENT_HARD_CAP", account_limit: "0.02", currency: "USD", observed_at: new Date(now).toISOString(), expires_at: new Date(now + 60000).toISOString() });
  const wire = preparePolatClaudeRequest(request, b.maximum_output_tokens),payload = { version: 1 as const, purpose: "POLAT_CONTROLLED_EXPERIMENT" as const, run_id: "91cc2000-0000-4000-8000-000000000001", attempt_id: "91cc3000-0000-4000-8000-000000000001", binding_hash: polatGuardDigest(b), request_hash: wire.request_hash, body_hash: wire.body_hash, account_scope_hash: b.account_scope_hash, authorization_record_hash: b.authorization_record_hash, reserved_request_count: 1, reserved_liability: "0.02", issued_at: new Date(now).toISOString(), expires_at: new Date(now + 30000).toISOString(), nonce: "91cc4000-0000-4000-8000-000000000001" };
  const input = { binding: b, request, run_id: payload.run_id, attempt_id: payload.attempt_id, signatures: { payload, ...Object.fromEntries(Object.entries(pairs).map(([role, p]) => [role, { key_id: role, signature: sign(null, polatBridgeSignatureBytes(role as keyof typeof pairs, role, payload), p.privateKey).toString("base64url") }])) }, account: { payload: account, key_id: "account_control", signature: sign(null, polatAccountControlSigningBytes("account_control", account), pairs.account_control.privateKey).toString("base64url") } };
  const service = createPolatProviderControlPlane({ authenticate: () => Promise.resolve(user), roots, deployed_sha: b.repository_sha, approved_policy_hash: account.policy_hash, approved_custody_hash: account.credential_custody_hash });
  return { now, user, input, service };
}
describe("server-owned provider control plane, synthetic cryptographic verification only", () => {
  it("requires three independent signatures plus authenticated tenant owner, and still cannot dispatch", async () => {
    const s = fixture(),r = await s.service.inspect(s.input, s.now);expect(r).toMatchObject({ state: "BLOCKED", independent_account_verified: true, reason: "GENUINE_RELEASE_AND_HOSTED_CUSTODY_NOT_AUTHORIZED", network_calls: 0, credential_accesses: 0, authorized_external_requests: 0 });
  });
  it.each(["mfa", "tenant", "role", "stale-session", "signature", "manifest", "account-cap", "request", "synthetic"])("%s fails closed", async change => {
    const s = fixture();if (change === "mfa") s.user.mfa = false;if (change === "tenant") s.user.tenant_id = "91cc1000-0000-4000-8000-000000000002";if (change === "role") s.user.role = "support";if (change === "stale-session") s.user.authenticated_at = "2026-01-01T00:00:00Z";
    if (change === "signature") s.input.account.signature = "a".repeat(86);if (change === "manifest") s.input.account.payload.manifest_hash = "0".repeat(64);if (change === "account-cap") s.input.account.payload.account_limit = "0.01";if (change === "request") s.input.request.requestId = "changed";if (change === "synthetic") s.input.account.payload.origin = "SYNTHETIC";
    const r = await s.service.inspect(s.input, s.now);expect(r).toMatchObject({ state: "BLOCKED", independent_account_verified: false, credential_accesses: 0, network_calls: 0 });expect(JSON.stringify(r)).not.toMatch(/SYNTHETIC_REGION|signature|user_id|tenant_id/u);
  });
});
