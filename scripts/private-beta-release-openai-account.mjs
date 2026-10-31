import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePrivateBetaAccountProgram } from './private-beta-release-account.mjs';
import { parsePolatClaudeJson } from '../packages/domain/src/polat-claude-json.ts';

const MODEL = 'gpt-6.1-sol';
const DATABASE_URL = 'https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query';
const MODEL_URL = 'https://api.openai.com/v1/models/gpt-6.1-sol';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const sha = /^[a-f0-9]{40}$/u;
const errors = new Set(['PROTECTED_EXACT_PROGRAM_REQUIRED', 'PROTECTED_ACCOUNT_CREDENTIALS_REQUIRED', 'OPENAI_SCOPE_REQUIRED', 'OWNED_PROGRAM_REQUIRED', 'PROGRAM_WINDOW_REQUIRED', 'OPENAI_PROGRAM_SELECTION_REQUIRED', 'OPENAI_PREFLIGHT_READ_UNAVAILABLE', 'OPENAI_PREFLIGHT_RESPONSE_INVALID', 'OPENAI_PREFLIGHT_RESPONSE_BOUND', 'OPENAI_PREFLIGHT_JSON_INVALID', 'OPENAI_PREFLIGHT_TIMEOUT', 'OPENAI_MODEL_METADATA_INVALID']);
const assert = (condition, code) => { if (!condition) throw Error(code); };
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const canonicalScopeHash = (organization, project) => hash(JSON.stringify(['OPENAI_PROJECT1', organization, project]));
const credential = value => typeof value === 'string' && value.length >= 16 && value.length <= 4096 && !/[\r\n\0]/u.test(value);

/** UUID-only, fixed-project SELECT. There is no caller-supplied query/host or authority writer. */
export function privateBetaOpenAIAccountQuery(programId) {
  assert(uuid.test(programId ?? ''), 'OWNED_PROGRAM_REQUIRED');
  return "select jsonb_build_object('program_id',p.id,'tenant_id',p.tenant_id,'repository_sha',p.configuration->>'repository_sha','starts_at',p.configuration->>'starts_at','expires_at',p.configuration->>'expires_at','stage',p.stage,'model_provider',p.configuration->>'model_provider','model_name',p.configuration->>'model_name','notice_version',p.configuration->>'notice_version') as private_beta_program from private.private_beta_programs p join public.tenants t on t.id=p.tenant_id where p.id='" + programId + "'::uuid and t.status='active' and t.slug like 'private-beta-%' and not t.outbound_messaging_enabled";
}

async function abortable(pending, signal) {
  if (signal.aborted) throw Error('OPENAI_PREFLIGHT_TIMEOUT');
  let rejectAbort;
  const stopped = new Promise((_resolve, reject) => { rejectAbort = () => reject(Error('OPENAI_PREFLIGHT_TIMEOUT')); signal.addEventListener('abort', rejectAbort, { once: true }); });
  try { return await Promise.race([pending, stopped]); }
  finally { signal.removeEventListener('abort', rejectAbort); }
}

/** One bounded read, no retries, redirects, inference endpoint or response-body logging. */
async function readJson(url, init, request) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await abortable(request(url, { ...init, redirect: 'error', signal: controller.signal }), controller.signal);
    assert(response.status === 200 && !response.redirected && response.url === url && /^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') && response.body, 'OPENAI_PREFLIGHT_RESPONSE_INVALID');
    const length = response.headers.get('content-length');
    assert(length === null || /^[0-9]{1,8}$/u.test(length) && Number(length) <= 16384, 'OPENAI_PREFLIGHT_RESPONSE_BOUND');
    const reader = response.body.getReader(), chunks = []; let bytes = 0, complete = false;
    try {
      for (let index = 0; index < 1024; index++) {
        const part = await abortable(reader.read(), controller.signal);
        if (part.done) { complete = true; break; }
        assert(part.value instanceof Uint8Array, 'OPENAI_PREFLIGHT_RESPONSE_INVALID');
        bytes += part.value.byteLength; assert(bytes <= 16384, 'OPENAI_PREFLIGHT_RESPONSE_BOUND'); chunks.push(part.value);
      }
      assert(complete, 'OPENAI_PREFLIGHT_RESPONSE_BOUND');
    } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    let raw, value;
    try { raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)); value = parsePolatClaudeJson(raw, 16384); }
    catch { throw Error('OPENAI_PREFLIGHT_JSON_INVALID'); }
    return { value, response_hash: hash(raw) };
  } catch (error) {
    if (error instanceof Error && errors.has(error.message)) throw error;
    throw Error(controller.signal.aborted ? 'OPENAI_PREFLIGHT_TIMEOUT' : 'OPENAI_PREFLIGHT_READ_UNAVAILABLE');
  } finally { clearTimeout(timer); controller.abort(); }
}

