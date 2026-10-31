import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { polatCampaignBindingSchema } from "../../packages/contracts/src/polat-campaign-execution";
import { createPolatCampaignNetworkAuthority, requirePolatNetworkPermit } from "../../packages/domain/src/polat-experiment-execution-gate";
import { preparePolatCampaignRuntime } from "../../packages/domain/src/polat-campaign-runtime";
import { preparePolatConversation } from "../../packages/domain/src/polat-conversation";
import { polatFixture } from "../../packages/domain/src/polat-conversation.fixtures";
import { polatGuardDigest } from "../../packages/domain/src/polat-experiment-journal";
import { preparePolatOpenAIRequest } from "../../packages/domain/src/polat-openai-adapter";

function fixture() {
  const context = preparePolatConversation(polatFixture("Hi", "en")).request.context;
  const scope = { tenant_id: context.tenantId, campaign_id: randomUUID(), job_id: randomUUID(), conversation_id: context.conversationId,
    source_message_id: context.recentMessages.at(-1)!.id, revision: 3, boundary: new Date().toISOString(), plan_version_id: randomUUID(), follow_up: false };
  const request = preparePolatCampaignRuntime(context, randomUUID(), scope).request;
  const sha = "a".repeat(40), key = "SYNTHETIC_CAMPAIGN_KEY_NOT_REAL", now = Date.now(), until = new Date(now + 300000).toISOString();
  const organization = "org-campaign-fixture", project = "proj_campaign_fixture", accountHash = polatGuardDigest(["OPENAI_PROJECT1", organization, project]);
  const credentialHash = createHash("sha256").update(key).digest("hex");
  const binding = polatCampaignBindingSchema.parse({ version: 3, mode: "FOUNDER_CAMPAIGN", tenant_id: context.tenantId, campaign_id: scope.campaign_id,
    provider: "openai", model: "gpt-6.1-sol", model_version: "gpt-6.1-sol", protocol_version: "responses-v1", repository_sha: sha,
    configuration_hash: "b".repeat(64), account_scope_hash: accountHash, authorization_record_hash: "c".repeat(64), manifest_hash: "d".repeat(64), policy_hash: "e".repeat(64),
    credential_custody_hash: polatGuardDigest(["POLAT_CAMPAIGN_CREDENTIAL1", accountHash, credentialHash]), maximum_requests: 4, maximum_spend: "5", maximum_attempt_liability: "1.1",
    currency: "USD", maximum_output_tokens: 512, timeout_ms: 10000, expires_at: until, financial_authority: "NONE" });
  const account = { version: 1, origin: "INDEPENDENT_CAMPAIGN_ACCOUNT_CONTROL", tenant_id: context.tenantId, campaign_id: scope.campaign_id, binding_hash: polatGuardDigest(binding), organization_id: organization, project_id: project, credential_sha256: credentialHash,
    model_access: true, effective_limit_kind: "ENFORCED_CAMPAIGN_HARD_CAP", enforced_maximum_spend: "5", independently_observed_spend: "0", remaining_allowance: "5", currency: "USD", unknown_outcome_count: 0,
    data_policy_evidence_hash: "f".repeat(64), billing_evidence_hash: "1".repeat(64), canary_reconciliation_hash: "2".repeat(64), pricing: { maximum_input_tokens: 1050000, maximum_input_usd_per_million: "1", maximum_output_usd_per_million: "1", all_billable_components_covered: true, source_hash: "3".repeat(64) },
    observed_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 299000).toISOString() };
  const owner = { origin: "SERVER_AUTHENTICATED_CAMPAIGN_START", tenant_id: context.tenantId, campaign_id: scope.campaign_id, owner_user_id: randomUUID(), role: "super_admin", aal: "aal2", state: "ACTIVE", revision: 3,
    binding_hash: polatGuardDigest(binding), configuration_hash: binding.configuration_hash, activated_at: new Date(now - 1000).toISOString() };
  const wire = preparePolatOpenAIRequest(request, 512), runId = randomUUID(), attemptId = randomUUID();
  const committed = { mode: "FOUNDER_CAMPAIGN", tenant_id: context.tenantId, campaign_id: scope.campaign_id, run_id: runId, native_run_id: request.requestId, attempt_id: attemptId,
    job_id: scope.job_id, conversation_id: context.conversationId, source_message_id: scope.source_message_id, revision: 3, binding_hash: polatGuardDigest(binding), request_hash: wire.request_hash, body_hash: wire.body_hash, dispatch_nonce: randomUUID(), ordinal: 1,
    reserved_liability: "1.1", issued_at: new Date(now - 100).toISOString(), expires_at: new Date(now + 9900).toISOString() };
  let credentials = 0;
  const control = { binding, account, owner };
  const authority = createPolatCampaignNetworkAuthority({ deployed_sha: sha, readControl: async () => control,
    readCommittedAttempt: async () => committed, resolveCredential: async () => { credentials++; return key; } });
  return { binding, control, account, owner, committed, authority, request, runId, attemptId, credentials: () => credentials };
}
describe("same one-use network gate, independently bound founder campaign", () => {
  it("creates one capability only after independent control + committed attempt, never from JSON", async () => {
    const f = fixture();
    expect((await f.authority.preflight(f.binding)).state).toBe("READY"); expect(f.credentials()).toBe(0);
    const permit = await f.authority.issue({ binding: f.binding, run_id: f.runId, attempt_id: f.attemptId, request: f.request });
    expect(() => requirePolatNetworkPermit(JSON.parse(JSON.stringify(permit)))).toThrow("POLAT_GENUINE_EXECUTION_BLOCKED");
    expect(requirePolatNetworkPermit(permit).attempt_id).toBe(f.attemptId);
    expect(() => requirePolatNetworkPermit(permit)).toThrow();
    await expect(f.authority.issue({ binding: f.binding, run_id: f.runId, attempt_id: f.attemptId, request: f.request })).rejects.toThrow("ALREADY_ISSUED");
    expect(f.credentials()).toBe(1);
  });
  it.each(["UAT_AUTHORITY", "MODEL", "ACCOUNT", "ALLOWANCE", "SOFT_CAP", "STALE", "POLICY", "CANARY", "UNKNOWN", "LIABILITY"])("%s fails before credential resolution", async kind => {
    const f = fixture();
    if (kind === "UAT_AUTHORITY") f.control.owner.origin = "SERVER_AUTHENTICATED_OWNER_GRANT";
    if (kind === "MODEL") f.binding.model = "other" as typeof f.binding.model;
    if (kind === "ACCOUNT") f.account.project_id = "proj_wrong_account";
    if (kind === "ALLOWANCE") f.account.remaining_allowance = "0";
    if (kind === "SOFT_CAP") f.account.effective_limit_kind = "PROJECT_BUDGET_ALERT";
    if (kind === "STALE") f.account.expires_at = new Date(Date.now() - 1000).toISOString();
    if (kind === "POLICY") f.account.data_policy_evidence_hash = "UNKNOWN";
    if (kind === "CANARY") f.account.canary_reconciliation_hash = "UNKNOWN";
    if (kind === "UNKNOWN") f.account.unknown_outcome_count = 1;
    if (kind === "LIABILITY") f.account.pricing.maximum_input_usd_per_million = "100";
    expect((await f.authority.preflight(f.binding)).state).toBe("BLOCKED"); expect(f.credentials()).toBe(0);
  });
  it.each(["GENERATION", "REQUEST", "COUNT", "BUDGET", "TENANT", "SOURCE", "DEADLINE"])("committed %s drift cannot issue another call", async kind => {
    const f = fixture();
    if (kind === "GENERATION") f.committed.revision++;
    if (kind === "REQUEST") f.committed.body_hash = "f".repeat(64);
    if (kind === "COUNT") f.committed.ordinal = 5;
    if (kind === "BUDGET") f.committed.reserved_liability = "6";
    if (kind === "TENANT") f.committed.tenant_id = randomUUID();
    if (kind === "SOURCE") f.committed.source_message_id = randomUUID();
    if (kind === "DEADLINE") f.committed.expires_at = new Date(Date.now() - 1).toISOString();
    await expect(f.authority.issue({ binding: f.binding, run_id: f.runId, attempt_id: f.attemptId, request: f.request })).rejects.toThrow();
    expect(f.credentials()).toBe(0);
  });
});
