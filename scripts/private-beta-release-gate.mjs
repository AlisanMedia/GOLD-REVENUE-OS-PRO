import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PRIVATE_BETA_RELEASE_TARGET = Object.freeze({ repository: 'AlisanMedia/GOLD-REVENUE-OS-PRO', ref: 'refs/heads/main', ruleset: 25348710, actionsApp: 15368 });
const assert = (condition, code) => { if (!condition) throw Error(code); };
/** Pure validation of independently fetched read-back. This function/JSON is not execution authority. */
export function validatePrivateBetaReleaseGate(value) {
  const { sha, workflow_sha, repository, ref, repositoryInfo, main, ruleset, checks, environment, branchPolicies } = value;
  assert(repository === PRIVATE_BETA_RELEASE_TARGET.repository && ref === PRIVATE_BETA_RELEASE_TARGET.ref, 'PROTECTED_MAIN_REQUIRED');
  assert(typeof sha === 'string' && /^[a-f0-9]{40}$/u.test(sha) && sha === workflow_sha && sha === main?.commit?.sha && main?.protected === true, 'EXACT_CURRENT_MAIN_REQUIRED');
  assert(ruleset?.id === 25348710 && ruleset.enforcement === 'active', 'MAIN_RULESET_REQUIRED');
  // GitHub omits this field when the credential cannot inspect ruleset bypasses.
  // Omitted is unknown, never evidence that no bypass actors exist.
  assert(Array.isArray(ruleset.bypass_actors), 'MAIN_RULESET_BYPASS_VISIBILITY_REQUIRED');
  assert(ruleset.bypass_actors.length === 0, 'MAIN_RULESET_BYPASS_FORBIDDEN');
  assert(repositoryInfo?.default_branch === 'main' && ruleset.conditions?.ref_name?.exclude?.length === 0 && ruleset.conditions.ref_name.include?.some(r => r === 'refs/heads/main' || r === '~DEFAULT_BRANCH'), 'MAIN_RULESET_SCOPE_REQUIRED');
  const rules = ruleset.rules;
  assert(Array.isArray(rules) && ['deletion', 'non_fast_forward', 'pull_request'].every(type => rules.some(r => r.type === type)), 'MAIN_PROTECTIONS_REQUIRED');
  const pullRequest = rules.find(r => r.type === 'pull_request')?.parameters;
  assert(pullRequest?.required_approving_review_count === 0 && pullRequest.dismiss_stale_reviews_on_push === true && pullRequest.required_review_thread_resolution === true, 'ACCEPTED_PR_REVIEW_POLICY_REQUIRED');
  const status = rules.find(r => r.type === 'required_status_checks')?.parameters;
  assert(status?.strict_required_status_checks_policy === true && ['Application', 'Database'].every(name => status.required_status_checks?.some(c => c.context === name && c.integration_id === 15368)), 'INDEPENDENT_REQUIRED_CHECKS_REQUIRED');
  const accepted = ['Application', 'Database'].map(name => {
    const rows = checks?.check_runs?.filter(c => c.name === name && c.app?.id === 15368);
    assert(rows?.length === 1 && rows[0].head_sha === sha && rows[0].status === 'completed' && rows[0].conclusion === 'success', 'EXACT_HEAD_CI_SUCCESS_REQUIRED');
    return { name, id: rows[0].id, app_id: 15368, head_sha: sha, conclusion: 'success', url: rows[0].details_url };
  });
  const reviewers = environment?.protection_rules?.find(r => r.type === 'required_reviewers');
  assert(environment?.name === 'staging' && environment.can_admins_bypass === false && reviewers?.prevent_self_review === false && reviewers.reviewers?.some(r => r.type === 'User' && r.reviewer?.login === 'AlisanMedia'), 'PROTECTED_STAGING_REVIEW_REQUIRED');
  assert(environment.deployment_branch_policy?.custom_branch_policies === true && branchPolicies?.branch_policies?.length === 1 && branchPolicies.branch_policies[0].name === 'main' && branchPolicies.branch_policies[0].type === 'branch', 'EXACT_MAIN_ENVIRONMENT_REQUIRED');
  return Object.freeze({ version: 1, repository, sha, ref, required_checks: accepted, ruleset_id: 25348710, staging_reviewer: 'AlisanMedia', admins_bypass: false, financial_authority: 'NONE', commercial_pilot: 'NO_GO' });
}
async function readGitHub(path, token, network, code) {
  try {
    const response = await network('https://api.github.com/repos/AlisanMedia/GOLD-REVENUE-OS-PRO' + path, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'x-github-api-version': '2022-11-28' } });
    assert(response.ok, code);
    const reader = response.body?.getReader(); assert(reader, code);
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; assert(size <= 1048576, code);
        chunks.push(Buffer.from(value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const value = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    assert(value !== null && typeof value === 'object' && !Array.isArray(value), code);
    return value;
  } catch { throw Error(code); } // Never expose headers, provider bodies or transport errors.
}
/** Fixed read-only endpoints. The protected credential is never used for CI,
 * checkout, installs, builds, deployment or runtime, and has no token fallback. */
