import { writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseJeffClaudeJson } from '../packages/domain/src/jeff-claude-json.ts';

const database = 'https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
/** Bounded status polling during the SAME reviewed setup job. It never supplies
 * authentication claims, changes stage, invokes inference or retries a mutation. */
export async function waitForPrivateBetaFounder({ env, request = fetch, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const base = { version: 1, ready: false, state: 'OWNER_ACTION_REQUIRED', model_requests: 0, telegram_messages: 0, financial_authority: 'NONE' };
  try {
    const mode = env.FOUNDER_SETUP_WAIT;
    if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main'
      || env.GITHUB_REPOSITORY !== 'AlisanMedia/GOLD-REVENUE-OS-PRO' || !/^[a-f0-9]{40}$/u.test(env.VALIDATED_SHA ?? '') || env.GITHUB_SHA !== env.VALIDATED_SHA
      || !uuid.test(env.PRIVATE_BETA_PROGRAM_ID ?? '') || !['CANARY', 'BUSINESS'].includes(mode)
      || typeof env.SUPABASE_ACCESS_TOKEN !== 'string' || env.SUPABASE_ACCESS_TOKEN.length < 20 || /[\r\n\0]/u.test(env.SUPABASE_ACCESS_TOKEN)) throw Error('scope');
    const id = env.PRIVATE_BETA_PROGRAM_ID, sha = env.VALIDATED_SHA;
    const sql = "select jsonb_build_object('role',current_user,'stage',p.stage,'canary_ready',private.private_beta_founder_canary_hash(p) is not null,'recovery_available',(private.private_beta_recovery_available(p) or private.private_beta_continuation_available(p)) and p.founder_model_observation#>>'{observation,repository_sha}'='" + sha + "','local_scope',private.private_beta_founder_only(p),'release_matches',coalesce(p.configuration->>'repository_sha'='" + sha + "',false),'business_configured',exists(select 1 from private.private_beta_business_controls b where b.program_id=p.id and b.tenant_id=p.tenant_id and b.configured_by=p.owner_user_id),'held',exists(select 1 from private.jeff_experiment_runs r where r.id in(p.canary_run_id,p.conversation_run_id) and r.stop_reason is not null)) as setup from private.private_beta_programs p join public.tenants t on t.id=p.tenant_id where p.id='" + id + "'::uuid and t.status='active' and t.slug like 'private-beta-%' and not t.outbound_messaging_enabled";
    const attempts = mode === 'CANARY' ? 33 : 21;
    for (let index = 0; index < attempts; index++) {
      const response = await request(database, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ query: sql }) });
      if (![200, 201].includes(response.status) || response.redirected || response.url !== database || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') || !response.body) throw Error('read');
      const reader = response.body.getReader(), chunks = []; let bytes = 0, ended = false;
      try { for (let i = 0; i < 256; i++) { const part = await reader.read(); if (part.done) { ended = true; break; } bytes += part.value.byteLength; if (bytes > 16384) throw Error('bound'); chunks.push(part.value); } }
      finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
      if (!ended) throw Error('bound');
      const value = parseJeffClaudeJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))), row = Array.isArray(value) && value.length === 1 ? value[0]?.setup : null;
      if (!row || row.role !== 'postgres' || !['DRAFT', 'CANARY', 'FOUNDER', 'STOPPED'].includes(row.stage)
        || ['canary_ready', 'local_scope', 'release_matches', 'business_configured', 'held'].some(key => typeof row[key] !== 'boolean')) throw Error('shape');
      if (row.stage === 'STOPPED' || row.held && row.recovery_available !== true) return Object.freeze({ ...base, state: 'HELD' });
      if (row.stage === 'CANARY' && row.local_scope && row.release_matches && row.canary_ready && (mode === 'CANARY' || row.business_configured)) return Object.freeze({ ...base, ready: true, state: 'READY' });
      if (index < attempts - 1) await delay(15000);
    }
    return Object.freeze(base);
  } catch { return Object.freeze({ ...base, state: 'STATUS_READ_UNVERIFIED' }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await waitForPrivateBetaFounder({ env: process.env });
  if (!process.env.RUNNER_TEMP || !process.env.GITHUB_OUTPUT) process.exitCode = 1;
  else {
    writeFileSync(process.env.RUNNER_TEMP + '/private-beta-founder-wait-' + (process.env.FOUNDER_SETUP_WAIT === 'BUSINESS' ? 'business' : 'canary') + '.json', JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    appendFileSync(process.env.GITHUB_OUTPUT, 'ready=' + String(result.ready) + '\n');
    process.stdout.write('Founder setup: ' + result.state + '. No inference or messages performed by this status observer.\n');
    if (result.state === 'STATUS_READ_UNVERIFIED' || result.state === 'HELD') process.exitCode = 1;
  }
}
