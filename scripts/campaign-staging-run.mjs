import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { prepareCampaignStagingAcceptance } from './campaign-staging-acceptance.mjs';

const requireValue = (ok, code) => { if (!ok) throw Error(code); };
/** Same exact target and verify-full TLS rules as the accepted backup path.
 * No URL, password, SQL or container override is accepted from workflow inputs. */
export function campaignDatabaseSelector(raw) {
  try {
    const u = new URL(raw.trim()), ref = 'xqvwkghpmezcpgugetqc';
    requireValue(['postgres:', 'postgresql:'].includes(u.protocol) && !u.password && !u.search && !u.hash && u.pathname === '/postgres' && (!u.port || u.port === '5432') &&
      ((u.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(u.username) === 'postgres.' + ref) || (u.hostname === 'db.' + ref + '.supabase.co' && u.username === 'postgres')), 'EXACT_STAGING_DATABASE_REQUIRED');
    return Object.freeze({ PGHOST: u.hostname, PGPORT: '5432', PGUSER: decodeURIComponent(u.username), PGDATABASE: 'postgres' });
  } catch { throw Error('EXACT_STAGING_DATABASE_REQUIRED'); }
}
export function validateCampaignAcceptanceResult(raw) {
  let value;try { value = JSON.parse(raw.trim()); } catch { throw Error('CAMPAIGN_ACCEPTANCE_RESULT_INVALID'); }
  requireValue(value?.version === 1 && value.result === 'PASS' && value.assertions === 56 && value.fixture_rows_rolled_back === true &&
    value.authentication === 'SQL_FIXTURE_NOT_REAL_FOUNDER_LOGIN' && value.real_model_calls === 0 && value.real_customer_messages === 0 && value.financial_authority === 'NONE', 'CAMPAIGN_ACCEPTANCE_RESULT_INVALID');
  return value;
}
export function runCampaignStagingAcceptance(env = process.env) {
  const temp = mkdtempSync(join(tmpdir(), 'campaign-acceptance-'));let stage = 'PROTECTED_RUNNER', evidence;
  try {
    requireValue(env.GITHUB_REPOSITORY === 'AlisanMedia/GOLD-REVENUE-OS-PRO' && env.GITHUB_REF === 'refs/heads/main' && /^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? '') && env.VALIDATED_SHA === env.GITHUB_SHA && env.RUNNER_TEMP, 'PROTECTED_MAIN_REQUIRED');
    const gate = JSON.parse(readFileSync(join(env.RUNNER_TEMP, 'private-beta-release-gate.json'), 'utf8'));
    requireValue(gate.sha === env.GITHUB_SHA && gate.ruleset_id === 25348710 && gate.admins_bypass === false && gate.staging_reviewer === 'AlisanMedia', 'PROTECTED_GATE_EVIDENCE_REQUIRED');
    requireValue(env.SUPABASE_DB_PASSWORD && env.STAGING_SUPABASE_SSL_ROOT_CERT, 'PROTECTED_STAGING_DATABASE_FIELDS_REQUIRED');
    const selector = campaignDatabaseSelector(readFileSync('supabase/.temp/pooler-url', 'utf8'));
    const ca = join(temp, 'source-ca.pem');writeFileSync(ca, env.STAGING_SUPABASE_SSL_ROOT_CERT, { mode: 0o600 });
    const prepared = prepareCampaignStagingAcceptance();
    writeFileSync(join(env.RUNNER_TEMP, 'campaign-acceptance-manifest.json'), JSON.stringify(prepared.manifest, null, 2), { mode: 0o600 });
    const pg = { ...selector, PGPASSWORD: env.SUPABASE_DB_PASSWORD, PGSSLMODE: 'verify-full', PGSSLROOTCERT: '/run/staging-ca.pem', PGCONNECT_TIMEOUT: '10' };
    const dockerEnv = { PATH: env.PATH, ...pg }; // Never forward model, bot, GitHub or unrelated credentials.
    const psql = sql => {
      const result = spawnSync('docker', ['run', '--rm', '-i', '--network=host', '--mount', `type=bind,src=${ca},dst=/run/staging-ca.pem,readonly`, ...Object.keys(pg).flatMap(k => ['-e', k]), 'postgres:17.6-alpine', 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse'],
        { env: dockerEnv, input: sql, encoding: 'utf8', timeout: 180000, maxBuffer: 1048576 });
      requireValue(result.status === 0 && !result.error && !result.signal, 'CAMPAIGN_HOSTED_SQL_FAILED');
      return result.stdout;
    };
    stage = 'MIGRATION_AND_NAMESPACE';
    const before = JSON.parse(psql("select jsonb_build_object('pg',current_setting('server_version_num')::int/10000,'migration',exists(select 1 from supabase_migrations.schema_migrations where version='20261029111003'));"));
    requireValue(before.pg === 17 && before.migration === true, 'CAMPAIGN_STAGING_SCHEMA_REQUIRED');
    stage = 'ROLLBACK_MATRIX';
    const result = validateCampaignAcceptanceResult(psql(prepared.sql));
    evidence = { ...result, environment: 'HOSTED_ISOLATED_STAGING', sha: env.GITHUB_SHA, ...prepared.manifest, observed_at: new Date().toISOString(), founder_ui: 'NOT_TESTED', genuine_provider_acceptance: 'NOT_TESTED', deployment_performed: false, hosted_migration_performed: false };
    // Verify again in an independent connection, after the rollback connection exits.
    stage = 'INDEPENDENT_ROLLBACK_READBACK';
    requireValue(psql("select not exists(select 1 from public.tenants where id in ('61b02000-0000-4000-8000-000000009901','61b02000-0000-4000-8000-000000009902','61b02000-0000-4000-8000-000000009903')); ").trim() === 't', 'CAMPAIGN_ROLLBACK_UNVERIFIED');
    evidence.independent_rollback_verified = true;
    writeFileSync(join(env.RUNNER_TEMP, 'campaign-staging-acceptance.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
    return evidence;
  } catch {
    if (env.RUNNER_TEMP) writeFileSync(join(env.RUNNER_TEMP, 'campaign-staging-acceptance.json'), JSON.stringify({ result: 'FAIL', stage, sha: env.GITHUB_SHA, observed_at: new Date().toISOString(), hosted_acceptance: 'NOT_ACCEPTED', deployment_performed: false, hosted_migration_performed: false }), { mode: 0o600 });
    throw Error('CAMPAIGN_STAGING_ACCEPTANCE_FAILED_' + stage);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { requireValue(process.argv.length === 2, 'NO_ACCEPTANCE_OVERRIDE_FLAGS');runCampaignStagingAcceptance();process.stdout.write('PASS: 56 rollback-only campaign checks; real model/message/payment acceptance remains separate.\n'); }
  catch (error) { process.stderr.write((error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'CAMPAIGN_ACCEPTANCE_UNAVAILABLE') + '\n');process.exitCode=1; }
}
