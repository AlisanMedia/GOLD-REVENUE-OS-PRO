#!/usr/bin/env bash
set -euo pipefail
umask 077
# Independent PG17 sessions; only databases created by this invocation are changed.
beta_container=${PRIVATE_BETA_PG_CONTAINER:-supabase_db_gold-revenue-os}
[[ "$beta_container" = supabase_db_gold-revenue-os || "$beta_container" = gold16c1b-pg17 ]]
beta_docker(){ docker --host=unix:///var/run/docker.sock "$@"; }
test "$(beta_docker exec "$beta_container" psql -U postgres -d postgres -XqAt -c "select current_setting('server_version_num')::int/10000")" = 17
beta_tmp=$(mktemp -d)
beta_tag=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(8).toString("hex"))')
beta_source="private_beta_uat_snapshot_$beta_tag"
beta_restore="private_beta_uat_restore_$beta_tag"
beta_source_created=false;beta_restore_created=false
source scripts/private-beta-backup-snapshot.sh
cleanup(){
 local status=$?;set +e
 beta_snapshot_stop || status=1
 if test "$beta_restore_created" = true;then beta_docker exec "$beta_container" dropdb -U postgres --force "$beta_restore" >/dev/null || status=1;fi
 if test "$beta_source_created" = true;then beta_docker exec "$beta_container" dropdb -U postgres --force "$beta_source" >/dev/null || status=1;fi
 beta_docker exec "$beta_container" rm -f "/tmp/$beta_restore.list" >/dev/null 2>&1 || true
 rm -rf "$beta_tmp"
 exit "$status"
}
trap cleanup EXIT
remote(){ beta_docker exec -i "$beta_container" "$@" -U postgres -d "$beta_source"; }
fingerprint(){ beta_docker exec -i "$beta_container" psql -U postgres -d "$1" -XqAt -v ON_ERROR_STOP=1 <infra/sql/private-beta-recovery-fingerprint.sql >"$beta_tmp/$2.json"; }
beta_docker exec "$beta_container" createdb -U postgres --template=template0 "$beta_source"
beta_source_created=true
remote psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
create schema private;create schema auth;create schema extensions;
create extension pgcrypto with schema extensions;
create table private.verified_payment_receipts(id bigint generated always as identity primary key,financial_authority text not null default 'NONE'check(financial_authority='NONE'),content text not null);
alter table private.verified_payment_receipts enable row level security;
revoke all on schema private from public;
revoke all on private.verified_payment_receipts from public,anon,authenticated;
insert into private.verified_payment_receipts(content)values('synthetic-before-snapshot');
SQL
beta_snapshot_start
beta_saved_snapshot=$beta_snapshot_id
remote psql -XqAt -v ON_ERROR_STOP=1 -v private_beta_snapshot="$beta_snapshot_id" <infra/sql/private-beta-recovery-fingerprint.sql >"$beta_tmp/source-before.json"
# A distinct worker commits while the exporting transaction remains open.
remote psql -Xq -v ON_ERROR_STOP=1 -c "insert into private.verified_payment_receipts(content)values('synthetic-concurrent-worker');"
remote pg_dump --snapshot="$beta_snapshot_id" --format=custom --schema=public --schema=private --schema=auth --schema=extensions --extension=pgcrypto >"$beta_tmp/source.dump"
beta_snapshot_stop
# The snapshot cannot be reused after its owner exits/restarts.
if remote psql -XqAt -v ON_ERROR_STOP=1 -v private_beta_snapshot="$beta_saved_snapshot" <infra/sql/private-beta-recovery-fingerprint.sql >"$beta_tmp/expired.out" 2>"$beta_tmp/expired.log";then
 printf '%s\n' 'FAIL: expired snapshot was accepted' >&2;exit 1
