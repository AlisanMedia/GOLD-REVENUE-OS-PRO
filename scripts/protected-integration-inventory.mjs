import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { observeConfiguredOpenAIModel } from './private-beta-release-openai-account.mjs';
import { parsePolatClaudeJson } from '../packages/domain/src/polat-claude-json.ts';

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const assert = (value, code) => { if (!value) throw Error(code); };
const roles = Object.freeze([
  { role: 'BUSINESS_AI', credential: 'POLAT_UAT_TELEGRAM_BOT_TOKEN', test: false },
  { role: 'MERCHANT', credential: 'POLAT_STARS_MERCHANT_BOT_TOKEN', test: false },
  { role: 'STARS_DEDICATED_TEST', credential: 'POLAT_UAT_STARS_TEST_BOT_TOKEN', test: true },
]);
const configurationNames = Object.freeze([
  'OPENAI_API_KEY', 'OPENAI_UAT_ORGANIZATION_ID', 'OPENAI_UAT_PROJECT_ID',
  'POLAT_UAT_TELEGRAM_BOT_TOKEN', 'POLAT_UAT_TELEGRAM_WEBHOOK_SECRET', 'POLAT_UAT_RELAY_SECRET',
  'POLAT_UAT_TENANT_ID', 'POLAT_UAT_PROGRAM_ID',
  'POLAT_CAMPAIGN_TENANT_ID', 'POLAT_CAMPAIGN_ID', 'POLAT_CAMPAIGN_WEBHOOK_SECRET', 'POLAT_CAMPAIGN_RELAY_SECRET',
  'POLAT_STARS_MERCHANT_TENANT_ID', 'POLAT_STARS_MERCHANT_BOT_TOKEN', 'POLAT_STARS_MERCHANT_WEBHOOK_SECRET', 'POLAT_STARS_MERCHANT_RELAY_SECRET',
  'POLAT_UAT_STARS_TEST_BOT_TOKEN', 'POLAT_UAT_STARS_TEST_WEBHOOK_SECRET', 'POLAT_UAT_STARS_RELAY_SECRET',
]);
const errorCode = status => ({ 401: 'AUTHENTICATION_REJECTED', 403: 'ACCESS_REJECTED', 404: 'NOT_FOUND_OR_NOT_VISIBLE', 429: 'RATE_OR_ACCOUNT_LIMIT_RESPONSE' })[status] ?? 'PROVIDER_RESPONSE_REJECTED';

