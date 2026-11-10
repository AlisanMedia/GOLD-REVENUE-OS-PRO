import { IDENTITY_DOMAINS_V1 } from "../packages/contracts/src/historical/identity-domains-v1.ts";
import { IDENTITY_WIRE_V1 } from "../packages/contracts/src/historical/identity-wire-v1.ts";
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseJeffClaudeJson } from '../packages/domain/src/jeff-claude-json.ts';

const DATABASE = 'https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query';
const MODEL = 'https://api.openai.com/v1/models/gpt-6.1-sol';
const PRICING = 'https://developers.openai.com/api/docs/models/gpt-6.1-sol.md';
const POLICY = 'https://developers.openai.com/api/docs/guides/your-data.md';
const NOTICE = 'jeff-private-beta-notice-openai-v1';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const sha = /^[a-f0-9]{40}$/u, hash = /^[a-f0-9]{64}$/u;
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const assert = (condition, code) => { if (!condition) throw Error(code); };
const credential = value => typeof value === 'string' && value.length >= 20 && value.length <= 4096 && !/[\r\n\0]/u.test(value);
const codes = new Set(['PROTECTED_EXACT_PROGRAM_REQUIRED', 'FOUNDER_MODEL_CREDENTIALS_REQUIRED', 'FOUNDER_MODEL_SCOPE_REQUIRED', 'FOUNDER_MODEL_PROGRAM_REQUIRED',
  'FOUNDER_MODEL_RESPONSE_INVALID', 'FOUNDER_MODEL_RESPONSE_BOUND', 'FOUNDER_MODEL_JSON_INVALID', 'FOUNDER_MODEL_READ_UNAVAILABLE', 'FOUNDER_MODEL_TIMEOUT',
  'FOUNDER_MODEL_ACCESS_UNVERIFIED', 'FOUNDER_MODEL_PRICING_DRIFT', 'FOUNDER_MODEL_POLICY_UNVERIFIED', 'FOUNDER_MODEL_TIME_INVALID', 'FOUNDER_MODEL_PERSISTENCE_UNVERIFIED']);

// Pin the reviewed Standard pricing terms, including modifiers. An added fee,
// changed rate or ambiguous duplicate row requires review, never a silent default.
const reviewedPricing = `## Pricing

Pricing is based on the number of tokens used, or other metrics based on the model type. For tool-specific models, like search and computer use, there’s a fee per tool call. See details in the [pricing page](/api/docs/pricing).

### Text tokens

| Metric | Price | Unit |
| --- | ---: | --- |
| Input | $2 | 1M tokens |
| Cached input | $0.1 | 1M tokens |
| Cache writes | $2.5 | 1M tokens |
| Output | $10 | 1M tokens |

- Cached input tokens are priced at 5% of the uncached input token rate.
- Cache writes are billed at 1.25x the uncached input token rate.
- API prompts with more than 272K input tokens are priced at 2x input and cache rates and 1.5x output for the full request.
- Fast mode prices are 2x Standard. Batch and Flex prices are 50% lower than Standard.
- Ultrafast mode prices are 6x Standard.
- Regional processing adds a 10% premium where available.
- GPT-6.1 Sol uses a default context window of 500K tokens in Codex and ChatGPT Work. Usage drawn from your subscription has no long-context surcharge. See [Codex pricing](/codex/pricing).`;

