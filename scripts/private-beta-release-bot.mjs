import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseFinancialJson } from '../packages/domain/src/financial-source-canonical.ts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const hash = /^[a-f0-9]{64}$/u;
const MANAGEMENT = 'https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query';
const INGRESS = 'https://xqvwkghpmezcpgugetqc.supabase.co/functions/v1/polat-private-beta-ingress';
const assert = (condition, code) => { if (!condition) throw Error(code); };
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');

async function jsonOnce(network, url, init, code) {
  // No automatic retry or redirect. Errors never reflect token-bearing URLs or provider bodies.
  let response;
  try { response = await network(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
  catch { throw Error(code); }
  if (!response.ok) { await response.body?.cancel(); throw Error(code); }
  assert(/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? ''), code);
  const reader = response.body?.getReader(); assert(reader, code);
  const chunks = []; let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    bytes += value.length; if (bytes > 16384) { await reader.cancel(); throw Error('BOT_CONTROL_RESPONSE_BOUND'); }
    chunks.push(value);
  }
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  return { raw, value: parseFinancialJson(raw) };
}
function ownedProgram(value, programId, sha) {
  assert(Array.isArray(value) && value.length === 1, 'OWNED_BOT_PROGRAM_REQUIRED');
  const p = value[0]?.private_beta_program;
  assert(p?.database_role === 'postgres' && p.program_id === programId && uuid.test(p.tenant_id ?? '') && p.repository_sha === sha && ['DRAFT', 'CANARY', 'FOUNDER', 'FRIENDS'].includes(p.stage)
    && hash.test(p.manifest_hash ?? '') && hash.test(p.authorization_record_hash ?? '') && /^[1-9][0-9]{0,18}$/u.test(p.generation ?? ''), 'OWNED_BOT_PROGRAM_REQUIRED');
  return p;
}
/** Protected-job control operation, not an application/public route. Network injection is for offline acceptance only. */
export async function verifyAndRecordPrivateBetaBot({ programId, sha, managementToken, botToken, network = fetch, now = Date.now }) {
  assert(uuid.test(programId ?? '') && /^[a-f0-9]{40}$/u.test(sha ?? ''), 'EXACT_BOT_PROGRAM_RELEASE_REQUIRED');
  assert(typeof managementToken === 'string' && managementToken.length >= 20 && typeof botToken === 'string' && /^[1-9][0-9]{4,18}:[A-Za-z0-9_-]{20,128}$/u.test(botToken), 'PROTECTED_BOT_CREDENTIALS_REQUIRED');
  const query = sql => jsonOnce(network, MANAGEMENT, { method: 'POST', headers: { authorization: 'Bearer ' + managementToken, 'content-type': 'application/json' }, body: JSON.stringify({ query: sql }) }, 'BOT_CONTROL_DATABASE_UNAVAILABLE');
  // Validated UUID is the only input in this fixed server-owned lookup; tenant cannot be selected by the caller.
  const read = "select jsonb_build_object('database_role',current_user,'program_id',p.id,'tenant_id',p.tenant_id,'repository_sha',p.configuration->>'repository_sha','stage',p.stage,'generation',p.generation::text,'manifest_hash',p.manifest_hash,'authorization_record_hash',p.authorization_record_hash) as private_beta_program from private.private_beta_programs p join public.tenants t on t.id=p.tenant_id where p.id='" + programId + "'::uuid and t.status='active' and t.slug like 'private-beta-%' and not t.outbound_messaging_enabled";
  const program = ownedProgram((await query(read)).value, programId, sha);
  const observed = await jsonOnce(network, 'https://api.telegram.org/bot' + botToken + '/getMe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, 'BOT_GET_ME_UNAVAILABLE');
  const envelope = observed.value, bot = envelope?.result;
  assert(envelope?.ok === true && bot?.is_bot === true && Number.isSafeInteger(bot.id) && bot.id > 0 && String(bot.id) === botToken.split(':')[0], 'BOT_NUMERIC_IDENTITY_UNVERIFIED');
  const at = now(); assert(Number.isFinite(at), 'BOT_CONTROL_TIME_INVALID');
  const proof = { version: 1, bot_id: String(bot.id), source_hash: digest(observed.raw), observed_at: new Date(at).toISOString(), api_environment: 'production', credential_sha256: digest(botToken) };
  // JSON is constructed from the real response, not supplied as an attestation input. Hex encoding prevents SQL quoting/injection.
  const encoded = Buffer.from(JSON.stringify(proof), 'utf8').toString('hex');
  const guardedWrite = "do $private_beta_bot$ begin perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('POLAT_UAT_BOT1:" + proof.bot_id + "',0)); perform 1 from private.private_beta_programs p join public.tenants t on t.id=p.tenant_id where p.id='" + programId + "'::uuid and p.tenant_id='" + program.tenant_id + "'::uuid and p.configuration->>'repository_sha'='" + sha + "' and p.manifest_hash='" + program.manifest_hash + "' and p.authorization_record_hash='" + program.authorization_record_hash + "' and p.generation=" + program.generation + " and p.stage in('DRAFT','CANARY','FOUNDER','FRIENDS') and t.status='active' and t.slug like 'private-beta-%' and not t.outbound_messaging_enabled and not exists(select 1 from public.messaging_provider_connections c where c.provider='telegram' and c.provider_account_ref='" + proof.bot_id + "' and c.tenant_id<>p.tenant_id) for update of p; if not found then raise exception 'PRIVATE_BETA_BOT_REVISION_CHANGED' using errcode='40001'; end if; perform private.private_beta_bot_control_record('" + program.tenant_id + "'::uuid,'" + programId + "'::uuid,convert_from(decode('" + encoded + "','hex'),'UTF8')); end $private_beta_bot$;";
  await query(guardedWrite);
  // Independent subsequent database read proves persistence, not merely a submitted form or echoed write response.
  const readback = (await query("select p.bot_control as bot_control from private.private_beta_programs p where p.id='" + programId + "'::uuid and p.tenant_id='" + program.tenant_id + "'::uuid and p.configuration->>'repository_sha'='" + sha + "' and p.manifest_hash='" + program.manifest_hash + "' and p.generation=" + program.generation)).value;
  assert(Array.isArray(readback) && readback.length === 1 && JSON.stringify(readback[0]?.bot_control && Object.fromEntries(Object.keys(proof).map(key => [key, readback[0].bot_control[key]]))) === JSON.stringify(proof), 'BOT_CONTROL_PERSISTENCE_UNVERIFIED');
  return Object.freeze({ version: 1, mode: 'PROTECTED_BOT_IDENTITY_CONTROL', repository_sha: sha, program_id: programId, tenant_id: program.tenant_id,
    bot_id: proof.bot_id, api_environment: 'production', source_hash: proof.source_hash, observed_at: proof.observed_at,
    database_readback_verified: true, webhook_registered: false, telegram_messages: 0, model_requests: 0, financial_authority: 'NONE', commercial_pilot: 'NO_GO' });
}
/** Pure future setWebhook payload; this is neither an execution grant nor a callable activation path. */
export function privateBetaBotWebhookRequest(secret) {
  assert(typeof secret === 'string' && /^[A-Za-z0-9_-]{32,256}$/u.test(secret), 'BOT_WEBHOOK_SECRET_INVALID');
  return Object.freeze({ url: INGRESS, secret_token: secret, allowed_updates: Object.freeze(['message']), max_connections: 1, drop_pending_updates: false });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const env = process.env;
    assert(process.argv.length === 2 && env.GITHUB_REPOSITORY === 'AlisanMedia/GOLD-REVENUE-OS-PRO' && env.GITHUB_REF === 'refs/heads/main' && env.VALIDATED_SHA === env.GITHUB_SHA && env.RUNNER_TEMP, 'PROTECTED_EXACT_BOT_JOB_REQUIRED');
    const result = await verifyAndRecordPrivateBetaBot({ programId: env.PRIVATE_BETA_PROGRAM_ID, sha: env.VALIDATED_SHA, managementToken: env.SUPABASE_ACCESS_TOKEN, botToken: env.POLAT_UAT_TELEGRAM_BOT_TOKEN });
    writeFileSync(env.RUNNER_TEMP + '/private-beta-bot-control.json', JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write('PASS: real getMe numeric bot identity persisted and independently read back. No webhook, message or model execution.\n');
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'BOT_CONTROL_UNAVAILABLE';
    if (process.env.RUNNER_TEMP) writeFileSync(process.env.RUNNER_TEMP + '/private-beta-bot-control.json', JSON.stringify({ version: 1, state: 'BLOCKED', code, webhook_registered: false, telegram_messages: 0, model_requests: 0, financial_authority: 'NONE', commercial_pilot: 'NO_GO' }, null, 2) + '\n', { mode: 0o600 });
    process.stderr.write('PRIVATE_BETA_BOT_CONTROL_BLOCKED: ' + code + '\n'); process.exitCode = 1;
  }
}
