import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseFinancialJson } from '../packages/domain/src/financial-source-canonical.ts';
import { privateBetaBusinessRightsSchema } from '../packages/contracts/src/private-beta-uat.ts';
import { parsePolatClaudeJson } from '../packages/domain/src/polat-claude-json.ts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const hash = /^[a-f0-9]{64}$/u;
const MANAGEMENT = 'https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query';
const INGRESS = 'https://xqvwkghpmezcpgugetqc.supabase.co/functions/v1/polat-private-beta-ingress';
const assert = (condition, code) => { if (!condition) throw Error(code); };
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');

async function jsonOnce(network, url, init, code, statusCodes = {}, parser = parseFinancialJson) {
  // No automatic retry or redirect. Errors never reflect token-bearing URLs or provider bodies.
  let response;
  try { response = await network(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
  catch { throw Error(code); }
  if (!response.ok) { await response.body?.cancel(); throw Error(statusCodes[response.status] ?? code); }
  assert(/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? ''), code);
  const reader = response.body?.getReader(); assert(reader, code);
  const chunks = []; let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    bytes += value.length; if (bytes > 16384) { await reader.cancel(); throw Error('BOT_CONTROL_RESPONSE_BOUND'); }
    chunks.push(value);
  }
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  return { raw, value: parser(raw) };
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
export function privateBetaBotWebhookRequest(secret, mode = 'BOT') {
  assert(typeof secret === 'string' && /^[A-Za-z0-9_-]{32,256}$/u.test(secret), 'BOT_WEBHOOK_SECRET_INVALID');
  assert(mode === 'BOT' || mode === 'BUSINESS', 'BOT_WEBHOOK_MODE_INVALID');
  return Object.freeze({ url: INGRESS, secret_token: secret, allowed_updates: Object.freeze(mode === 'BUSINESS' ? ['business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages'] : ['message']), max_connections: 1, drop_pending_updates: false });
}
function protectedBusinessInputs({ programId, sha, managementToken, botToken }) {
  assert(uuid.test(programId ?? '') && /^[a-f0-9]{40}$/u.test(sha ?? ''), 'EXACT_BOT_PROGRAM_RELEASE_REQUIRED');
  assert(typeof managementToken === 'string' && managementToken.length >= 20 && typeof botToken === 'string' && /^[1-9][0-9]{4,18}:[A-Za-z0-9_-]{20,128}$/u.test(botToken), 'PROTECTED_BOT_CREDENTIALS_REQUIRED');
}
async function businessProgram(input, network) {
  protectedBusinessInputs(input);
  const query = sql => jsonOnce(network, MANAGEMENT, { method: 'POST', headers: { authorization: 'Bearer ' + input.managementToken, 'content-type': 'application/json' }, body: JSON.stringify({ query: sql }) }, 'BOT_CONTROL_DATABASE_UNAVAILABLE');
  const read = "select jsonb_build_object('database_role',current_user,'program_id',p.id,'tenant_id',p.tenant_id,'repository_sha',p.configuration->>'repository_sha','stage',p.stage,'generation',p.generation::text,'manifest_hash',p.manifest_hash,'authorization_record_hash',p.authorization_record_hash,'bot_id',p.bot_control->>'bot_id','credential_sha256',p.bot_control->>'credential_sha256','has_participants',exists(select 1 from private.private_beta_participants a where a.program_id=p.id),'program_expires_at',p.configuration->>'expires_at') as private_beta_program from private.private_beta_programs p join public.tenants t on t.id=p.tenant_id where p.id='" + input.programId + "'::uuid and t.status='active' and t.slug like 'private-beta-%' and not t.outbound_messaging_enabled";
  const program = ownedProgram((await query(read)).value, input.programId, input.sha);
  assert(program.bot_id === input.botToken.split(':')[0] && program.credential_sha256 === digest(input.botToken), 'SEALED_BUSINESS_BOT_REQUIRED');
  const observed = await jsonOnce(network, 'https://api.telegram.org/bot' + input.botToken + '/getMe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, 'BOT_GET_ME_UNAVAILABLE');
  const bot = observed.value?.result;
  assert(observed.value?.ok === true && bot?.is_bot === true && Number.isSafeInteger(bot.id) && String(bot.id) === program.bot_id && bot.can_connect_to_business === true, 'BOT_SECRETARY_CAPABILITY_UNVERIFIED');
  return { program, query, botObservation: observed };
}

/**
 * Controlled new-bot discovery only. getUpdates has no offset/ack/drop; allowed_updates
 * may affect future subscriptions, so this is not a universal read-only operation.
 * A webhook conflict is BLOCKED and never leads to deleteWebhook or retry.
 */
export async function discoverPrivateBetaBusinessConnections(input) {
  const network = input.network ?? fetch, at = (input.now ?? Date.now)();
  const { program } = await businessProgram(input, network);
  assert(program.stage === 'DRAFT' && program.has_participants === false, 'NEW_DRAFT_BUSINESS_BOT_REQUIRED');
  const observed = await jsonOnce(network, 'https://api.telegram.org/bot' + input.botToken + '/getUpdates', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timeout: 0, limit: 10, allowed_updates: ['business_connection', 'business_message'] }),
  }, 'BUSINESS_DISCOVERY_UNAVAILABLE', { 409: 'BUSINESS_DISCOVERY_WEBHOOK_ACTIVE' }, parsePolatClaudeJson);
  assert(observed.value?.ok === true && Array.isArray(observed.value.result) && observed.value.result.length <= 10 && Number.isFinite(at), 'BUSINESS_DISCOVERY_INVALID');
  const candidates = new Map();
  for (const update of observed.value.result) {
    const c = update?.business_connection; if (!c) continue;
    assert(Number.isSafeInteger(update.update_id) && typeof c.id === 'string' && c.id.length >= 1 && c.id.length <= 160 && Number.isSafeInteger(c.user?.id) && c.user.id > 0 && c.user.is_bot === false && typeof c.is_enabled === 'boolean', 'BUSINESS_DISCOVERY_INVALID');
    const known = candidates.get(c.id);
    assert(!known || known.representative_user_id === String(c.user.id), 'BUSINESS_DISCOVERY_CONFLICT');
    candidates.set(c.id, { business_connection_id: c.id, representative_user_id: String(c.user.id), update_id: String(update.update_id), source_hash: digest(JSON.stringify(update)), founder_chat_ids: known?.founder_chat_ids ?? [] });
  }
  // Customer text/profile names are never retained. A voluntary private test
  // greeting supplies only candidate numeric IDs under an observed connection.
  for (const update of observed.value.result) {
    const m = update?.business_message, candidate = m && candidates.get(m.business_connection_id);
    if (!candidate || m.sender_business_bot || m.from?.is_bot !== false || !Number.isSafeInteger(m.from?.id) || m.from.id <= 0 || m.chat?.type !== 'private' || !Number.isSafeInteger(m.chat?.id) || m.chat.id !== m.from.id || String(m.from.id) === candidate.representative_user_id) continue;
    assert(Number.isSafeInteger(update.update_id), 'BUSINESS_DISCOVERY_INVALID');
    const chat = String(m.chat.id); if (!candidate.founder_chat_ids.includes(chat)) candidate.founder_chat_ids.push(chat);
    assert(candidate.founder_chat_ids.length <= 10, 'BUSINESS_DISCOVERY_BOUND');
  }
  const programExpiry = Date.parse(program.program_expires_at), expiry = Number.isFinite(programExpiry) ? Math.min(at + 300000, programExpiry) : at + 300000;
  assert(expiry > at, 'BUSINESS_DISCOVERY_WINDOW_EXPIRED');
  return Object.freeze({ version: 1, mode: 'PROTECTED_BUSINESS_CANDIDATE_DISCOVERY', state: candidates.size ? 'CANDIDATE_ONLY' : 'NO_CANDIDATE', repository_sha: input.sha, program_id: input.programId, tenant_id: program.tenant_id, bot_id: program.bot_id,
    candidates: Object.freeze([...candidates.values()]), program_generation: program.generation, credential_sha256: digest(input.botToken), source_hash: digest(observed.raw), observed_at: new Date(at).toISOString(), expires_at: new Date(expiry).toISOString(), database_mutations: 0, connection_authority: 'NONE', webhook_registered: false, telegram_messages: 0, model_requests: 0, financial_authority: 'NONE', commercial_pilot: 'NO_GO' });
}