async function abortable(pending, signal) {
  if (signal.aborted) throw Error('FOUNDER_MODEL_TIMEOUT');
  let abort;
  const stopped = new Promise((_resolve, reject) => { abort = () => reject(Error('FOUNDER_MODEL_TIMEOUT')); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([pending, stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}
async function readOnce(request, url, init, json = true) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000), bound = json ? 16384 : 131072;
  try {
    const response = await abortable(request(url, { ...init, redirect: 'error', signal: controller.signal }), controller.signal);
    const contentType = response.headers.get('content-type') ?? '';
    const acceptedStatus = response.status === 200 || response.status === 201 && url === DATABASE && init.method === 'POST' && json;
    assert(acceptedStatus && response.url === url && !response.redirected && response.body
      && (json ? /^application\/json(?:\s*;|$)/iu.test(contentType) : /^text\/(?:plain|markdown)(?:\s*;|$)/iu.test(contentType)), 'FOUNDER_MODEL_RESPONSE_INVALID');
    const length = response.headers.get('content-length');
    assert(length === null || /^[0-9]{1,8}$/u.test(length) && Number(length) <= bound, 'FOUNDER_MODEL_RESPONSE_BOUND');
    const reader = response.body.getReader(), chunks = []; let bytes = 0, complete = false;
    try {
      for (let index = 0; index < 2048; index++) {
        const part = await abortable(reader.read(), controller.signal);
        if (part.done) { complete = true; break; }
        assert(part.value instanceof Uint8Array, 'FOUNDER_MODEL_RESPONSE_INVALID');
        bytes += part.value.byteLength; assert(bytes <= bound, 'FOUNDER_MODEL_RESPONSE_BOUND'); chunks.push(part.value);
      }
      assert(complete, 'FOUNDER_MODEL_RESPONSE_BOUND');
    } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    let raw, value;
    try { raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)); value = json ? parseJeffClaudeJson(raw, bound) : null; }
    catch { throw Error('FOUNDER_MODEL_JSON_INVALID'); }
    return { raw, value, response_hash: digest(raw), organization: response.headers.get('openai-organization'), project: response.headers.get('openai-project') };
  } catch (error) {
    if (error instanceof Error && codes.has(error.message)) throw error;
    throw Error(controller.signal.aborted ? 'FOUNDER_MODEL_TIMEOUT' : 'FOUNDER_MODEL_READ_UNAVAILABLE');
  } finally { clearTimeout(timer); controller.abort(); }
}
function scopeMetadata(value, id, prefix) {
  return value === null || typeof value === 'string' && /^[\x20-\x7e]{1,256}$/u.test(value) && (!value.startsWith(prefix) || value === id);
}
function programFrom(value, id) {
  assert(Array.isArray(value) && value.length === 1, 'FOUNDER_MODEL_PROGRAM_REQUIRED');
  const p = value[0]?.private_beta_program;
  const continuation = (p?.stage === 'CANARY' && ['2', '4'].includes(p.request_count) || ['CANARY', 'STOPPED'].includes(p?.stage) && p.request_count === '3') && p.continuation_available === true;
  assert(p?.database_role === 'postgres' && p.program_id === id && uuid.test(p.tenant_id ?? '') && p.tenant_status === 'active'
    && /^private-beta-[a-z0-9-]+$/u.test(p.tenant_slug ?? '') && p.outbound_messaging_enabled === false && (p.stage === 'DRAFT' && p.request_count === '0' || p.stage === 'CANARY' && p.request_count === '1' && p.recovery_available === true || continuation)
    && p.model_provider === 'openai' && p.model_name === 'gpt-6.1-sol' && (p.notice_version === NOTICE || continuation && p.request_count === '2' && p.notice_version === IDENTITY_WIRE_V1[NOTICE])
    && hash.test(p.manifest_hash ?? '') && hash.test(p.authorization_record_hash ?? '') && /^[1-9][0-9]{0,17}$/u.test(p.generation ?? '')
    && (p.repository_sha === null || sha.test(p.repository_sha ?? '')), 'FOUNDER_MODEL_PROGRAM_REQUIRED');
  return p;
}
function pricingFrom(raw, observedAt, expiresAt) {
  const text = raw.replaceAll('\r\n', '\n'), section = /^## Pricing\n[\s\S]*?(?=^## |$(?![\s\S]))/mu.exec(text)?.[0]?.trim();
  assert(/^# GPT-6\.1 Sol\n/u.test(text) && /^Model ID: `gpt-6\.1-sol`$/mu.test(text) && /^- 1,050,000 context window$/mu.test(text)
    && /^- Maximum input tokens: 922,000$/mu.test(text) && section === reviewedPricing && (text.match(/^## Pricing$/gmu) ?? []).length === 1, 'FOUNDER_MODEL_PRICING_DRIFT');
  return { version: 2, origin: 'INDEPENDENT_OFFICIAL_PRICING_READ', model: 'gpt-6.1-sol', currency: 'USD', source_url: PRICING.slice(0, -3), source_hash: digest(raw),
    maximum_input_tokens: 1050000, maximum_input_usd_per_million: '4.4', maximum_output_usd_per_million: '16.5', observed_at: observedAt, expires_at: expiresAt,
    // Scoped codec only: default tier, no tools or cache-write breakpoint; rates
    // include full-window multipliers and the documented 10% regional premium.
    all_billable_components_covered: true };
}
const canonicalEqual = (left, right) => {
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return left === right;
  if (Array.isArray(left) || Array.isArray(right)) return false;
  const keys = Object.keys(left).sort(), other = Object.keys(right).sort();
  return JSON.stringify(keys) === JSON.stringify(other) && keys.every(key => canonicalEqual(left[key], right[key]));
};

/** Protected executable collector. Only real fixed-source reads construct proof;
 * no supplied evidence, policy flags, cap declaration, inference or owner grant. */
export async function collectPrivateBetaFounderModel({ env, request = fetch, now = Date.now }) {
  const base = { version: 1, mode: 'PROTECTED_FOUNDER_MODEL_PRICING_OBSERVATION', actual_inference_requests: 0, provider_billing: 'UNKNOWN', provider_enforced_cap: 'UNVERIFIED',
    actual_billed_amount: null, owner_authority: 'NOT_GRANTED', genuine_execution_authority: 'BLOCKED', database_authority_written: false, financial_authority: 'NONE', commercial_pilot: 'NO_GO' };
  let write = 'NOT_ATTEMPTED';
  try {
    assert(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main'
      && env.GITHUB_REPOSITORY === 'AlisanMedia/GOLD-REVENUE-OS-PRO' && sha.test(env.VALIDATED_SHA ?? '') && env.GITHUB_SHA === env.VALIDATED_SHA
      && uuid.test(env.PRIVATE_BETA_PROGRAM_ID ?? ''), 'PROTECTED_EXACT_PROGRAM_REQUIRED');
    assert(credential(env.OPENAI_API_KEY) && credential(env.SUPABASE_ACCESS_TOKEN), 'FOUNDER_MODEL_CREDENTIALS_REQUIRED');
    const organization = env.OPENAI_UAT_ORGANIZATION_ID, project = env.OPENAI_UAT_PROJECT_ID, id = env.PRIVATE_BETA_PROGRAM_ID;
    assert(/^org[-_][A-Za-z0-9_-]{1,120}$/u.test(organization ?? '') && /^proj_[A-Za-z0-9_-]{1,120}$/u.test(project ?? ''), 'FOUNDER_MODEL_SCOPE_REQUIRED');
    const query = sql => readOnce(request, DATABASE, { method: 'POST', headers: { authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ query: sql }) });
    const read = "select jsonb_build_object('database_role',current_user,'program_id',p.id,'tenant_id',p.tenant_id,'tenant_status',t.status,'tenant_slug',t.slug,'outbound_messaging_enabled',t.outbound_messaging_enabled,'repository_sha',p.configuration->>'repository_sha','stage',p.stage,'request_count',p.request_count::text,'generation',p.generation::text,'recovery_available',private.private_beta_recovery_available(p),'continuation_available',private.private_beta_continuation_available(p),'manifest_hash',p.manifest_hash,'authorization_record_hash',p.authorization_record_hash,'model_provider',p.configuration->>'model_provider','model_name',p.configuration->>'model_name','notice_version',p.configuration->>'notice_version') as private_beta_program from private.private_beta_programs p join public.tenants t on t.id=p.tenant_id where p.id='" + id + "'::uuid and t.status='active' and t.slug like 'private-beta-%' and not t.outbound_messaging_enabled";
    const program = programFrom((await query(read)).value, id);
    const observedModel = await readOnce(request, MODEL, { method: 'GET', headers: { authorization: 'Bearer ' + env.OPENAI_API_KEY, 'OpenAI-Organization': organization, 'OpenAI-Project': project, accept: 'application/json' } });
    const model = observedModel.value;
    assert(model?.id === 'gpt-6.1-sol' && model.object === 'model' && Number.isSafeInteger(model.created) && model.created >= 0
      && typeof model.owned_by === 'string' && model.owned_by.length > 0 && model.owned_by.length <= 160
      && scopeMetadata(observedModel.organization, organization, 'org-') && scopeMetadata(observedModel.organization, organization, 'org_') && scopeMetadata(observedModel.project, project, 'proj_'), 'FOUNDER_MODEL_ACCESS_UNVERIFIED');
    const source = await readOnce(request, PRICING, { method: 'GET', headers: { accept: 'text/markdown, text/plain' } }, false);
    const policy = await readOnce(request, POLICY, { method: 'GET', headers: { accept: 'text/markdown, text/plain' } }, false);
    assert(/^# Data controls in the OpenAI platform\r?\n/u.test(policy.raw) && /Understand how OpenAI uses your data, and how you can control it\./u.test(policy.raw), 'FOUNDER_MODEL_POLICY_UNVERIFIED');
    const at = now(); assert(Number.isSafeInteger(at) && at > 0 && at + 86400000 <= 8640000000000000, 'FOUNDER_MODEL_TIME_INVALID');
    const observedAt = new Date(at).toISOString(), expiresAt = new Date(at + 86400000).toISOString(), pricing = pricingFrom(source.raw, observedAt, expiresAt);
    const keyHash = digest(env.OPENAI_API_KEY), scopeHash = digest(JSON.stringify(['OPENAI_PROJECT1', organization, project]));
    const observation = { version: 1, origin: 'PROTECTED_OPENAI_MODEL_AND_PRICING_OBSERVATION', program_id: id, tenant_id: program.tenant_id, repository_sha: env.VALIDATED_SHA,
      organization_id: organization, project_id: project, credential_sha256: keyHash, account_scope_hash: scopeHash,
      credential_custody_hash: digest(JSON.stringify([IDENTITY_DOMAINS_V1["JEFF_UAT_CREDENTIAL_CUSTODY1"], scopeHash, keyHash])), provider: 'openai', model: 'gpt-6.1-sol', model_access: true,
      model_response_hash: observedModel.response_hash, policy_hash: policy.response_hash, observed_at: observedAt, expires_at: expiresAt };
    const payload = { observation, pricing }, encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('hex');
    // The namespace migration preserved this program's original notice. Read it
    // only for its independently eligible two-UNKNOWN continuation; the owner
    // action later creates the current notice/configuration under fresh MFA.
    const noticeRevision = "p.configuration->>'notice_version'='" + program.notice_version + "'"
      + (program.notice_version === IDENTITY_WIRE_V1[NOTICE]
        ? " and p.stage='CANARY' and p.request_count=2 and private.private_beta_continuation_available(p)" : '');
    const revision = "p.id='" + id + "'::uuid and p.tenant_id='" + program.tenant_id + "'::uuid and p.generation=" + program.generation
      + " and p.manifest_hash='" + program.manifest_hash + "' and p.authorization_record_hash='" + program.authorization_record_hash + "' and ((p.stage='DRAFT' and p.request_count=0) or private.private_beta_recovery_available(p) or private.private_beta_continuation_available(p))"
      + " and p.configuration->>'model_provider'='openai' and p.configuration->>'model_name'='gpt-6.1-sol' and " + noticeRevision
      + " and t.status='active' and t.slug like 'private-beta-%' and not t.outbound_messaging_enabled";
    const writeSql = "do $founder_model$ begin perform 1 from private.private_beta_programs p join public.tenants t on t.id=p.tenant_id where " + revision
      + " for update of p; if not found then raise exception 'PRIVATE_BETA_MODEL_REVISION_CHANGED' using errcode='40001'; end if; perform private.private_beta_founder_model_record('"
      + program.tenant_id + "'::uuid,'" + id + "'::uuid,convert_from(decode('" + encoded + "','hex'),'UTF8')); end $founder_model$;";
    assert(now() >= at && now() - at <= 300000, 'FOUNDER_MODEL_TIME_INVALID');
    write = 'UNVERIFIED'; await query(writeSql);
    const readback = (await query("select current_user as database_role,p.founder_model_observation from private.private_beta_programs p join public.tenants t on t.id=p.tenant_id where " + revision)).value;
    assert(Array.isArray(readback) && readback.length === 1 && readback[0]?.database_role === 'postgres' && canonicalEqual(readback[0]?.founder_model_observation, payload)
      && now() >= at && now() - at <= 300000, 'FOUNDER_MODEL_PERSISTENCE_UNVERIFIED');
    return Object.freeze({ ...base, state: 'RECORDED', database_observation_write: 'VERIFIED', repository_sha: env.VALIDATED_SHA, account_scope_hash: scopeHash,
      model_response_hash: observation.model_response_hash, pricing_source_hash: pricing.source_hash, policy_hash: observation.policy_hash, observed_at: observedAt, expires_at: expiresAt });
  } catch (error) {
    return Object.freeze({ ...base, state: 'BLOCKED', database_observation_write: write,
      reason: error instanceof Error && codes.has(error.message) ? error.message : 'FOUNDER_MODEL_READ_UNAVAILABLE' });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert(process.argv.length === 2 && typeof process.env.RUNNER_TEMP === 'string' && process.env.RUNNER_TEMP.startsWith('/'), 'PROTECTED_EXACT_PROGRAM_REQUIRED');
    const result = await collectPrivateBetaFounderModel({ env: process.env });
    writeFileSync(join(process.env.RUNNER_TEMP, 'private-beta-founder-model-observation.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    if (result.state !== 'RECORDED') { process.stderr.write('PRIVATE_BETA_FOUNDER_MODEL_BLOCKED: ' + result.reason + '\n'); process.exitCode = 1; }
    else process.stdout.write('RECORDED: protected model and public pricing/policy observation only. Owner grant, inference, provider cap and actual billing remain ungranted or unverified.\n');
  } catch { process.stderr.write('PRIVATE_BETA_FOUNDER_MODEL_BLOCKED: PROTECTED_OBSERVATION_UNAVAILABLE\n'); process.exitCode = 1; }
}
