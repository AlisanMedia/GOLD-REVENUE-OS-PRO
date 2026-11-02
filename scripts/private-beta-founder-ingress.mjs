import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePolatClaudeJson } from '../packages/domain/src/polat-claude-json.ts';
import { privateBetaBotWebhookRequest } from './private-beta-release-bot.mjs';
import { PRIVATE_BETA_VERCEL as TARGET, validatePrivateBetaVercelProject, validatePrivateBetaDeployment } from './private-beta-release-vercel.mjs';

const ROOT = 'https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc', DATABASE = ROOT + '/database/query';
const EDGE = 'https://xqvwkghpmezcpgugetqc.supabase.co/functions/v1/polat-private-beta-ingress';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu, sha = /^[a-f0-9]{40}$/u, hash = /^[a-f0-9]{64}$/u;
const secretNames = ['POLAT_UAT_TELEGRAM_WEBHOOK_SECRET', 'POLAT_UAT_RELAY_SECRET'], selectors = ['POLAT_UAT_TENANT_ID', 'POLAT_UAT_PROGRAM_ID'];
const secret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/u.test(value);
const credential = value => typeof value === 'string' && value.length >= 20 && value.length <= 4096 && !/[\r\n\0]/u.test(value);
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const assert = (condition, code) => { if (!condition) throw Error(code); };
const codes = new Set(['INGRESS_PROTECTED_SCOPE_REQUIRED', 'INGRESS_CREDENTIALS_REQUIRED', 'INGRESS_RESPONSE_INVALID', 'INGRESS_RESPONSE_BOUND', 'INGRESS_RESPONSE_JSON_INVALID', 'INGRESS_READ_UNAVAILABLE', 'INGRESS_TIMEOUT',
  'INGRESS_PROGRAM_REQUIRED', 'INGRESS_OWNER_BUSINESS_REQUIRED', 'INGRESS_AUTOMATION_BYPASS_REQUIRED', 'INGRESS_ENV_METADATA_INCOMPLETE', 'INGRESS_ENV_SCOPE_CONFLICT',
  'INGRESS_EXISTING_SECRET_UNREADABLE', 'INGRESS_SELECTOR_CONFLICT', 'INGRESS_ENV_PERSISTENCE_UNVERIFIED', 'INGRESS_SECRET_INVALID', 'INGRESS_CUSTODY_REQUIRED',
  'INGRESS_SSO_OR_GIT_DRIFT', 'INGRESS_ALIAS_UNVERIFIED', 'INGRESS_BOT_IDENTITY_UNVERIFIED', 'INGRESS_WEBHOOK_CONFLICT', 'INGRESS_WEBHOOK_UNVERIFIED',
  'INGRESS_BOT_PERSISTENCE_UNVERIFIED', 'INGRESS_AUTHENTICATION_UNVERIFIED', 'INGRESS_TIME_INVALID', 'EXACT_ISOLATED_STAGING_REQUIRED', 'EXISTING_SSO_REQUIRED', 'EXISTING_GITHUB_CONNECTION_REQUIRED', 'READY_ISOLATED_STAGING_REQUIRED', 'DEPLOYED_SHA_MISMATCH']);