/**
 * Raw candidate IDs are private operational data. This protected wrapper stores
 * them only in the owner-MFA database read model and returns a public-safe summary.
 * Neither the raw helper result nor the encoded DB command may be logged/uploaded.
 */
export async function discoverAndRecordPrivateBetaBusinessConnections(input) {
  const observed = await discoverPrivateBetaBusinessConnections(input), network = input.network ?? fetch;
  const payload = { version: 1, program_id: observed.program_id, tenant_id: observed.tenant_id, repository_sha: observed.repository_sha, program_generation: observed.program_generation, bot_id: observed.bot_id,
    credential_sha256: observed.credential_sha256, source_hash: observed.source_hash, observed_at: observed.observed_at, expires_at: observed.expires_at, candidates: observed.candidates };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('hex');
  const query = sql => jsonOnce(network, MANAGEMENT, { method: 'POST', headers: { authorization: 'Bearer ' + input.managementToken, 'content-type': 'application/json' }, body: JSON.stringify({ query: sql }) }, 'BUSINESS_DISCOVERY_DATABASE_UNAVAILABLE');
  await query("select private.private_beta_business_discovery_record('" + observed.tenant_id + "'::uuid,'" + observed.program_id + "'::uuid," + observed.program_generation + ",convert_from(decode('" + encoded + "','hex'),'UTF8'))");
  const checked = await query("select jsonb_build_object('source_hash',p.business_discovery->>'source_hash','candidate_count',jsonb_array_length(p.business_discovery->'candidates'),'program_generation',p.generation::text) as business_discovery_summary from private.private_beta_programs p where p.id='" + observed.program_id + "'::uuid and p.tenant_id='" + observed.tenant_id + "'::uuid and p.configuration->>'repository_sha'='" + observed.repository_sha + "' and p.generation=" + observed.program_generation);
  const row = Array.isArray(checked.value) && checked.value.length === 1 ? checked.value[0]?.business_discovery_summary : null;
  assert(row?.source_hash === observed.source_hash && row?.candidate_count === observed.candidates.length && row?.program_generation === observed.program_generation, 'BUSINESS_DISCOVERY_PERSISTENCE_UNVERIFIED');
  return Object.freeze({ version: 1, mode: 'PROTECTED_BUSINESS_DISCOVERY_SUMMARY', state: observed.state, repository_sha: observed.repository_sha, program_id: observed.program_id, tenant_id: observed.tenant_id, bot_id: observed.bot_id,
    candidate_count: observed.candidates.length, founder_chat_candidate_count: new Set(observed.candidates.flatMap(candidate => candidate.founder_chat_ids)).size, source_hash: observed.source_hash,
    observed_at: observed.observed_at, expires_at: observed.expires_at, database_readback_verified: true, connection_authority: 'NONE', webhook_registered: false, telegram_messages: 0, model_requests: 0, financial_authority: 'NONE', commercial_pilot: 'NO_GO' });
}