/** Read-only preflight. An OBSERVED model/key availability result never grants inference or spending authority. */
export async function observePrivateBetaOpenAIAccount({ env, request = fetch, now = Date.now }) {
  let modelRequests = 0;
  const common = { version: 1, mode: 'PROTECTED_READ_ONLY_OPENAI_PREFLIGHT', provider: 'openai', model: MODEL, actual_inference_requests: 0,
    genuine_execution_authority: 'BLOCKED', actual_attempt_billing: 'UNKNOWN', actual_billed_amount: null, provider_account_authority: 'UNVERIFIED',
    effective_experiment_cap: 'UNVERIFIED', data_policy: 'UNVERIFIED', region: 'UNVERIFIED', retention_and_training: 'UNVERIFIED', database_authority_written: false,
    financial_authority: 'NONE', commercial_pilot: 'NO_GO' };
  try {
    const programId = env.PRIVATE_BETA_PROGRAM_ID;
    assert(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main'
      && env.GITHUB_REPOSITORY === 'AlisanMedia/GOLD-REVENUE-OS-PRO' && sha.test(env.VALIDATED_SHA ?? '') && env.VALIDATED_SHA === env.GITHUB_SHA && uuid.test(programId ?? ''), 'PROTECTED_EXACT_PROGRAM_REQUIRED');
    assert(credential(env.SUPABASE_ACCESS_TOKEN) && credential(env.OPENAI_API_KEY), 'PROTECTED_ACCOUNT_CREDENTIALS_REQUIRED');
    const organization = env.OPENAI_UAT_ORGANIZATION_ID, project = env.OPENAI_UAT_PROJECT_ID;
    assert(/^org[-_][A-Za-z0-9_-]{1,120}$/u.test(organization ?? '') && /^proj_[A-Za-z0-9_-]{1,120}$/u.test(project ?? ''), 'OPENAI_SCOPE_REQUIRED');
    const raw = await readJson(DATABASE_URL, { method: 'POST', headers: { authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ query: privateBetaOpenAIAccountQuery(programId) }) }, request);
    const program = parsePrivateBetaAccountProgram(raw.value, programId, env.VALIDATED_SHA), selected = raw.value[0]?.private_beta_program;
    assert(selected?.model_provider === 'openai' && selected.model_name === MODEL && selected.notice_version === 'polat-private-beta-notice-openai-v1', 'OPENAI_PROGRAM_SELECTION_REQUIRED');
    modelRequests++;
    const model = await readJson(MODEL_URL, { method: 'GET', headers: { authorization: 'Bearer ' + env.OPENAI_API_KEY, 'OpenAI-Organization': organization, 'OpenAI-Project': project, accept: 'application/json' } }, request);
    const value = model.value;
    assert(value && typeof value === 'object' && !Array.isArray(value) && value.id === MODEL && value.object === 'model'
      && Number.isSafeInteger(value.created) && value.created >= 0 && typeof value.owned_by === 'string' && value.owned_by.length > 0 && value.owned_by.length <= 160, 'OPENAI_MODEL_METADATA_INVALID');
    const observed = now(); assert(Number.isSafeInteger(observed) && observed > 0, 'OPENAI_PREFLIGHT_RESPONSE_INVALID');
    return Object.freeze({ ...common, state: 'OBSERVED', model_access: 'OBSERVED', model_metadata_requests: modelRequests,
      repository_sha: env.VALIDATED_SHA, program_id: program.program_id, account_scope_hash: canonicalScopeHash(organization, project),
      credential_sha256: hash(env.OPENAI_API_KEY), program_response_hash: raw.response_hash, model_response_hash: model.response_hash, observed_at: new Date(observed).toISOString(),
      unresolved: ['MODEL_METADATA_IS_NOT_ACCOUNT_OR_SPENDING_AUTHORITY', 'REPORTED_BALANCE_AND_PROJECT_BUDGET_ARE_NOT_ENFORCED_EXPERIMENT_CAP', 'INDEPENDENT_ACCOUNT_SCOPE_DATA_CUSTODY_AND_BILLING_PROOF_REQUIRED', 'EXACT_OWNER_GRANT_AND_COMMITTED_RESERVATION_REQUIRED_BEFORE_CANARY', 'INDEPENDENT_COMPLETE_CANARY_BILLING_REQUIRED_BEFORE_CONVERSATIONS'] });
  } catch (error) {
    return Object.freeze({ ...common, state: 'BLOCKED', model_access: 'UNVERIFIED', model_metadata_requests: modelRequests,
      reason: error instanceof Error && errors.has(error.message) ? error.message : 'OPENAI_PREFLIGHT_READ_UNAVAILABLE' });
  }
}