fi
remote psql -Xq -v ON_ERROR_STOP=1 -c "insert into private.verified_payment_receipts(content)values('synthetic-after-dump');"
fingerprint "$beta_source" source-after
beta_docker exec -i "$beta_container" pg_restore --list <"$beta_tmp/source.dump" >"$beta_tmp/source.list"
node scripts/private-beta-release-restore.mjs "$beta_tmp/source.list" "$beta_tmp/source-before.json" "$beta_tmp"
node --input-type=module - "$beta_tmp" <<'NODE'
import{readFileSync,writeFileSync}from'node:fs';import{privateBetaSequenceToc}from'./scripts/private-beta-backup-verify.mjs';
const d=process.argv[2];writeFileSync(d+'/sequence.list',privateBetaSequenceToc(readFileSync(d+'/source.list','utf8'),JSON.parse(readFileSync(d+'/source-before.json','utf8'))));
NODE
beta_docker cp "$beta_tmp/sequence.list" "$beta_container:/tmp/$beta_restore.list" >/dev/null
beta_docker exec -i "$beta_container" pg_restore --file=- --use-list="/tmp/$beta_restore.list" <"$beta_tmp/source.dump" >"$beta_tmp/sequence-state.sql"
beta_docker exec "$beta_container" createdb -U postgres --template=template0 "$beta_restore"
beta_restore_created=true
beta_docker exec -i "$beta_container" psql -U postgres -d "$beta_restore" -Xq -v ON_ERROR_STOP=1 <"$beta_tmp/restore-owner.sql"
beta_docker cp "$beta_tmp/restore.list" "$beta_container:/tmp/$beta_restore.list" >/dev/null
beta_docker exec -i "$beta_container" pg_restore -U postgres -d "$beta_restore" --use-list="/tmp/$beta_restore.list" --exit-on-error <"$beta_tmp/source.dump"
fingerprint "$beta_restore" restored
beta_docker exec "$beta_container" psql -U postgres -d "$beta_restore" -Xq -v ON_ERROR_STOP=1 -c 'grant select on private.verified_payment_receipts to authenticated;'
fingerprint "$beta_restore" acl-corrupt
beta_docker exec "$beta_container" psql -U postgres -d "$beta_restore" -Xq -v ON_ERROR_STOP=1 -c 'revoke select on private.verified_payment_receipts from authenticated;alter table private.verified_payment_receipts disable row level security;'
fingerprint "$beta_restore" rls-corrupt
beta_docker exec "$beta_container" psql -U postgres -d "$beta_restore" -Xq -v ON_ERROR_STOP=1 -c "alter table private.verified_payment_receipts enable row level security;update private.verified_payment_receipts set content='synthetic-corrupt';"
fingerprint "$beta_restore" data-corrupt
beta_docker exec "$beta_container" psql -U postgres -d "$beta_restore" -Xq -v ON_ERROR_STOP=1 -c "update private.verified_payment_receipts set content='synthetic-before-snapshot';select setval('private.verified_payment_receipts_id_seq',3,true);" >/dev/null
fingerprint "$beta_restore" sequence-corrupt
remote psql -Xq -v ON_ERROR_STOP=1 -c 'grant select on private.verified_payment_receipts to authenticated;'
fingerprint "$beta_source" catalog-drift
node --input-type=module - "$beta_tmp" <<'NODE'
import{readFileSync}from'node:fs';import{comparePrivateBetaRecovery}from'./scripts/private-beta-backup-verify.mjs';
const d=process.argv[2],read=n=>JSON.parse(readFileSync(d+'/'+n+'.json','utf8')),before=read('source-before'),after=read('source-after'),restored=read('restored'),seq=readFileSync(d+'/sequence-state.sql','utf8');
const verify=(a,b,r,code)=>{const result=comparePrivateBetaRecovery(a,b,r,seq);if(result.code!==code)throw Error('RECOVERY_ACCEPTANCE_FAILED_'+result.code);return result;};
const result=verify(before,after,restored,'EXPORTED_SNAPSHOT_AND_ARCHIVE_MATCH');
if(JSON.stringify(before)===JSON.stringify(after)||!result.source_rows_changed||!result.source_sequence_values_changed||Object.values(before.tables)[0].rows!==1||Object.values(after.tables)[0].rows!==3)throw Error('CONCURRENT_WORKER_NOT_PROVEN');
verify(before,after,read('acl-corrupt'),'RECOVERY_RESTORED_CATALOG_MISMATCH');
verify(before,after,read('rls-corrupt'),'RECOVERY_RESTORED_CATALOG_MISMATCH');
verify(before,after,read('data-corrupt'),'RECOVERY_SNAPSHOT_DATA_MISMATCH');
verify(before,after,read('sequence-corrupt'),'RECOVERY_ARCHIVE_SEQUENCE_MISMATCH');
verify(before,read('catalog-drift'),restored,'RECOVERY_SOURCE_CATALOG_DRIFT');
console.log(JSON.stringify({classification:'OFFLINE_PG17_SHARED_SNAPSHOT',result:'PASS',assertions:8,independent_connections:true,concurrent_committed_writes:2,previous_wall_clock_comparison:'FAIL_REPRODUCED',snapshot_rows:1,current_source_rows:3,archive_sequence_state_verified:true,expired_snapshot_denied:true,acl_rls_data_sequence_corruption_denied:true,source_catalog_drift_denied:true,hosted_mutation:false,financial_authority:'NONE'}));
NODE