/** Independent getMe/getBusinessConnection proof, not a callback/JSON approval. */
export async function verifyAndRecordPrivateBetaBusiness(input) {
  const network = input.network ?? fetch, now = input.now ?? Date.now;
  const { program, query, botObservation } = await businessProgram(input, network);
  const seedRead = await query("select private.private_beta_business_control_seed('" + program.tenant_id + "'::uuid,'" + input.programId + "'::uuid) as business_seed");
  const seed = Array.isArray(seedRead.value) && seedRead.value.length === 1 ? seedRead.value[0]?.business_seed : null;
  assert(seed?.version === 1 && seed.program_id === input.programId && seed.tenant_id === program.tenant_id && seed.bot_id === program.bot_id && seed.credential_sha256 === digest(input.botToken) && seed.repository_sha === input.sha
    && typeof seed.business_connection_id === 'string' && seed.business_connection_id.length >= 1 && seed.business_connection_id.length <= 160 && /^[1-9][0-9]{0,15}$/u.test(seed.representative_user_id ?? '') && /^[1-9][0-9]{0,15}$/u.test(seed.founder_chat_id ?? '') && /^[1-9][0-9]{0,18}$/u.test(seed.business_generation ?? ''), 'MFA_BUSINESS_BINDING_REQUIRED');
  const observed = await jsonOnce(network, 'https://api.telegram.org/bot' + input.botToken + '/getBusinessConnection', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ business_connection_id: seed.business_connection_id }) }, 'BUSINESS_CONNECTION_READ_UNAVAILABLE');
  const c = observed.value?.result, at = now(), expires = Date.parse(seed.expires_at);
  const rights = privateBetaBusinessRightsSchema.safeParse(c?.rights);
  assert(observed.value?.ok === true && c?.id === seed.business_connection_id && c.is_enabled === true && rights.success && Number.isSafeInteger(c.user?.id) && String(c.user.id) === seed.representative_user_id && c.user.is_bot === false && Number.isFinite(at) && Number.isFinite(expires) && expires > at, 'BUSINESS_CONNECTION_UNVERIFIED');
  const proof = { version: 1, origin: 'INDEPENDENT_TELEGRAM_BUSINESS_READ', bot_id: program.bot_id, credential_sha256: digest(input.botToken), repository_sha: input.sha,
    business_connection_id: seed.business_connection_id, representative_user_id: seed.representative_user_id, expected_generation: seed.business_generation, enabled: true, can_reply: true,
    source_hash: digest(JSON.stringify(['POLAT_BUSINESS_READ1', digest(botObservation.raw), digest(observed.raw)])), observed_at: new Date(at).toISOString(), expires_at: new Date(expires).toISOString() };
  const encoded = Buffer.from(JSON.stringify(proof), 'utf8').toString('hex');
  await query("select private.private_beta_business_control_record('" + program.tenant_id + "'::uuid,'" + input.programId + "'::uuid,convert_from(decode('" + encoded + "','hex'),'UTF8'))");
  const readback = await query("select public.private_beta_transport_config_v1('" + program.tenant_id + "'::uuid,'" + input.programId + "'::uuid) as business_scope");
  const scope = Array.isArray(readback.value) && readback.value.length === 1 ? readback.value[0]?.business_scope : null;
  assert(scope?.version === 2 && scope.mode === 'BUSINESS' && scope.tenant_id === program.tenant_id && scope.program_id === input.programId && scope.bot_id === program.bot_id && scope.credential_sha256 === proof.credential_sha256 && scope.repository_sha === input.sha
    && scope.business_connection_id === seed.business_connection_id && scope.representative_user_id === seed.representative_user_id && scope.founder_chat_id === seed.founder_chat_id && scope.business_generation === String(BigInt(seed.business_generation) + 1n)
    && scope.enabled === true && scope.can_reply === true && Date.parse(scope.observed_at) === at && Date.parse(scope.expires_at) === expires, 'BUSINESS_CONTROL_PERSISTENCE_UNVERIFIED');
  return Object.freeze({ version: 1, mode: 'PROTECTED_BUSINESS_IDENTITY_CONTROL', repository_sha: input.sha, program_id: input.programId, tenant_id: program.tenant_id, bot_id: program.bot_id,
    connection_identity_hash: digest(seed.business_connection_id), representative_identity_verified: true, founder_chat_scoped: true, observed_at: proof.observed_at, expires_at: proof.expires_at,
    database_readback_verified: true, webhook_registered: false, telegram_messages: 0, model_requests: 0, financial_authority: 'NONE', commercial_pilot: 'NO_GO' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const env = process.env;
    assert(process.argv.length === 2 && env.GITHUB_REPOSITORY === 'AlisanMedia/GOLD-REVENUE-OS-PRO' && env.GITHUB_REF === 'refs/heads/main' && env.VALIDATED_SHA === env.GITHUB_SHA && env.RUNNER_TEMP, 'PROTECTED_EXACT_BOT_JOB_REQUIRED');
    const operation = env.PRIVATE_BETA_BOT_OPERATION ?? 'verify_bot';
    assert(['verify_bot', 'verify_business', 'discover_business'].includes(operation), 'PROTECTED_BOT_OPERATION_REQUIRED');
    const input = { programId: env.PRIVATE_BETA_PROGRAM_ID, sha: env.VALIDATED_SHA, managementToken: env.SUPABASE_ACCESS_TOKEN, botToken: env.POLAT_UAT_TELEGRAM_BOT_TOKEN };
    const result = operation === 'verify_business' ? await verifyAndRecordPrivateBetaBusiness(input) : operation === 'discover_business' ? await discoverAndRecordPrivateBetaBusinessConnections(input) : await verifyAndRecordPrivateBetaBot(input);
    writeFileSync(env.RUNNER_TEMP + '/private-beta-bot-control.json', JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write('PASS: protected bot control operation completed with explicit evidence classification. No webhook, message or model execution.\n');
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'BOT_CONTROL_UNAVAILABLE';
    if (process.env.RUNNER_TEMP) writeFileSync(process.env.RUNNER_TEMP + '/private-beta-bot-control.json', JSON.stringify({ version: 1, state: 'BLOCKED', code, webhook_registered: false, telegram_messages: 0, model_requests: 0, financial_authority: 'NONE', commercial_pilot: 'NO_GO' }, null, 2) + '\n', { mode: 0o600 });
    process.stderr.write('PRIVATE_BETA_BOT_CONTROL_BLOCKED: ' + code + '\n'); process.exitCode = 1;
  }
}
