#!/usr/bin/env bash
set -euo pipefail
umask 077
# Offline logical recovery + read-load drill. Exact local PG17 containers only.
# No dump, credentials, row contents or lease tokens are emitted as artifacts.
e_db_url="${1:?LOCAL_DATABASE_REQUIRED}"
[[ "$e_db_url" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/(postgres|gold16c1b)$ ]] || { echo LOCAL_DATABASE_REQUIRED >&2;exit 1; }
e_container="${PHASE16DE_PG_CONTAINER:-supabase_db_gold-revenue-os}"
[[ "$e_container" = supabase_db_gold-revenue-os || "$e_container" = gold16c1b-pg17 ]] || { echo DISPOSABLE_CONTAINER_REQUIRED >&2;exit 1; }
e_source="${e_db_url##*/}";e_root="$(cd "$(dirname "$0")" && pwd)";e_tmp=$(mktemp -d)
e_restore="phase16e_restore_$(python3 -c 'import secrets;print(secrets.token_hex(8))')";e_created=false
e_exec(){ docker exec -i "$e_container" "$@"; }
e_sql(){ local db="$1";shift;e_exec psql -U postgres -d "$db" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
e_compare(){
 python3 - "$1" "$2" <<'PY'
import json,sys
a=json.load(open(sys.argv[1]));b=json.load(open(sys.argv[2]))
if a!=b:
    # Both inputs are explicitly sanitized aggregate/hash DTOs, never rows.
    print('RECOVERY_FINGERPRINT_MISMATCH',file=sys.stderr)
    for k in a.keys()|b.keys():
        if a.get(k)!=b.get(k):
            if isinstance(a.get(k),dict) and isinstance(b.get(k),dict):
                print('SANITIZED_DIFF_KEYS: '+k+' '+json.dumps([x for x in a[k].keys()|b[k].keys() if a[k].get(x)!=b[k].get(x)]),file=sys.stderr)
            else:print('SANITIZED_DIFF: '+k+' '+json.dumps([a.get(k),b.get(k)],sort_keys=True),file=sys.stderr)
    sys.exit(1)
PY
}
e_cleanup(){
 local status=$?
 if test "$e_created" = true;then
  e_exec sh -c 'rm -f /tmp/"$1"-read.sql /tmp/"$1"-load-*' sh "$e_restore" >/dev/null 2>&1 || true
  if ! e_exec dropdb -U postgres --force "$e_restore" >"$e_tmp/drop.log" 2>&1;then echo 'RESTORE_FIXTURE_CLEANUP_FAILED' >&2;status=1;fi
 fi
 rm -rf "$e_tmp"
 test "$status" = 0 || echo 'OFFLINE_RECOVERY_FAILED; inspect the sanitized CI checkpoint; no dump or source rows disclosed' >&2
 exit "$status"
}
trap e_cleanup EXIT
test "$(e_sql "$e_source" -c "select current_setting('server_version_num')::integer/10000")" = 17
# Supabase's postgres login deliberately cannot SET ROLE to protected Auth
# owners. Restore the NEW disposable copy with the already-existing local
# engine administrator instead; never grant roles or use --no-owner/--no-acl.
e_restore_role=postgres
if test "$(e_sql "$e_source" -c "select count(*) from pg_roles where rolname='supabase_admin' and rolsuper and rolcanlogin")" = 1;then
 e_restore_role=supabase_admin
fi
test "$(e_exec psql -U "$e_restore_role" -d "$e_source" -X -qAt -v ON_ERROR_STOP=1 -c "select rolsuper from pg_roles where rolname=current_user")" = t || { echo EXISTING_RESTORE_AUTHORITY_REQUIRED >&2;exit 1; }
test "$(e_sql "$e_source" -c "select count(*) from private.fse_namespaces where origin='SYNTHETIC' and provider_environment='FIXTURE'")" = 1
test "$(e_sql "$e_source" -c "select count(*) from private.fse_assessments")" -le 10000
test "$(e_sql "$e_source" -c "select count(*) from public.audit_logs")" -le 50000
test "$(e_sql "$e_source" -c "select count(*) from public.tenants where id='16de2000-0000-4000-8000-000000000001' and slug='phase11-sandbox-16de-a' and not outbound_messaging_enabled")" = 1
e_sql "$e_source" <"$e_root/phase16e_readiness_snapshot.sql" >"$e_tmp/before.json"
python3 - "$e_tmp/before.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
assert all(d[k]==0 for k in ['receipt_count','live_subscription_count','live_access_count','confirmed_payment_count'])
assert all(d[k] is False for k in ['runtime_writer_allowed','authenticated_raw_read','service_raw_write','fixture_outbound'])
assert d['all_claims_none'] is True and d['read_only_views'] is True
assert d['tables']['assessments']['rows']>=1000
PY
echo 'PASS E01: exact disposable PG17, bounded synthetic dataset and zero genuine financial authority'
e_started=$(date +%s%N)
# -n does not automatically include extension definitions. Explicitly retain
# pgcrypto, the accepted FSE SHA-256/check-constraint dependency.
e_exec pg_dump -U postgres -d "$e_source" --format=custom --schema=public --schema=private --schema=auth --schema=extensions --extension=pgcrypto >"$e_tmp/recovery.dump" 2>"$e_tmp/dump.log"
e_exec createdb -U postgres --template=template0 "$e_restore" >"$e_tmp/create.log" 2>&1;e_created=true
# template0 includes public; remove only that empty schema in the database this
# invocation just created. The source database is never dropped or reset.
e_sql "$e_restore" -c 'drop schema public;' >"$e_tmp/empty-schema.log" 2>&1
if ! e_exec pg_restore -U "$e_restore_role" -d "$e_restore" --exit-on-error <"$e_tmp/recovery.dump" >"$e_tmp/restore.log" 2>&1;then
 echo 'RESTORE_ERROR; supported-schema recovery did not complete' >&2
 # Error class only, never SQL text/data or raw dump.
 python3 - "$e_tmp/restore.log" <<'PY'
import re,sys
lines=open(sys.argv[1]).read().splitlines()
for line in [x for x in lines if 'error' in x.lower()][:2]:
    # Error header only. Quoted values/identifiers, URLs and subsequent
    # DETAIL/COPY/SQL bodies are intentionally excluded.
    safe=re.sub(r"'[^']*'|\"[^\"]*\"|https?://\S+",'<redacted>',line.split('DETAIL:')[0])
    print('RESTORE_CLASS: '+safe[:240],file=sys.stderr)
PY
 exit 1
fi
e_elapsed=$((($(date +%s%N)-e_started)/1000000))
e_sql "$e_restore" <"$e_root/phase16e_readiness_snapshot.sql" >"$e_tmp/restored.json"
e_compare "$e_tmp/before.json" "$e_tmp/restored.json"
echo "PASS E02: pg_dump/pg_restore to independent disposable DB; exact evidence/period/job/audit/security fingerprints; elapsed_ms=$e_elapsed dump_bytes=$(wc -c <"$e_tmp/recovery.dump")"

# Actual denial/immutability drills against the RESTORED disposable copy only.
e_deny(){
 local code="$1" statement="$2"
 if e_sql "$e_restore" -v VERBOSITY=sqlstate -c "$statement" >"$e_tmp/denial" 2>&1;then echo "SECURITY_DRILL_UNEXPECTED_SUCCESS: $code" >&2;exit 1;fi
 grep -q 42501 "$e_tmp/denial" || { echo "WRONG_DENIAL_CLASS: $code" >&2;exit 1; }
 echo "PASS $code: actual SQLSTATE42501; restored security boundary preserved"
}
e_deny E03 "begin;set local role authenticated;select count(*) from private.fse_observations;rollback;"
e_deny E04 "begin;set local role service_role;select private.record_financial_evidence_v1('{}','0000000000000000000000000000000000000000000000000000000000000000');rollback;"
e_deny E05 "update private.fse_observations set raw_hash=raw_hash where id=(select id from private.fse_observations limit 1);"
e_deny E06 "delete from public.entitlement_audit where tenant_id='16de2000-0000-4000-8000-000000000001';"
e_sql "$e_restore" <"$e_root/phase16e_readiness_snapshot.sql" >"$e_tmp/after-drills.json"
e_compare "$e_tmp/before.json" "$e_tmp/after-drills.json"

# Authorized public read wrapper with an actual authenticated fixture role;
# pgbench results are discarded, only local timing samples are retained briefly.
e_user=$(e_sql "$e_source" -c "select private.phase16c1b_id('user:2')")
e_tenant=$(e_sql "$e_source" -c "select private.phase16c1b_id('tenant:1')")
e_namespace=$(e_sql "$e_source" -c "select private.phase16c1b_id('namespace')")
cat >"$e_tmp/read.sql" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$e_user',true);
select 1/coalesce((jsonb_array_length(public.admin_financial_evidence_page_v1('$e_namespace','$e_tenant','assessments',null,null,25,null)->'items')=25)::integer,0);
commit;
SQL
e_remote="/tmp/$e_restore-read.sql"
e_exec sh -c 'umask 077;cat >"$1"' sh "$e_remote" <"$e_tmp/read.sql"
for e_clients in 1 4 8;do
 e_prefix="/tmp/$e_restore-load-$e_clients"
 e_exec pgbench -U postgres -d "$e_source" -n -c "$e_clients" -j 1 -t 25 -l --log-prefix="$e_prefix" -f "$e_remote" >"$e_tmp/load-$e_clients.log" 2>&1
 e_exec sh -c 'cat "$1".*;rm -f "$1".*' sh "$e_prefix" >"$e_tmp/timings"
 python3 - "$e_clients" "$e_tmp/timings" <<'PY'
import sys,json,math
clients=int(sys.argv[1]);rows=[x.split() for x in open(sys.argv[2]) if x.strip()];timings=sorted(int(x[2])/1000 for x in rows)
assert len(rows)==clients*25 and all(len(x)>=6 for x in rows)
print(json.dumps({'check':'E07','classification':'SYNTHETIC_READ_ONLY','clients':clients,'transactions':len(rows),'p50_ms':round(timings[math.ceil(len(rows)*.5)-1],3),'p95_ms':round(timings[math.ceil(len(rows)*.95)-1],3),'max_ms':round(max(timings),3),'production_capacity':'UNVERIFIED'}))
PY
done
e_exec rm -f "$e_remote"
e_sql "$e_source" <"$e_root/phase16e_readiness_snapshot.sql" >"$e_tmp/after-load.json"
e_compare "$e_tmp/before.json" "$e_tmp/after-load.json"
echo 'PASS E08: read-only load and drills preserved source; no provider/deployment; production backup, RPO/RTO/costs remain UNVERIFIED'
e_sql "$e_source" >"$e_tmp/disable.log" <<'SQL'
begin;
update private.fse_scopes set writes_enabled=false where namespace_id=private.phase16c1b_id('namespace');
update private.fse_namespaces set admission_enabled=false where id=private.phase16c1b_id('namespace');
update public.tenants set status='suspended' where id in (private.phase16c1b_id('tenant:1'),private.phase16c1b_id('tenant:2'),'16de2000-0000-4000-8000-000000000001','16de2000-0000-4000-8000-000000000002');
commit;
SQL
test "$(e_sql "$e_source" -c "select count(*) from private.fse_scopes where namespace_id=private.phase16c1b_id('namespace') and writes_enabled")" = 0
test "$(e_sql "$e_source" -c "select admission_enabled from private.fse_namespaces where id=private.phase16c1b_id('namespace')")" = f
test "$(e_sql "$e_source" -c "select count(*) from public.tenants where id in (private.phase16c1b_id('tenant:1'),private.phase16c1b_id('tenant:2'),'16de2000-0000-4000-8000-000000000001','16de2000-0000-4000-8000-000000000002') and (status='active' or outbound_messaging_enabled)")" = 0
echo 'PASS E09: only owned synthetic namespaces/scopes/tenants disabled; append-only evidence retained'
echo 'DEFERRED: genuine receipt/event/outbox atomicity; hosted restore/PITR; actual provider outage; live subscription/VIP; commercial pilot'
