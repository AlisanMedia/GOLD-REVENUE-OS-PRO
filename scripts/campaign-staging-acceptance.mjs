import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const digest = value => createHash('sha256').update(value).digest('hex');
export const CAMPAIGN_ACCEPTANCE = Object.freeze({ version: 1, assertions: 56, project: 'xqvwkghpmezcpgugetqc', migration: '20261029111003', migration_hash: '60978e77550fc8c8248440d5fdb17ffe769b4c1c68caddc4522988d79863d47a' });
/** Reuse the accepted matrix verbatim. Temporary assertion helpers replace pgTAP,
 * never its conditions. All fixture writes and helpers are rolled back. */
export function prepareCampaignStagingAcceptance(read = name => readFileSync(name, 'utf8')) {
  const sources = ['supabase/tests/campaign_activation.test.sql', 'supabase/tests/helpers/campaign_fixtures.sql', 'supabase/tests/helpers/polat_inbound_fixtures.sql'];
  const [matrix, fixtures, inbound] = sources.map(read);
  const migration = read('supabase/migrations/20261029111003_founder_campaign_activation.sql');
  if (digest(migration) !== CAMPAIGN_ACCEPTANCE.migration_hash || !matrix.startsWith('begin;\n') || !matrix.endsWith('rollback;\n')) throw Error('ACCEPTED_CAMPAIGN_SOURCE_DRIFT');
  if ((matrix.match(/^select (?:is|ok|throws_ok)\(/gmu) ?? []).length !== 56) throw Error('CAMPAIGN_ASSERTION_COUNT_DRIFT');
  const helpers = fixtures.replace('\\ir polat_inbound_fixtures.sql', () => inbound);
  const body = matrix.replace('\\ir helpers/campaign_fixtures.sql', () => helpers).replace('begin;\n', '')
    .replace('set local search_path=public,extensions;', 'set local search_path=pg_temp,public,extensions;')
    .replace('create extension if not exists pgtap with schema extensions;', '').replace(/rollback;\n$/u, '')
    .replace(/\bselect (is|ok|throws_ok|no_plan|finish)\(/gu, 'select pg_temp.$1(').replace('from finish()', 'from pg_temp.finish()');
  if (body.includes('\\ir ') || body.includes('create extension') || body.includes('$campaign_acceptance$')) throw Error('CAMPAIGN_FIXTURE_INCLUDES_INVALID');
  const reserved = "id in ('61b02000-0000-4000-8000-000000009901','61b02000-0000-4000-8000-000000009902','61b02000-0000-4000-8000-000000009903')";
  // The inner subtransaction also rolls back on success. Unexpected SQL errors
  // abort the entire connection; neither error nor disconnection can commit fixtures.
  const sql = `begin;
set local statement_timeout='60s';set local lock_timeout='3s';
create temporary table campaign_smoke_result(result jsonb);
do $outer$
declare passed integer:=0;begin
 if exists(select 1 from public.tenants where ${reserved}) then raise exception 'CAMPAIGN_FIXTURE_NAMESPACE_NOT_EMPTY';end if;
 if to_regprocedure('public.admin_campaign_workspace_v1(uuid,uuid)') is null then raise exception 'CAMPAIGN_MIGRATION_REQUIRED';end if;
 begin
 execute $campaign_acceptance$
create temporary table campaign_assertions(n integer not null);insert into campaign_assertions values(0);
grant select,update on campaign_assertions to authenticated,service_role;
create function pg_temp.no_plan()returns void language sql as 'select';
create function pg_temp.is(actual anyelement,expected anyelement,label text)returns text language plpgsql as $assert$
begin if actual is distinct from expected then raise exception 'CAMPAIGN_ASSERTION_FAILED: %',label;end if;
update pg_temp.campaign_assertions set n=n+1;return 'PASS';end;$assert$;
create function pg_temp.ok(actual boolean,label text)returns text language plpgsql as $assert$
begin if actual is distinct from true then raise exception 'CAMPAIGN_ASSERTION_FAILED: %',label;end if;
update pg_temp.campaign_assertions set n=n+1;return 'PASS';end;$assert$;
create function pg_temp.throws_ok(statement text,expected_code text,expected_message text,label text)returns text language plpgsql as $assert$
declare got_code text;got_message text;begin
begin execute statement;exception when others then get stacked diagnostics got_code=returned_sqlstate,got_message=message_text;end;
if got_code is distinct from expected_code or got_message is distinct from expected_message then raise exception 'CAMPAIGN_EXPECTED_DENIAL_MISSING: %',label;end if;
update pg_temp.campaign_assertions set n=n+1;return 'PASS';end;$assert$;
create function pg_temp.finish()returns setof text language sql as 'select ''ASSERTIONS_COMPLETE''::text';
${body}
$campaign_acceptance$;
 select n into passed from pg_temp.campaign_assertions;
 if passed<>56 then raise exception 'CAMPAIGN_ASSERTION_COUNT_MISMATCH';end if;
 raise exception using errcode='PCA01',message='ROLLBACK_CAMPAIGN_FIXTURE';
 exception when sqlstate 'PCA01' then
  if sqlerrm<>'ROLLBACK_CAMPAIGN_FIXTURE' then raise;end if;
 end;
 if passed<>56 or exists(select 1 from public.tenants where ${reserved}) then raise exception 'CAMPAIGN_ROLLBACK_UNVERIFIED';end if;
 insert into pg_temp.campaign_smoke_result values(jsonb_build_object('version',1,'result','PASS','assertions',passed,
 'fixture_rows_rolled_back',true,'authentication','SQL_FIXTURE_NOT_REAL_FOUNDER_LOGIN','real_model_calls',0,'real_customer_messages',0,'financial_authority','NONE'));
end;$outer$;
select result from pg_temp.campaign_smoke_result;
rollback;
`;
  return Object.freeze({ sql, manifest: { ...CAMPAIGN_ACCEPTANCE, sql_sha256: digest(sql), sources: sources.map((name, i) => ({ name, sha256: digest([matrix, fixtures, inbound][i]) })) } });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const prepared = prepareCampaignStagingAcceptance();
    if (process.argv.length === 3 && process.argv[2] === '--manifest') process.stdout.write(JSON.stringify(prepared.manifest, null, 2) + '\n');
    else if (process.argv.length === 2) process.stdout.write(prepared.sql);
    else throw Error('NO_ACCEPTANCE_OVERRIDE_FLAGS');
  } catch (error) { process.stderr.write((error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'CAMPAIGN_ACCEPTANCE_PREPARATION_FAILED') + '\n');process.exitCode=1; }
}