const same = (a, b) => {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  const keys = Object.keys(a).sort(); return same(keys, Object.keys(b).sort()) && keys.every(key => same(a[key], b[key]));
};
async function abortable(pending, signal) {
  if (signal.aborted) throw Error('INGRESS_TIMEOUT');
  let stop;
  const stopped = new Promise((_resolve, reject) => { stop = () => reject(Error('INGRESS_TIMEOUT')); signal.addEventListener('abort', stop, { once: true }); });
  try { return await Promise.race([pending, stopped]); } finally { signal.removeEventListener('abort', stop); }
}
// Vercel infrastructure metadata may contain finite exponent-form resource prices
// and larger nested project/team objects. It is not model/financial evidence.
// Keep duplicate-key, prototype-key, Unicode, finite/safe-number and size fences;
// the existing strict model parser remains unchanged for all other reads.
function vercelMetadataJson(raw) {
  const fail = () => Error('INGRESS_RESPONSE_JSON_INVALID');
  let i = 0, nodes = 0;
  const ws = () => { while (/[\x20\t\r\n]/u.test(raw[i] ?? '!')) i++; };
  function string() {
    const start = i++;
    while (i < raw.length) {
      const c = raw[i++];
      if (c === '\\') { i++; continue; }
      if (c === '"') {
        const value = JSON.parse(raw.slice(start, i));
        if (typeof value !== 'string' || Buffer.from(value, 'utf8').toString('utf8') !== value) throw fail();
        return value;
      }
    }
    throw fail();
  }
  function value(depth) {
    if (++nodes > 32768 || depth > 32) throw fail();
    ws(); const c = raw[i];
    if (c === '"') { string(); return; }
    if (c === '{' || c === '[') {
      i++; ws(); const end = c === '{' ? '}' : ']', keys = new Set();
      if (raw[i] === end) { i++; return; }
      while (true) {
        ws();
        if (c === '{') {
          if (raw[i] !== '"') throw fail();
          const key = string();
          if (keys.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw fail();
          keys.add(key); ws(); if (raw[i++] !== ':') throw fail();
        }
        value(depth + 1); ws();
        if (raw[i] === end) { i++; return; }
        if (raw[i++] !== ',') throw fail();
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(raw.slice(i))?.[0];
    if (!token) throw fail();
    if (!/^(true|false|null)$/u.test(token)) {
      const n = Number(token), mantissa = token.split(/[eE]/u)[0];
      if (!Number.isFinite(n) || Number.isInteger(n) && !Number.isSafeInteger(n) || n === 0 && /[1-9]/u.test(mantissa)) throw fail();
    }
    i += token.length;
  }
  try { value(0); ws(); if (i !== raw.length) throw fail(); return JSON.parse(raw); }
  catch { throw fail(); }
}
async function jsonOnce(request, url, init = {}, statuses = [200], emptyCreated = false, metadata = false, observation = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await abortable(request(url, { ...init, redirect: 'error', signal: controller.signal }), controller.signal);
    if (Number.isInteger(r.status) && r.status >= 100 && r.status <= 599) observation.http_status = r.status;
    assert(statuses.includes(r.status) && r.url === url && !r.redirected, 'INGRESS_RESPONSE_INVALID');
    // Official Supabase OpenAPI v1-bulk-create-secrets has201 with no content.
    // This flag is confined to that fixed write; all evidence reads require JSON.
    if (emptyCreated && r.status === 201) { void r.body?.cancel().catch(() => undefined); return { value: null, response_hash: null }; }
    assert(/^application\/json(?:\s*;|$)/iu.test(r.headers.get('content-type') ?? '') && r.body, 'INGRESS_RESPONSE_INVALID');
    const length = r.headers.get('content-length'); assert(length === null || /^[0-9]{1,8}$/u.test(length) && Number(length) <= 1048576, 'INGRESS_RESPONSE_BOUND');
    const reader = r.body.getReader(), chunks = []; let bytes = 0, complete = false;
    try {
      for (let i = 0; i < 2048; i++) { const p = await abortable(reader.read(), controller.signal); if (p.done) { complete = true; break; }
        assert(p.value instanceof Uint8Array, 'INGRESS_RESPONSE_INVALID'); bytes += p.value.byteLength; assert(bytes <= 1048576, 'INGRESS_RESPONSE_BOUND'); chunks.push(p.value); }
      assert(complete, 'INGRESS_RESPONSE_BOUND');
    } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
    try { return { value: metadata ? vercelMetadataJson(raw) : parsePolatClaudeJson(raw, 1048576), response_hash: digest(raw) }; }
    catch { throw Error('INGRESS_RESPONSE_JSON_INVALID'); }
  } catch (error) {
    if (error instanceof Error && codes.has(error.message)) throw error;
    throw Error(controller.signal.aborted ? 'INGRESS_TIMEOUT' : 'INGRESS_READ_UNAVAILABLE');
  } finally { clearTimeout(timer); controller.abort(); }
}
function protectedInput(env, command) {
  assert(['prepare', 'register'].includes(command) && env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_REPOSITORY === 'AlisanMedia/GOLD-REVENUE-OS-PRO' && sha.test(env.VALIDATED_SHA ?? '') && env.GITHUB_SHA === env.VALIDATED_SHA
    && uuid.test(env.PRIVATE_BETA_PROGRAM_ID ?? '') && typeof env.RUNNER_TEMP === 'string' && env.RUNNER_TEMP.startsWith('/'), 'INGRESS_PROTECTED_SCOPE_REQUIRED');
  assert(credential(env.SUPABASE_ACCESS_TOKEN) && credential(env.VERCEL_TOKEN) && /^[1-9][0-9]{4,18}:[A-Za-z0-9_-]{20,200}$/u.test(env.POLAT_UAT_TELEGRAM_BOT_TOKEN ?? ''), 'INGRESS_CREDENTIALS_REQUIRED');
}
function custodyFile(env) { return join(env.RUNNER_TEMP, 'private-beta-founder-ingress-private.json'); }
function readCustody(env) {
  try {
    const path = custodyFile(env), stat = lstatSync(path);
    assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.size <= 16384 && (typeof process.getuid !== 'function' || stat.uid === process.getuid()), 'INGRESS_CUSTODY_REQUIRED');
    const v = parsePolatClaudeJson(readFileSync(path, 'utf8'), 16384);
    assert(v?.version === 1 && v.repository_sha === env.VALIDATED_SHA && v.program_id === env.PRIVATE_BETA_PROGRAM_ID && uuid.test(v.tenant_id ?? '')
      && secret(v.webhook_secret) && secret(v.relay_secret) && credential(v.vercel_bypass) && hash.test(v.bot_credential_hash ?? '')
      && v.bot_credential_hash === digest(env.POLAT_UAT_TELEGRAM_BOT_TOKEN), 'INGRESS_CUSTODY_REQUIRED');
    return v;
  } catch { throw Error('INGRESS_CUSTODY_REQUIRED'); }
}
function envEntry(entries, key) {
  const matches = entries.filter(v => v?.key === key);
  assert(matches.length <= 1, 'INGRESS_ENV_SCOPE_CONFLICT');
  const v = matches[0];
  if (v) assert(typeof v.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(v.id) && Array.isArray(v.target) && v.target.includes('production')
    && (v.gitBranch === undefined || v.gitBranch === null) && (!v.customEnvironmentIds || Array.isArray(v.customEnvironmentIds) && v.customEnvironmentIds.length === 0), 'INGRESS_ENV_SCOPE_CONFLICT');
  return v;
}
function listEntries(raw) {
  const values = Array.isArray(raw) ? raw : raw?.envs;
  assert(Array.isArray(values) && values.length <= 500 && (!raw?.pagination || raw.pagination.next === null || raw.pagination.next === undefined), 'INGRESS_ENV_METADATA_INCOMPLETE');
  return values;
}
function programFrom(value, id, command) {
  assert(Array.isArray(value) && value.length === 1, 'INGRESS_PROGRAM_REQUIRED');
  const p = value[0]?.private_beta_program;
  assert(p?.database_role === 'postgres' && p.program_id === id && uuid.test(p.tenant_id ?? '') && p.tenant_status === 'active' && /^private-beta-[a-z0-9-]+$/u.test(p.tenant_slug ?? '')
    && p.outbound_messaging_enabled === false && p.provider === 'openai' && p.model === 'gpt-6.1-sol' && hash.test(p.manifest_hash ?? '') && hash.test(p.authorization_record_hash ?? '')
    && /^[1-9][0-9]{0,17}$/u.test(p.generation ?? '') && (command === 'prepare' && p.stage === 'DRAFT'
      || p.owner_only_test === true && (p.stage === 'CANARY' || command === 'register' && p.stage === 'FOUNDER')), 'INGRESS_PROGRAM_REQUIRED');
  return p;
}

/** Fixed existing relay only. Network/random injection is solely for offline tests.
 * Private custody is a mode0600 runner file, never a result/artifact or log. */
export async function runPrivateBetaFounderIngress({ command, env, request = fetch, random = randomBytes, now = Date.now }) {
  const base = { version: 1, mode: 'PROTECTED_FOUNDER_BUSINESS_INGRESS', operation: ['prepare', 'register'].includes(command) ? command : 'INVALID', actual_inference_requests: 0, telegram_messages: 0, actual_billed_amount: null,
    provider_billing: 'UNKNOWN', provider_enforced_cap: 'UNVERIFIED', upstream_hmac_delivery_verified: false, financial_authority: 'NONE', commercial_pilot: 'NO_GO' };
  let mutation = 'NOT_ATTEMPTED', registration = 'NOT_ATTEMPTED', ingressAuthenticated = false, failedRead = null;
  try {
    protectedInput(env, command);
    const at = now(); assert(Number.isSafeInteger(at) && at > 0, 'INGRESS_TIME_INVALID');
    // Only static operation labels and HTTP status leave this boundary. Never
    // expose URLs, response bodies, credential keys or upstream error messages.
    const read = async (stage, url, init, statuses = [200], emptyCreated = false, metadata = false) => {
      const observation = {};
      try { return await jsonOnce(request, url, init, statuses, emptyCreated, metadata, observation); }
      catch (error) { failedRead = { request_stage: stage, ...(observation.http_status ? { request_http_status: observation.http_status } : {}) }; throw error; }
    };
    const vercel = async (path, method = 'GET', body) => (await read(path.startsWith('/v9/projects/') ? 'VERCEL_PROJECT' : path.startsWith('/v2/teams/') ? 'VERCEL_TEAM'
      : path.startsWith('/v10/projects/') ? method === 'POST' ? 'VERCEL_ENV_CREATE' : 'VERCEL_ENV_LIST' : path.startsWith('/v1/projects/') ? 'VERCEL_ENV_VALUE'
      : path.startsWith('/v4/aliases/') ? 'VERCEL_ALIAS' : 'VERCEL_DEPLOYMENT', 'https://api.vercel.com' + path + (path.includes('?') ? '&' : '?') + 'teamId=' + TARGET.team,
      { method, headers: { authorization: 'Bearer ' + env.VERCEL_TOKEN, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, method === 'POST' ? [200, 201] : [200], false, true)).value;
    // Supabase Management v1-run-a-query documents201. Unlike the separate
    // secret-write ACK, every query still requires bounded JSON and readback.
    const query = async sql => (await read('SUPABASE_PROGRAM', DATABASE, { method: 'POST', headers: { authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ query: sql }) }, [200, 201])).value;
    const project = await vercel('/v9/projects/' + TARGET.project), team = await vercel('/v2/teams/' + TARGET.team), identity = validatePrivateBetaVercelProject(project, team);
    const pRead = "select jsonb_build_object('database_role',current_user,'program_id',p.id,'tenant_id',p.tenant_id,'tenant_status',t.status,'tenant_slug',t.slug,'outbound_messaging_enabled',t.outbound_messaging_enabled,'provider',p.configuration->>'model_provider','model',p.configuration->>'model_name','stage',p.stage,'generation',p.generation::text,'manifest_hash',p.manifest_hash,'authorization_record_hash',p.authorization_record_hash,'repository_sha',p.configuration->>'repository_sha','model_observation_sha',p.founder_model_observation#>>'{observation,repository_sha}','owner_only_test',private.private_beta_founder_only(p),'recovery_available',private.private_beta_recovery_available(p),'canary_result_hash',private.private_beta_founder_canary_hash(p),'business_permitted',coalesce(private.private_beta_business_permitted(p,b),false),'bot_id',p.bot_control->>'bot_id','bot_credential_hash',p.bot_control->>'credential_sha256','representative_user_id',b.representative_user_id,'founder_chat_id',b.founder_chat_id) as private_beta_program from private.private_beta_programs p join public.tenants t on t.id=p.tenant_id left join private.private_beta_business_controls b on b.program_id=p.id and b.tenant_id=p.tenant_id where p.id='" + env.PRIVATE_BETA_PROGRAM_ID + "'::uuid and t.status='active' and t.slug like 'private-beta-%' and not t.outbound_messaging_enabled";
    const program = programFrom(await query(pRead), env.PRIVATE_BETA_PROGRAM_ID, command);
    const scopeHash = digest(JSON.stringify([program.tenant_id, program.program_id, env.VALIDATED_SHA]));
    if (command === 'prepare') {
      if (program.stage === 'CANARY' && program.recovery_available !== true) assert(program.owner_only_test === true && hash.test(program.canary_result_hash ?? '') && program.repository_sha === env.VALIDATED_SHA
        && program.model_observation_sha === env.VALIDATED_SHA, 'INGRESS_OWNER_BUSINESS_REQUIRED');
      const bypasses = Object.entries(project.protectionBypass ?? {}).filter(([key, v]) => credential(key) && v?.scope === 'automation-bypass' && v.isEnvVar !== false);
      assert(bypasses.length === 1, 'INGRESS_AUTOMATION_BYPASS_REQUIRED');
      const bypass = bypasses[0][0], entries = listEntries(await vercel('/v10/projects/' + TARGET.project + '/env?decrypt=false'));
      const getValue = async key => {
        const entry = envEntry(entries, key); if (!entry) return null;
        // The documented sensitive response has no value. Never rotate or treat
        // ciphertext/absence as a recoverable secret.
        const v = await vercel('/v1/projects/' + TARGET.project + '/env/' + entry.id);
        assert(v?.key === key && (v.id === undefined || v.id === entry.id) && typeof v.value === 'string' && (v.type === 'plain' || v.decrypted === true), 'INGRESS_EXISTING_SECRET_UNREADABLE');
        return v.value;
      };
      const values = {};
      for (const key of [...secretNames, ...selectors]) values[key] = await getValue(key);
      for (const [key, expected] of [[selectors[0], program.tenant_id], [selectors[1], program.program_id]]) assert(values[key] === null || values[key] === expected, 'INGRESS_SELECTOR_CONFLICT');
      for (const key of secretNames) {
        if (values[key] === null) { const bytes = random(32); assert(bytes instanceof Uint8Array && bytes.length === 32, 'INGRESS_SECRET_INVALID'); values[key] = Buffer.from(bytes).toString('base64url'); }
        assert(secret(values[key]), 'INGRESS_SECRET_INVALID');
      }
      assert(values[secretNames[0]] !== values[secretNames[1]], 'INGRESS_SECRET_INVALID');
      values[selectors[0]] = program.tenant_id; values[selectors[1]] = program.program_id;
      const existingCustody = existsSync(custodyFile(env)) ? readCustody(env) : null;
      if (existingCustody) assert(existingCustody.tenant_id === program.tenant_id && existingCustody.webhook_secret === values[secretNames[0]]
        && existingCustody.relay_secret === values[secretNames[1]] && existingCustody.vercel_bypass === bypass
        && same(existingCustody.protection?.sso, identity.sso) && same(existingCustody.protection?.git, identity.git), 'INGRESS_CUSTODY_REQUIRED');
      const updated = [];
      for (const key of [...secretNames, ...selectors]) if (!envEntry(entries, key)) {
        // Create only absent keys. A concurrent creation fails instead of
        // overwriting another selector or rotating a newly supplied credential.
        mutation = 'UNVERIFIED'; await vercel('/v10/projects/' + TARGET.project + '/env?upsert=false', 'POST', { key, value: values[key], type: selectors.includes(key) ? 'plain' : 'encrypted', target: ['production'] });
        mutation = 'ACKNOWLEDGED'; updated.push(key);
      }
      const afterEntries = listEntries(await vercel('/v10/projects/' + TARGET.project + '/env?decrypt=false'));
      for (const key of [...secretNames, ...selectors]) {
        const e = envEntry(afterEntries, key); assert(e, 'INGRESS_ENV_PERSISTENCE_UNVERIFIED');
        const v = await vercel('/v1/projects/' + TARGET.project + '/env/' + e.id);
        assert(v?.key === key && (v.id === undefined || v.id === e.id) && typeof v.value === 'string' && (v.type === 'plain' || v.decrypted === true) && v.value === values[key], 'INGRESS_ENV_PERSISTENCE_UNVERIFIED');
      }
      mutation = 'UNVERIFIED';
      await read('SUPABASE_SECRETS', ROOT + '/secrets', { method: 'POST', headers: { authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify([{ name: secretNames[0], value: values[secretNames[0]] }, { name: secretNames[1], value: values[secretNames[1]] }, { name: 'POLAT_UAT_VERCEL_BYPASS', value: bypass }]) }, [201], true);
      mutation = 'ACKNOWLEDGED';
      const custody = { version: 1, repository_sha: env.VALIDATED_SHA, program_id: program.program_id, tenant_id: program.tenant_id, bot_credential_hash: digest(env.POLAT_UAT_TELEGRAM_BOT_TOKEN),
        webhook_secret: values[secretNames[0]], relay_secret: values[secretNames[1]], vercel_bypass: bypass, protection: { sso: identity.sso, git: identity.git }, prepared_at: at };
      if (!existingCustody) writeFileSync(custodyFile(env), JSON.stringify(custody), { mode: 0o600, flag: 'wx' });
      return Object.freeze({ ...base, state: 'PREPARED', mutation_state: mutation, webhook_registration: registration, ingress_authentication_verified: false, repository_sha: env.VALIDATED_SHA, scope_hash: scopeHash,
        updated_names: updated, edge_secret_names: [...secretNames, 'POLAT_UAT_VERCEL_BYPASS'], edge_secret_write: 'ACKNOWLEDGED', edge_function_deployed: false, sso_changed: false });
    }
    const custody = readCustody(env);
    assert(custody.tenant_id === program.tenant_id && now() >= custody.prepared_at && now() - custody.prepared_at <= 86400000, 'INGRESS_CUSTODY_REQUIRED');
    assert(same(identity.sso, custody.protection?.sso) && same(identity.git, custody.protection?.git), 'INGRESS_SSO_OR_GIT_DRIFT');
    assert(project.protectionBypass?.[custody.vercel_bypass]?.scope === 'automation-bypass', 'INGRESS_AUTOMATION_BYPASS_REQUIRED');
    assert(program.owner_only_test === true && ['CANARY', 'FOUNDER'].includes(program.stage) && program.repository_sha === env.VALIDATED_SHA && program.model_observation_sha === env.VALIDATED_SHA
      && hash.test(program.canary_result_hash ?? '') && program.business_permitted === true && /^[1-9][0-9]{0,18}$/u.test(program.representative_user_id ?? '')
      && /^[1-9][0-9]{0,18}$/u.test(program.founder_chat_id ?? '') && program.representative_user_id !== program.founder_chat_id
      && program.bot_id === env.POLAT_UAT_TELEGRAM_BOT_TOKEN.split(':')[0] && program.bot_credential_hash === digest(env.POLAT_UAT_TELEGRAM_BOT_TOKEN), 'INGRESS_OWNER_BUSINESS_REQUIRED');
    let deploymentId;
    for (const aliasName of TARGET.aliases) {
      const a = await vercel('/v4/aliases/' + encodeURIComponent(aliasName)), id = a?.deploymentId ?? a?.deployment?.id;
      assert(typeof id === 'string' && /^dpl_[A-Za-z0-9]+$/u.test(id) && (a.projectId === undefined || a.projectId === TARGET.project) && (!deploymentId || deploymentId === id), 'INGRESS_ALIAS_UNVERIFIED'); deploymentId = id;
    }
    validatePrivateBetaDeployment(await vercel('/v13/deployments/' + deploymentId), env.VALIDATED_SHA);
    const botRoot = 'https://api.telegram.org/bot' + env.POLAT_UAT_TELEGRAM_BOT_TOKEN;
    const telegram = async (method, body = {}) => read('TELEGRAM_' + method.toUpperCase(), botRoot + '/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const me = await telegram('getMe'), bot = me.value?.result;
    assert(me.value?.ok === true && bot?.is_bot === true && Number.isSafeInteger(bot.id) && String(bot.id) === program.bot_id && bot.can_connect_to_business === true, 'INGRESS_BOT_IDENTITY_UNVERIFIED');
    const payload = privateBetaBotWebhookRequest(custody.webhook_secret, 'BUSINESS'), before = (await telegram('getWebhookInfo')).value;
    assert(before?.ok === true && typeof before.result?.url === 'string', 'INGRESS_WEBHOOK_UNVERIFIED');
    assert(before.result.url === '' || before.result.url === payload.url, 'INGRESS_WEBHOOK_CONFLICT');
    assert(payload.url === EDGE, 'INGRESS_AUTHENTICATION_UNVERIFIED');
    try {
      // Both probes exit before relay body parsing/HMAC/upstream. The invalid
      // header is shorter than any accepted webhook secret, so it cannot match.
      await read('EDGE_INVALID_SECRET_PROBE', EDGE, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'PRIVATE_BETA_INVALID_PROBE' }, body: '{}' }, [401]);
      await read('EDGE_AUTHENTICATED_MEDIA_PROBE', EDGE, { method: 'POST', headers: { 'content-type': 'text/plain', 'x-telegram-bot-api-secret-token': custody.webhook_secret }, body: '' }, [415]);
    } catch (error) {
      throw Error(error instanceof Error && error.message === 'INGRESS_TIMEOUT' ? 'INGRESS_TIMEOUT' : 'INGRESS_AUTHENTICATION_UNVERIFIED');
    }
    ingressAuthenticated = true;
    const observed = now(); assert(Number.isSafeInteger(observed) && observed >= at && observed - at <= 300000, 'INGRESS_TIME_INVALID');
    const proof = { version: 1, bot_id: program.bot_id, source_hash: me.response_hash, observed_at: new Date(observed).toISOString(), api_environment: 'production', credential_sha256: digest(env.POLAT_UAT_TELEGRAM_BOT_TOKEN) };
    const encoded = Buffer.from(JSON.stringify(proof)).toString('hex');
    const guard = "p.id='" + program.program_id + "'::uuid and p.tenant_id='" + program.tenant_id + "'::uuid and p.generation=" + program.generation
      + " and p.manifest_hash='" + program.manifest_hash + "' and p.authorization_record_hash='" + program.authorization_record_hash + "' and p.configuration->>'repository_sha'='" + env.VALIDATED_SHA
      + "' and p.founder_model_observation#>>'{observation,repository_sha}'='" + env.VALIDATED_SHA + "' and p.stage in('CANARY','FOUNDER') and private.private_beta_live_window(p)"
      + " and private.private_beta_founder_canary_hash(p) is not null and private.private_beta_founder_only(p) and private.private_beta_business_permitted(p,b)"
      + " and exists(select 1 from public.tenants t where t.id=p.tenant_id and t.status='active' and t.slug like 'private-beta-%' and not t.outbound_messaging_enabled)";
    mutation = 'UNVERIFIED'; await query("do $founder_bot$ begin perform 1 from private.private_beta_programs p join private.private_beta_business_controls b on b.program_id=p.id and b.tenant_id=p.tenant_id where " + guard
      + " for update of p; if not found then raise exception 'PRIVATE_BETA_BOT_REVISION_CHANGED' using errcode='40001'; end if; perform private.private_beta_bot_control_record('" + program.tenant_id + "'::uuid,'" + program.program_id
      + "'::uuid,convert_from(decode('" + encoded + "','hex'),'UTF8')); end $founder_bot$;");
    const recorded = await query("select current_user as database_role,p.bot_control from private.private_beta_programs p join private.private_beta_business_controls b on b.program_id=p.id and b.tenant_id=p.tenant_id where " + guard);
    assert(Array.isArray(recorded) && recorded.length === 1 && recorded[0]?.database_role === 'postgres' && same(recorded[0]?.bot_control, proof), 'INGRESS_BOT_PERSISTENCE_UNVERIFIED'); mutation = 'ACKNOWLEDGED';
    registration = 'UNKNOWN'; const accepted = (await telegram('setWebhook', payload)).value;
    assert(accepted?.ok === true && accepted.result === true, 'INGRESS_WEBHOOK_UNVERIFIED');
    const after = (await telegram('getWebhookInfo')).value, info = after?.result;
    assert(after?.ok === true && info?.url === payload.url && Array.isArray(info.allowed_updates) && same([...info.allowed_updates].sort(), [...payload.allowed_updates].sort())
      && (!info.last_error_message || info.last_error_message === '') && (!info.last_error_date || info.last_error_date === 0)
      && (!info.last_synchronization_error_date || info.last_synchronization_error_date === 0), 'INGRESS_WEBHOOK_UNVERIFIED');
    registration = 'VERIFIED';
    return Object.freeze({ ...base, state: 'REGISTERED', mutation_state: mutation, webhook_registration: registration, ingress_authentication_verified: ingressAuthenticated, repository_sha: env.VALIDATED_SHA, scope_hash: scopeHash,
      bot_id: program.bot_id, bot_source_hash: proof.source_hash, allowed_update_names: payload.allowed_updates, webhook_configuration_verified: true, inbound_delivery_observed: false, sso_changed: false });
  } catch (error) {
    return Object.freeze({ ...base, state: 'BLOCKED', mutation_state: mutation, webhook_registration: registration, ingress_authentication_verified: ingressAuthenticated,
      reason: error instanceof Error && codes.has(error.message) ? error.message : 'INGRESS_READ_UNAVAILABLE', ...failedRead });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert(process.argv.length === 3 && ['prepare', 'register'].includes(process.argv[2]), 'INGRESS_PROTECTED_SCOPE_REQUIRED');
    const command = process.argv[2], result = await runPrivateBetaFounderIngress({ command, env: process.env });
    assert(typeof process.env.RUNNER_TEMP === 'string' && process.env.RUNNER_TEMP.startsWith('/'), 'INGRESS_PROTECTED_SCOPE_REQUIRED');
    writeFileSync(join(process.env.RUNNER_TEMP, 'private-beta-founder-ingress-observation.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    if (result.state === 'BLOCKED') { process.stderr.write('PRIVATE_BETA_FOUNDER_INGRESS_BLOCKED: ' + result.reason
      + (result.request_stage ? ' stage=' + result.request_stage : '') + (result.request_http_status ? ' http_status=' + result.request_http_status : '') + '\n'); process.exitCode = 1; }
    else process.stdout.write('PASS: ' + result.state + ' existing isolated Business ingress only; no inference, message delivery or financial acceptance.\n');
  } catch { process.stderr.write('PRIVATE_BETA_FOUNDER_INGRESS_BLOCKED: PROTECTED_OPERATION_UNAVAILABLE\n'); process.exitCode = 1; }
}