/** Existing-key metadata GET can diagnose access BEFORE an MFA-created beta
 * program exists. It never claims organization, hard-cap, billing or inference
 * authority, and cannot create a program or seal any account control. */
export async function observeConfiguredOpenAIModel({ env, request = fetch, now = Date.now }) {
  let attempted = 0, providerStatus = null;
  const common = { version: 1, mode: 'PROTECTED_READ_ONLY_MODEL_METADATA', provider: 'openai', model: MODEL,
    actual_inference_requests: 0, genuine_execution_authority: 'BLOCKED', provider_account_authority: 'UNVERIFIED',
    account_scope_hash: null, effective_experiment_cap: 'UNVERIFIED', actual_billed_amount: null,
    data_policy: 'UNVERIFIED', billing: 'UNKNOWN', database_authority_written: false, financial_authority: 'NONE', commercial_pilot: 'NO_GO' };
  try {
    assert(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main'
      && env.GITHUB_REPOSITORY === 'AlisanMedia/GOLD-REVENUE-OS-PRO' && sha.test(env.VALIDATED_SHA ?? '') && env.VALIDATED_SHA === env.GITHUB_SHA, 'PROTECTED_EXACT_PROGRAM_REQUIRED');
    assert(credential(env.OPENAI_API_KEY), 'PROTECTED_ACCOUNT_CREDENTIALS_REQUIRED');
    attempted++;
    const observed = await readJson(MODEL_URL, { method: 'GET', headers: { authorization: 'Bearer ' + env.OPENAI_API_KEY, accept: 'application/json' } },
      async (url, init) => { const response = await request(url, init); providerStatus = response.status; return response; });
    const value = observed.value;
    assert(value && value.id === MODEL && value.object === 'model' && Number.isSafeInteger(value.created) && value.created >= 0
      && typeof value.owned_by === 'string' && value.owned_by.length > 0 && value.owned_by.length <= 160, 'OPENAI_MODEL_METADATA_INVALID');
    const at = now(); assert(Number.isSafeInteger(at) && at > 0, 'OPENAI_PREFLIGHT_RESPONSE_INVALID');
    return Object.freeze({ ...common, state: 'OBSERVED', model_access: 'OBSERVED', model_metadata_requests: attempted,
      provider_status: providerStatus, repository_sha: env.VALIDATED_SHA, model_response_hash: observed.response_hash,
      observed_at: new Date(at).toISOString(), unresolved: ['PROJECT_IDENTITY_NOT_ESTABLISHED_BY_MODEL_METADATA',
        'INDEPENDENT_ACCOUNT_CAP_DATA_POLICY_CUSTODY_AND_BILLING_REQUIRED', 'AUTHENTICATED_OWNER_CONFIGURATION_AND_DURABLE_RESERVATION_REQUIRED'] });
  } catch (error) {
    return Object.freeze({ ...common, state: 'BLOCKED', model_access: 'UNVERIFIED', model_metadata_requests: attempted, provider_status: providerStatus,
      reason: error instanceof Error && errors.has(error.message) ? error.message : 'OPENAI_PREFLIGHT_READ_UNAVAILABLE' });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert(process.argv.length === 2 && typeof process.env.RUNNER_TEMP === 'string' && process.env.RUNNER_TEMP.startsWith('/'), 'PROTECTED_EXACT_PROGRAM_REQUIRED');
    const result = process.env.OPENAI_METADATA_ONLY === 'true'
      ? await observeConfiguredOpenAIModel({ env: process.env }) : await observePrivateBetaOpenAIAccount({ env: process.env });
    writeFileSync(join(process.env.RUNNER_TEMP, 'private-beta-openai-account-observation.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    if (result.state !== 'OBSERVED') { process.stderr.write('PRIVATE_BETA_OPENAI_PREFLIGHT_BLOCKED: ' + result.reason + '\n'); process.exitCode = 1; }
    else process.stdout.write('OBSERVED: one read-only OpenAI model metadata request. Inference, account/cap authority and actual billing remain BLOCKED/UNVERIFIED.\n');
  } catch { process.stderr.write('PRIVATE_BETA_OPENAI_PREFLIGHT_BLOCKED: PROTECTED_ACCOUNT_OBSERVATION_UNAVAILABLE\n'); process.exitCode = 1; }
}
