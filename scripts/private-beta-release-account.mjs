import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readPolatAnthropicUatAccount } from '../packages/domain/src/polat-private-beta-provider.ts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const assert = (condition, code) => { if (!condition) throw Error(code); };
/** The trusted protected job reads this from existing PostgreSQL, never a pasted approval document. */
export function parsePrivateBetaAccountProgram(value, programId, sha) {
  assert(uuid.test(programId) && /^[a-f0-9]{40}$/u.test(sha) && Array.isArray(value) && value.length === 1, 'OWNED_PROGRAM_REQUIRED');
  const program = value[0]?.private_beta_program;
  assert(program?.program_id === programId && uuid.test(program.tenant_id) && program.repository_sha === sha && ['DRAFT', 'CANARY', 'FOUNDER', 'FRIENDS'].includes(program.stage), 'OWNED_PROGRAM_REQUIRED');
  assert(typeof program.starts_at === 'string' && Number.isFinite(Date.parse(program.starts_at)) && typeof program.expires_at === 'string' && Number.isFinite(Date.parse(program.expires_at)), 'PROGRAM_WINDOW_REQUIRED');
  return Object.freeze({ program_id: programId, tenant_id: program.tenant_id, repository_sha: sha, starts_at: program.starts_at, expires_at: program.expires_at, stage: program.stage });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const env = process.env, programId = env.PRIVATE_BETA_PROGRAM_ID;
    assert(process.argv.length === 2 && env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_REPOSITORY === 'AlisanMedia/GOLD-REVENUE-OS-PRO' && env.VALIDATED_SHA === env.GITHUB_SHA && /^[a-f0-9]{40}$/u.test(env.VALIDATED_SHA ?? '') && uuid.test(programId ?? '') && env.RUNNER_TEMP, 'PROTECTED_EXACT_PROGRAM_REQUIRED');
    assert(env.SUPABASE_ACCESS_TOKEN && env.POLAT_UAT_ANTHROPIC_ADMIN_KEY && env.POLAT_UAT_ANTHROPIC_API_KEY, 'PROTECTED_ACCOUNT_CREDENTIALS_REQUIRED');
    // Only a typed UUID enters the SQL literal; no input query, table, URL, approval or proof field.
    const query = "select jsonb_build_object('program_id',p.id,'tenant_id',p.tenant_id,'repository_sha',p.configuration->>'repository_sha','starts_at',p.configuration->>'starts_at','expires_at',p.configuration->>'expires_at','stage',p.stage) as private_beta_program from private.private_beta_programs p join public.tenants t on t.id=p.tenant_id where p.id='" + programId + "'::uuid and t.status='active' and t.slug like 'private-beta-%' and not t.outbound_messaging_enabled";
    const response = await fetch('https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
    assert(response.ok, 'OWNED_PROGRAM_READ_UNAVAILABLE'); const raw = await response.text(); assert(Buffer.byteLength(raw) <= 16384, 'OWNED_PROGRAM_READ_BOUND');
    const program = parsePrivateBetaAccountProgram(JSON.parse(raw), programId, env.VALIDATED_SHA);
    const observation = await readPolatAnthropicUatAccount({ config: { workspace_id: env.ANTHROPIC_UAT_WORKSPACE_ID, spend_limit_id: env.ANTHROPIC_UAT_SPEND_LIMIT_ID, api_key_id: env.ANTHROPIC_UAT_API_KEY_ID, program_starts_at: program.starts_at, program_expires_at: program.expires_at }, adminCredential: async () => env.POLAT_UAT_ANTHROPIC_ADMIN_KEY, inferenceCredential: async () => env.POLAT_UAT_ANTHROPIC_API_KEY });
    const result = { version: 1, mode: 'PROTECTED_READ_ONLY_ACCOUNT_PREFLIGHT', repository_sha: env.VALIDATED_SHA, program_id: program.program_id,
      observation, actual_inference_requests: 0, genuine_execution_authority: 'BLOCKED', actual_attempt_billing: 'UNKNOWN',
      unresolved: ['OBSERVED_MONTHLY_CAP_IS_NOT_TRANSACTIONAL_EXPERIMENT_AUTHORITY', 'INDEPENDENT_DATA_POLICY_AND_CUSTODY_PROOF_REQUIRED', 'CANARY_REQUIRES_AUTHENTICATED_OWNER_GRANT_AND_COMMITTED_RESERVATION', 'ACTUAL_CANARY_BILLING_RECONCILIATION_REQUIRED_BEFORE_FOUNDER_AND_FRIENDS'],
      database_authority_written: false, financial_authority: 'NONE', commercial_pilot: 'NO_GO' };
    writeFileSync(env.RUNNER_TEMP + '/private-beta-anthropic-account-observation.json', JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    assert(observation.state === 'OBSERVED', 'OFFICIAL_ACCOUNT_CAP_OR_USAGE_UNVERIFIED');
    process.stdout.write('OBSERVED: official account/model/cap/usage read only. No inference, authority write or real-model acceptance.\n');
  } catch (error) { process.stderr.write('PRIVATE_BETA_ACCOUNT_PREFLIGHT_BLOCKED: ' + (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'ACCOUNT_READ_UNAVAILABLE') + '\n'); process.exitCode = 1; }
}
