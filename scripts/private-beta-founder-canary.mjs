import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { executePolatPrivateBetaCanary } from '../packages/domain/src/polat-private-beta-canary.ts';
import { createPolatPrivateBetaProvider, boundPolatPrivateBetaWireLiability } from '../packages/domain/src/polat-private-beta-provider.ts';
import { createPolatPrivateBetaNetworkAuthority, polatPrivateBetaBindingSchema, polatPrivateBetaAccountEvidenceSchema } from '../packages/domain/src/polat-experiment-execution-gate.ts';
import { parsePolatClaudeJson } from '../packages/domain/src/polat-claude-json.ts';

const DATABASE = 'https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const sha = /^[a-f0-9]{40}$/u;
const digest = v => createHash('sha256').update(v, 'utf8').digest('hex');
const assert = (condition, code) => { if (!condition) throw Error(code); };
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";

/** Existing native canary on a protected reviewed runner. No browser session,
 * TOTP, new MFA verification, customer message, bill or commercial authority is
 * manufactured. The initial authenticated owner grant and deadline stay intact. */
export async function runPrivateBetaProtectedCanary({ env, request = fetch, providerFactory = createPolatPrivateBetaProvider }) {
  const base = { version: 1, mode: 'PROTECTED_EXISTING_OWNER_CANARY_RECOVERY', state: 'BLOCKED',
    financial_authority: 'NONE', commercial_pilot: 'NO_GO', actual_billed_amount: null, provider_billing: 'UNKNOWN',
    automatic_retries: 0, telegram_messages: 0, original_unknown_preserved: 'NOT_YET_VERIFIED', owner_mfa_manufactured: false };
  let recovery = 'NOT_ATTEMPTED', journalAttempt = false;
  try {
    assert(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REPOSITORY === 'AlisanMedia/GOLD-REVENUE-OS-PRO'
      && env.GITHUB_REF === 'refs/heads/main' && sha.test(env.VALIDATED_SHA ?? '') && env.GITHUB_SHA === env.VALIDATED_SHA
      && /^[1-9][0-9]{0,20}$/u.test(env.GITHUB_RUN_ID ?? '') && env.AUTHORIZED_FOUNDER_RECOVERY === 'true'
      && uuid.test(env.PRIVATE_BETA_PROGRAM_ID ?? ''), 'PROTECTED_FOUNDER_EXECUTION_REQUIRED');
    assert(typeof env.SUPABASE_ACCESS_TOKEN === 'string' && /^[\x21-\x7e]{20,4096}$/u.test(env.SUPABASE_ACCESS_TOKEN), 'PROTECTED_DATABASE_CUSTODY_REQUIRED');
    const query = async sql => {
      let r;
      try { r = await request(DATABASE, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ query: sql }) }); }
      catch { throw Error('FOUNDER_CANARY_DATABASE_UNAVAILABLE'); }
      assert([200, 201].includes(r.status) && !r.redirected && r.url === DATABASE && /^application\/json(?:\s*;|$)/iu.test(r.headers.get('content-type') ?? '') && r.body, 'FOUNDER_CANARY_DATABASE_UNVERIFIED');
      const reader = r.body.getReader(), chunks = []; let bytes = 0, ended = false;
      try { for (let n = 0; n < 1024; n++) { const part = await reader.read(); if (part.done) { ended = true; break; } bytes += part.value.byteLength; assert(bytes <= 65536, 'FOUNDER_CANARY_DATABASE_BOUND'); chunks.push(part.value); } }
      finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      assert(ended, 'FOUNDER_CANARY_DATABASE_BOUND');
      let rows;
      try { rows = parsePolatClaudeJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)), 65536); }
      catch { throw Error('FOUNDER_CANARY_DATABASE_UNVERIFIED'); }
      assert(Array.isArray(rows) && rows.length === 1 && rows[0]?.database_role === 'postgres' && Object.hasOwn(rows[0], 'value'), 'FOUNDER_CANARY_DATABASE_ROLE_REQUIRED');
      return rows[0].value;
    };
    const p = env.PRIVATE_BETA_PROGRAM_ID, release = env.VALIDATED_SHA;
    const snapshotSql = "private.fse_hash(private.fse_canonical(jsonb_build_object('run',(select to_jsonb(r)from private.polat_experiment_runs r where r.id=coalesce((p.account_control->>'retained_unknown_run_id')::uuid,p.canary_run_id)),'attempts',(select jsonb_agg(to_jsonb(a)order by a.id)from private.polat_experiment_attempts a where a.run_id=coalesce((p.account_control->>'retained_unknown_run_id')::uuid,p.canary_run_id)),'evidence',(select jsonb_agg(to_jsonb(e)order by e.sequence)from private.polat_experiment_evidence e where e.run_id=coalesce((p.account_control->>'retained_unknown_run_id')::uuid,p.canary_run_id)))))";
    const authSql = "private.fse_hash(private.fse_canonical(jsonb_build_array(p.owner_user_id,p.approved_at,p.authenticated_at,(select count(*)from auth.mfa_factors f where f.user_id=p.owner_user_id and f.status='verified'))))";

    const program = await query("select current_user as database_role,jsonb_build_object('tenant_id',p.tenant_id,'stage',p.stage,'generation',p.generation::text,'request_count',p.request_count,'account_version',p.account_control->>'version','repository_sha',p.configuration->>'repository_sha','eligible',private.private_beta_recovery_available(p),'standing_owner',private.private_beta_standing_owner_valid(p),'canary_accepted',private.private_beta_founder_canary_hash(p)is not null,'retained_fingerprint'," + snapshotSql + ",'auth_fingerprint'," + authSql + ")as value from private.private_beta_programs p where p.id=" + literal(p) + '::uuid');
    assert(uuid.test(program?.tenant_id ?? '') && program.stage === 'CANARY' && program.standing_owner === true && /^[1-9][0-9]{0,17}$/u.test(program.generation ?? ''), 'REAL_STANDING_OWNER_GRANT_REQUIRED');
    const t = program.tenant_id, common = literal(t) + '::uuid,' + literal(p) + '::uuid';
    if (program.account_version === '4' && program.repository_sha === release && program.canary_accepted === true) return { ...base, state: 'ALREADY_ACCEPTED_NO_DISPATCH', original_unknown_preserved: 'NO_MUTATION_THIS_RUN', recovery_mutation: 'NOT_ATTEMPTED', initiated_attempts: 0 };
    if (program.account_version === '3' && program.eligible === true && program.request_count === 1) {
      recovery = 'UNVERIFIED';
      const receipt = await query('select current_user as database_role,private.private_beta_recover_founder_test(' + common + ',' + program.generation + ',' + literal(release) + ',' + literal('GITHUB_RUN:' + env.GITHUB_RUN_ID + ':' + release) + ')as value');
      assert(receipt?.program_id === p && receipt.stage === 'CANARY' && receipt.generation === String(BigInt(program.generation) + 1n), 'FOUNDER_CANARY_RECOVERY_ACK_UNKNOWN');
      recovery = 'ACKNOWLEDGED';
    } else assert(program.account_version === '4' && program.repository_sha === release && program.request_count === 1, 'FOUNDER_CANARY_RECOVERY_UNAVAILABLE');
    const scope = await query('select current_user as database_role,private.private_beta_protected_canary_scope(' + common + ',' + literal(release) + ')as value');
    assert(scope?.tenant_id === t && scope.program_id === p && scope.repository_sha === release && scope.owner_only === true && scope.provider === 'openai' && scope.model === 'gpt-6.1-sol', 'FOUNDER_CANARY_SCOPE_UNVERIFIED');
    const rpc = async (name, values = {}) => {
      const id = v => { assert(uuid.test(v ?? ''), 'FOUNDER_CANARY_NATIVE_ID_INVALID'); return literal(v) + '::uuid'; };
      const hash = v => { assert(/^[a-f0-9]{64}$/u.test(v ?? ''), 'FOUNDER_CANARY_NATIVE_HASH_INVALID'); return literal(v); };
      let args;
      if (name === 'private_beta_binding_v1') args = common + ",'CANARY'";
      else if (name === 'private_beta_owner_grant_v1' || name === 'private_beta_account_control_v1') args = common;
      else if (name === 'private_beta_committed_attempt_v1') args = common + ',' + id(values.attempt_id);
      else if (name === 'private_beta_reserve_v1') {
        assert(/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/u.test(values.liability ?? ''), 'FOUNDER_CANARY_NATIVE_LIABILITY_INVALID');
        args = [common, id(values.native_run_id), hash(values.request_hash), hash(values.body_hash), 'null', literal(values.liability), id(values.conversation_id)].join(',');
      } else if (name === 'private_beta_begin_v1') args = [common, id(values.attempt_id), id(values.dispatch_nonce)].join(',');
      else if (name === 'private_beta_record_v1') {
        const hex = Buffer.from(JSON.stringify(values.outcome), 'utf8').toString('hex');
        args = [common, id(values.attempt_id), id(values.dispatch_nonce), "convert_from(decode('" + hex + "','hex'),'UTF8')"].join(',');
      } else throw Error('FOUNDER_CANARY_NATIVE_RPC_DENIED');
      return query('select current_user as database_role,public.' + name + '(' + args + ')as value');
    };
    const binding = polatPrivateBetaBindingSchema.parse(await rpc('private_beta_binding_v1'));
    assert(binding.version === 4 && binding.repository_sha === release && binding.program_id === p && binding.tenant_id === t
      && binding.recovery_authority === 'PROTECTED_EXISTING_OWNER_GRANT', 'FOUNDER_CANARY_BINDING_UNVERIFIED');
    const nonce = new Map();
    const account = async wire => {
      const sealed = await rpc('private_beta_account_control_v1');
      const payload = polatPrivateBetaAccountEvidenceSchema.parse(sealed?.payload);
      if (wire) { const bound = boundPolatPrivateBetaWireLiability({ ...wire, maximum_input_tokens: binding.maximum_input_tokens }, sealed.pricing); payload.request_bound = { ...bound, valid_until: new Date(Math.min(Date.parse(bound.valid_until), Date.parse(payload.expires_at))).toISOString() }; }
      return payload;
    };
    const authority = createPolatPrivateBetaNetworkAuthority({ deployed_sha: release, readOwnerGrant: () => rpc('private_beta_owner_grant_v1'), readIndependentAccount: async (_id, wire) => ({ payload: await account(wire) }),
      readCommittedAttempt: async (_id, attemptId) => { const proof = await rpc('private_beta_committed_attempt_v1', { attempt_id: attemptId }); assert(proof?.dispatch_nonce === nonce.get(attemptId), 'FOUNDER_CANARY_OWNED_START_REQUIRED'); return proof; },
      resolveCredential: async scopeHash => { const sealed = await account(); const key = env.OPENAI_API_KEY;
        assert(binding.account_scope_hash === scopeHash && sealed.provider === 'openai' && sealed.credential_sha256 === digest(key ?? '') && typeof key === 'string' && /^[\x21-\x7e]{20,4096}$/u.test(key), 'FOUNDER_CANARY_CREDENTIAL_UNVERIFIED'); return key; } });
    const store = {
      reserve: async v => { assert(v.program_id === p && v.source_message_id === null, 'FOUNDER_CANARY_NATIVE_SCOPE_DENIED'); const value = await rpc('private_beta_reserve_v1', { ...v, liability: binding.maximum_attempt_liability }); journalAttempt = true; return value; },
      begin: async v => { const value = randomUUID(); nonce.set(v.attempt_id, value); return rpc('private_beta_begin_v1', { attempt_id: v.attempt_id, dispatch_nonce: value }); },
      record: async (v, outcome) => { const value = nonce.get(v.attempt_id); assert(value, 'FOUNDER_CANARY_OWNED_START_REQUIRED'); const receipt = await rpc('private_beta_record_v1', { attempt_id: v.attempt_id, dispatch_nonce: value, outcome }); assert(receipt?.recorded === true, 'FOUNDER_CANARY_JOURNAL_ACK_UNKNOWN'); },
    };
    const result = await executePolatPrivateBetaCanary(scope, async ({ assess }) => providerFactory({ binding, authority, store, assess }));
    const accepted = await query("select current_user as database_role,jsonb_build_object('accepted',private.private_beta_founder_canary_hash(p)is not null,'retained_fingerprint'," + snapshotSql + ",'auth_fingerprint'," + authSql + ")as value from private.private_beta_programs p where p.id=" + literal(p) + '::uuid and p.tenant_id=' + literal(t) + '::uuid');
    assert(result.qa === 'APPROVED' && result.status === 'CANARY_OWNER_TEST_PASSED' && accepted?.accepted === true && accepted.retained_fingerprint === program.retained_fingerprint && accepted.auth_fingerprint === program.auth_fingerprint, 'FOUNDER_CANARY_QUALITY_OR_READBACK_HELD');
    return { ...base, state: 'REAL_CANARY_QA_ACCEPTED', original_unknown_preserved: true, original_unknown_readback_hash: accepted.retained_fingerprint, existing_owner_auth_preserved: true, recovery_mutation: recovery, initiated_attempts: 1, actual_inference_requests: 1,
      repository_sha: release, model: result.model, attempt_id: result.attempt_id, request_id: result.request_id, provider_response_id: result.provider_response_id, input_tokens: result.input_tokens, output_tokens: result.output_tokens,
      response_hash: result.response_hash, elapsed_ms: result.elapsed_ms, qa: result.qa, independent_journal_readback: true };
  } catch (error) {
    const code = error instanceof Error && /^(?:FOUNDER_CANARY|PROTECTED_|REAL_STANDING_|OPENAI_UAT_|POLAT_UAT_)[A-Z0-9_]{1,100}$/u.test(error.message) ? error.message : 'FOUNDER_CANARY_REVIEW_REQUIRED';
    return { ...base, reason: code, recovery_mutation: recovery, initiated_attempts: journalAttempt ? 1 : 0 };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runPrivateBetaProtectedCanary({ env: process.env });
  if (!process.env.RUNNER_TEMP) process.exitCode = 1;
  else {
    writeFileSync(join(process.env.RUNNER_TEMP, 'private-beta-founder-canary.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write('Protected founder canary: ' + result.state + (result.reason ? ' (' + result.reason + ')' : '') + '\n');
    if (!['REAL_CANARY_QA_ACCEPTED', 'ALREADY_ACCEPTED_NO_DISPATCH'].includes(result.state)) process.exitCode = 1;
  }
}