async function abortable(pending, signal) {
  if (signal.aborted) throw Error('METADATA_TIMEOUT');
  let onAbort;
  const stopped = new Promise((_resolve, reject) => { onAbort = () => reject(Error('METADATA_TIMEOUT')); signal.addEventListener('abort', onAbort, { once: true }); });
  try { return await Promise.race([pending, stopped]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

/** Fixed read-only Bot API methods only. No getUpdates/offset, webhook mutation,
 * message, invoice, membership, credential lookup or account-authority writer. */
async function telegramRead(token, test, method, request) {
  assert(['getMe', 'getWebhookInfo'].includes(method), 'READ_ONLY_METHOD_REQUIRED');
  const url = `https://api.telegram.org/bot${token}/${test ? 'test/' : ''}${method}`;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  let status = null;
  try {
    const response = await abortable(request(url, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' }, redirect: 'error', signal: controller.signal }), controller.signal);
    status = response.status;
    assert(!response.redirected && response.url === url, 'METADATA_ORIGIN_MISMATCH');
    if (status !== 200) { void response.body?.cancel().catch(() => undefined); return { state: 'BLOCKED', provider_status: status, reason: errorCode(status) }; }
    assert(/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') && response.body, 'METADATA_ENVELOPE_INVALID');
    const length = response.headers.get('content-length');
    assert(length === null || /^[0-9]{1,8}$/u.test(length) && Number(length) <= 16384, 'METADATA_RESPONSE_BOUND');
    const reader = response.body.getReader(), chunks = []; let bytes = 0, ended = false;
    try {
      for (let i = 0; i < 1024; i++) {
        const part = await abortable(reader.read(), controller.signal);
        if (part.done) { ended = true; break; }
        assert(part.value instanceof Uint8Array, 'METADATA_ENVELOPE_INVALID');
        bytes += part.value.byteLength; assert(bytes <= 16384, 'METADATA_RESPONSE_BOUND'); chunks.push(part.value);
      }
      assert(ended, 'METADATA_RESPONSE_BOUND');
    } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
    const envelope = parsePolatClaudeJson(raw, 16384);
    assert(envelope?.ok === true && envelope.result && typeof envelope.result === 'object' && !Array.isArray(envelope.result), 'METADATA_ENVELOPE_INVALID');
    return { state: 'OBSERVED', provider_status: status, source_hash: hash(raw), value: envelope.result };
  } catch (error) {
    const safeCodes = ['METADATA_TIMEOUT', 'METADATA_ORIGIN_MISMATCH', 'METADATA_ENVELOPE_INVALID', 'METADATA_RESPONSE_BOUND'];
    return { state: 'BLOCKED', provider_status: status, reason: controller.signal.aborted ? 'METADATA_TIMEOUT' : error instanceof Error && safeCodes.includes(error.message) ? error.message : 'METADATA_UNAVAILABLE_OR_INVALID' };
  } finally { clearTimeout(timer); controller.abort(); }
}

async function inspectBot(role, env, request) {
  const token = env[role.credential];
  const base = { role: role.role, api_environment: role.test ? 'TELEGRAM_DEDICATED_TEST' : 'TELEGRAM_PRODUCTION', credential_name: role.credential, metadata_requests: 0 };
  if (!token) return { ...base, state: 'NOT_CONFIGURED' };
  if (!/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,200}$/u.test(token)) return { ...base, state: 'BLOCKED', reason: 'CREDENTIAL_FORMAT_INVALID' };
  const me = await telegramRead(token, role.test, 'getMe', request);
  if (me.state !== 'OBSERVED') return { ...base, metadata_requests: 1, ...me };
  const bot = me.value;
  if (bot.is_bot !== true || !Number.isSafeInteger(bot.id) || bot.id <= 0 || String(bot.id) !== token.split(':')[0]
    || typeof bot.username !== 'string' || !/^[A-Za-z0-9_]{5,32}$/u.test(bot.username)
    || bot.can_connect_to_business !== undefined && typeof bot.can_connect_to_business !== 'boolean') {
    return { ...base, state: 'BLOCKED', metadata_requests: 1, provider_status: me.provider_status, reason: 'BOT_IDENTITY_MISMATCH' };
  }
  const identity = { bot_id: String(bot.id), bot_username: bot.username, secretary_capability: bot.can_connect_to_business ?? null, get_me_source_hash: me.source_hash };
  const hook = await telegramRead(token, role.test, 'getWebhookInfo', request);
  if (hook.state !== 'OBSERVED') return { ...base, ...identity, metadata_requests: 2, ...hook };
  const webhook = hook.value;
  if (typeof webhook.url !== 'string' || webhook.url.length > 2048 || !Number.isSafeInteger(webhook.pending_update_count) || webhook.pending_update_count < 0
    || webhook.allowed_updates !== undefined && (!Array.isArray(webhook.allowed_updates) || webhook.allowed_updates.length > 64 || !webhook.allowed_updates.every(v => typeof v === 'string' && /^[a-z_]{1,64}$/u.test(v)))) {
    return { ...base, ...identity, state: 'BLOCKED', metadata_requests: 2, provider_status: hook.provider_status, reason: 'WEBHOOK_METADATA_INVALID' };
  }
  // A provider's URL may contain a secret path/query. Return only known route
  // classification and a digest, never the URL, IP, diagnostic text or profile.
  const paths = new Map([
    ['/functions/v1/polat-campaign-ingress', 'CAMPAIGN'], ['/functions/v1/polat-private-beta-ingress', 'PRIVATE_BETA'],
    ['/functions/v1/polat-commerce-ingress', 'MERCHANT'], ['/functions/v1/polat-private-beta-stars-ingress', 'STARS_DEDICATED_TEST'],
  ]);
  let target = webhook.url === '' ? 'NOT_REGISTERED' : 'OTHER_EXISTING_WEBHOOK';
  if (webhook.url !== '') {
    try { const u = new URL(webhook.url); if (u.origin === 'https://xqvwkghpmezcpgugetqc.supabase.co' && !u.username && !u.password && !u.search && !u.hash) target = paths.get(u.pathname) ?? target; } catch { return { ...base, ...identity, state: 'BLOCKED', metadata_requests: 2, reason: 'WEBHOOK_METADATA_INVALID' }; }
  }
  return { ...base, ...identity, state: 'OBSERVED', metadata_requests: 2, provider_status: 200, webhook: { target, url_hash: hash(webhook.url), source_hash: hook.source_hash,
    pending_update_count: webhook.pending_update_count, allowed_updates: webhook.allowed_updates ?? null, error_present: webhook.last_error_date !== undefined || webhook.last_error_message !== undefined } };
}

/** An authenticated protected job may inspect existing custody BEFORE a beta
 * program/campaign exists. Observed metadata is never an execution grant. */
export async function observeProtectedIntegrationInventory({ env, request = fetch, now = Date.now }) {
  assert(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REPOSITORY === 'AlisanMedia/GOLD-REVENUE-OS-PRO'
    && env.GITHUB_REF === 'refs/heads/main' && /^[a-f0-9]{40}$/u.test(env.VALIDATED_SHA ?? '') && env.VALIDATED_SHA === env.GITHUB_SHA, 'PROTECTED_INVENTORY_SCOPE_REQUIRED');
  const observed = now(); assert(Number.isSafeInteger(observed) && observed > 0, 'PROTECTED_INVENTORY_CLOCK_REQUIRED');
  const [openai, bots] = await Promise.all([observeConfiguredOpenAIModel({ env, request, now }), Promise.all(roles.map(role => inspectBot(role, env, request)))]);
  const conflicts = [];
  for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
    const left = roles[i], right = roles[j], a = bots[i], b = bots[j];
    if (env[left.credential] && env[left.credential] === env[right.credential]
      || a.bot_id && b.bot_id && a.api_environment === b.api_environment && a.bot_id === b.bot_id) conflicts.push([left.role, right.role]);
  }
  return Object.freeze({ version: 1, mode: 'PROTECTED_READ_ONLY_INTEGRATION_INVENTORY', repository_sha: env.VALIDATED_SHA, observed_at: new Date(observed).toISOString(),
    configured_names: configurationNames.filter(name => typeof env[name] === 'string' && env[name].length > 0),
    missing_names: configurationNames.filter(name => typeof env[name] !== 'string' || env[name].length === 0), openai,
    openai_http_classification: openai.provider_status === 200 ? 'HTTP_OK_METADATA_ONLY' : openai.provider_status ? errorCode(openai.provider_status) : null, bots, bot_role_conflicts: conflicts,
    credential_access: 'PROTECTED_JOB_ONLY', genuine_execution_authority: 'BLOCKED', provider_account_authority: 'UNVERIFIED',
    webhook_mutations: 0, database_mutations: 0, actual_inference_requests: 0, telegram_messages: 0, payment_requests: 0,
    billing: 'UNKNOWN', financial_authority: 'NONE', commercial_pilot: 'NO_GO',
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert(process.argv.length === 2 && process.env.RUNNER_TEMP?.startsWith('/'), 'PROTECTED_INVENTORY_SCOPE_REQUIRED');
    const gate = JSON.parse(readFileSync(join(process.env.RUNNER_TEMP, 'private-beta-release-gate.json'), 'utf8'));
    assert(gate.sha === process.env.VALIDATED_SHA && gate.ruleset_id === 25348710 && gate.staging_reviewer === 'AlisanMedia' && gate.admins_bypass === false, 'PROTECTED_INVENTORY_GATE_REQUIRED');
    const result = await observeProtectedIntegrationInventory({ env: process.env });
    writeFileSync(join(process.env.RUNNER_TEMP, 'protected-integration-inventory.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    if (result.openai.state !== 'OBSERVED' || result.bots.some(bot => bot.state === 'BLOCKED') || result.bot_role_conflicts.length) {
      process.stderr.write('INTEGRATION_METADATA_BLOCKED: inspect redacted provider status evidence. No inference, webhook mutation or message.\n'); process.exitCode = 1;
    } else process.stdout.write('OBSERVED: existing model/bot metadata only; account, conversation, payment and delivery acceptance NOT established.\n');
  } catch {
    process.stderr.write('PROTECTED_INTEGRATION_INVENTORY_UNAVAILABLE (details suppressed).\n'); process.exitCode = 1;
  }
}