export async function readPrivateBetaReleaseGovernance({ sha, token, governanceToken, network = fetch }) {
  assert(typeof sha === 'string' && /^[a-f0-9]{40}$/u.test(sha), 'RELEASE_CONFIGURATION_REQUIRED');
  const validToken = value => typeof value === 'string' && /^[\x21-\x7e]{1,4096}$/u.test(value);
  assert(validToken(token), 'RELEASE_CONFIGURATION_REQUIRED');
  assert(validToken(governanceToken), 'GITHUB_GOVERNANCE_TOKEN_REQUIRED');
  const [repositoryInfo, main, ruleset, checks, environment, branchPolicies] = await Promise.all([
    readGitHub('', token, network, 'GITHUB_REPOSITORY_READ_UNAVAILABLE'),
    readGitHub('/branches/main', token, network, 'GITHUB_MAIN_READ_UNAVAILABLE'),
    readGitHub('/rulesets/25348710', governanceToken, network, 'GITHUB_RULESET_READ_UNAVAILABLE'),
    readGitHub('/commits/' + sha + '/check-runs?filter=latest&per_page=100', token, network, 'GITHUB_CHECKS_READ_UNAVAILABLE'),
    readGitHub('/environments/staging', governanceToken, network, 'GITHUB_ENVIRONMENT_READ_UNAVAILABLE'),
    readGitHub('/environments/staging/deployment-branch-policies?per_page=100', governanceToken, network, 'GITHUB_BRANCH_POLICY_READ_UNAVAILABLE'),
  ]);
  return { repositoryInfo, main, ruleset, checks, environment, branchPolicies };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert(process.argv.length === 2, 'NO_EXECUTION_OVERRIDE_FLAGS');
    const sha = process.env.VALIDATED_SHA, token = process.env.GH_TOKEN;
    assert(typeof sha === 'string' && /^[a-f0-9]{40}$/u.test(sha) && token, 'RELEASE_CONFIGURATION_REQUIRED');
    assert(process.env.GITHUB_REPOSITORY === PRIVATE_BETA_RELEASE_TARGET.repository && process.env.GITHUB_REF === PRIVATE_BETA_RELEASE_TARGET.ref, 'PROTECTED_MAIN_REQUIRED');
    assert(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() === sha && execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() === '', 'CLEAN_ACCEPTED_CHECKOUT_REQUIRED');
    const { repositoryInfo, main, ruleset, checks, environment, branchPolicies } = await readPrivateBetaReleaseGovernance({ sha, token, governanceToken: process.env.GH_GOVERNANCE_TOKEN });
    const evidence = validatePrivateBetaReleaseGate({ sha, workflow_sha: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF, repositoryInfo, main, ruleset, checks, environment, branchPolicies });
    const output = JSON.stringify({ ...evidence, observed_at: new Date().toISOString(), readback_sha256: createHash('sha256').update(JSON.stringify([main, ruleset, checks, environment, branchPolicies])).digest('hex') }, null, 2);
    assert(process.env.RUNNER_TEMP, 'PROTECTED_RUNNER_REQUIRED');
    writeFileSync(process.env.RUNNER_TEMP + '/private-beta-release-gate.json', output + '\n', { mode: 0o600 });
    process.stdout.write('PASS: current protected main, exact Application/Database app15368 and staging reviewer/branch controls independently read back.\n');
  } catch (error) { process.stderr.write('PRIVATE_BETA_RELEASE_BLOCKED: ' + (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'GOVERNANCE_UNAVAILABLE') + '\n'); process.exitCode = 1; }
}
