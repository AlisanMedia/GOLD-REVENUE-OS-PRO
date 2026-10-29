#!/usr/bin/env bash
set -euo pipefail
umask 077
# Actual hosted read-only dump -> disposable PG17 restore -> encrypted recovery artifact.
# Does not migrate, restore or write hosted application data. Never prints dump/credentials.
test "${STAGING_SUPABASE_PROJECT_ID:-}" = xqvwkghpmezcpgugetqc
test "${GITHUB_REF:-}" = refs/heads/main
test "${GITHUB_REPOSITORY:-}" = AlisanMedia/GOLD-REVENUE-OS-PRO
test "${#STAGING_BACKUP_PASSPHRASE}" -ge 32
test -n "${STAGING_SUPABASE_SSL_ROOT_CERT:-}"
test -n "${SUPABASE_DB_PASSWORD:-}"
beta_container=supabase_db_gold-revenue-os
beta_tmp=$(mktemp -d)
beta_restore="beta_restore_$(node -e 'process.stdout.write(require("node:crypto").randomBytes(8).toString("hex"))')"
beta_created=false
beta_stage=local_pg17_check
beta_started=$(date +%s%N)
source scripts/private-beta-backup-snapshot.sh
cleanup(){
 local status=$?
 set +e
 beta_snapshot_stop || status=1
 if test "$beta_created" = true;then docker exec "$beta_container" dropdb -U supabase_admin --force "$beta_restore" >"$beta_tmp/cleanup.log" 2>&1 || status=1;fi
 if test "$status" != 0;then
  node --input-type=module - "$beta_tmp" "$beta_stage" "$status" <<'NODE'
import{readdirSync,statSync,writeFileSync}from'node:fs';import{spawnSync}from'node:child_process';
const dir=process.argv[2],stage=process.argv[3],status=Number(process.argv[4]);
const files=readdirSync(dir).filter(n=>/\.(?:json|log)$/u.test(n)&&statSync(dir+'/'+n).size<=2097152);
let encrypted=false;
if(files.length&&files.reduce((n,f)=>n+statSync(dir+'/'+f).size,0)<=16777216){
 const archive=dir+'/diagnostics.tar',tar=spawnSync('tar',['-C',dir,'-cf',archive,...files],{stdio:'ignore'});
 if(tar.status===0)encrypted=spawnSync(process.execPath,['scripts/private-beta-backup-crypto.mjs','encrypt',archive,process.env.RUNNER_TEMP+'/private-beta-backup-failure.enc'],{stdio:'ignore'}).status===0;
}
writeFileSync(process.env.RUNNER_TEMP+'/private-beta-backup-failure.json',JSON.stringify({stage,status,result:'FAIL',hosted_business_mutation:false,restore_accepted:false,raw_diagnostics:encrypted?'ENCRYPTED':'NOT_AVAILABLE',observed_at:new Date().toISOString()},null,2),{mode:0o600});
NODE
  printf '%s\n' "STAGING_BACKUP_FAILED stage=$beta_stage; sanitized metadata and available encrypted diagnostics retained; no hosted migration authorized by this result." >&2
 fi
 docker exec "$beta_container" rm -f /tmp/private-beta-source-ca.pem >/dev/null 2>&1 || true
 docker exec "$beta_container" rm -f "/tmp/$beta_restore.list" >/dev/null 2>&1 || true
 rm -rf "$beta_tmp"
 exit "$status"
}
trap cleanup EXIT
test "$(docker exec "$beta_container" psql -U postgres -d postgres -XqAt -c "select current_setting('server_version_num')::int/10000")" = 17
# Link metadata is non-authoritative until exact project/user/host are validated.
node --input-type=module <<'NODE'
import{readFileSync,writeFileSync}from'node:fs';
try{
const raw=readFileSync('supabase/.temp/pooler-url','utf8').trim(),u=new URL(raw),ref='xqvwkghpmezcpgugetqc';
if(!['postgres:','postgresql:'].includes(u.protocol)||u.password||u.pathname!=='/postgres'||!((u.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(u.username)==='postgres.'+ref)||(u.hostname==='db.'+ref+'.supabase.co'&&u.username==='postgres')))throw Error('EXACT_STAGING_DATABASE_REQUIRED');
const names={PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGDATABASE:'postgres'};
writeFileSync(process.env.RUNNER_TEMP+'/private-beta-pg-selector.json',JSON.stringify(names),{mode:0o600});
}catch{process.stderr.write('EXACT_STAGING_DATABASE_REQUIRED\n');process.exit(1);}
NODE
selector="${RUNNER_TEMP}/private-beta-pg-selector.json"
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD PGSSLMODE PGSSLROOTCERT PGCONNECT_TIMEOUT
PGHOST=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).PGHOST' "$selector")
PGPORT=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).PGPORT' "$selector")
PGUSER=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).PGUSER' "$selector")
PGDATABASE=postgres;PGPASSWORD=$SUPABASE_DB_PASSWORD;PGSSLMODE=verify-full;PGSSLROOTCERT=/tmp/private-beta-source-ca.pem;PGCONNECT_TIMEOUT=10
printf '%s' "$STAGING_SUPABASE_SSL_ROOT_CERT" >"$beta_tmp/source-ca.pem"
docker cp "$beta_tmp/source-ca.pem" "$beta_container:$PGSSLROOTCERT" >/dev/null
remote(){ docker exec -i -e PGHOST -e PGPORT -e PGUSER -e PGDATABASE -e PGPASSWORD -e PGSSLMODE -e PGSSLROOTCERT -e PGCONNECT_TIMEOUT "$beta_container" "$@"; }
beta_stage=source_exported_snapshot
beta_snapshot_start
beta_stage=source_tls_fingerprint
remote psql -XqAt -v ON_ERROR_STOP=1 -v private_beta_snapshot="$beta_snapshot_id" <infra/sql/private-beta-recovery-fingerprint.sql >"$beta_tmp/source-before.json" 2>"$beta_tmp/read.log"
beta_stage=source_atomic_dump
remote pg_dump --snapshot="$beta_snapshot_id" --format=custom --schema=public --schema=private --schema=auth --schema=extensions --extension=pgcrypto >"$beta_tmp/staging.dump" 2>"$beta_tmp/dump.log"
beta_snapshot_stop
beta_stage=source_drift_check
remote psql -XqAt -v ON_ERROR_STOP=1 <infra/sql/private-beta-recovery-fingerprint.sql >"$beta_tmp/source-after.json" 2>"$beta_tmp/read-after.log"
beta_stage=disposable_restore_create
docker exec -i "$beta_container" pg_restore --list <"$beta_tmp/staging.dump" >"$beta_tmp/source.list" 2>"$beta_tmp/list.log"
node scripts/private-beta-release-restore.mjs "$beta_tmp/source.list" "$beta_tmp/source-before.json" "$beta_tmp"
node --input-type=module - "$beta_tmp" <<'NODE'
import{readFileSync,writeFileSync}from'node:fs';import{privateBetaSequenceToc}from'./scripts/private-beta-backup-verify.mjs';
const dir=process.argv[2];writeFileSync(dir+'/sequence.list',privateBetaSequenceToc(readFileSync(dir+'/source.list','utf8'),JSON.parse(readFileSync(dir+'/source-before.json','utf8'))),{mode:0o600});
NODE
docker cp "$beta_tmp/sequence.list" "$beta_container:/tmp/$beta_restore.list" >/dev/null
docker exec -i "$beta_container" pg_restore --file=- --use-list="/tmp/$beta_restore.list" <"$beta_tmp/staging.dump" >"$beta_tmp/sequence-state.sql" 2>"$beta_tmp/sequence.log"
beta_source_owner=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).database_owner' "$beta_tmp/restore-plan.json")
docker exec "$beta_container" createdb -U supabase_admin --template=template0 --owner="$beta_source_owner" "$beta_restore" >"$beta_tmp/create.log" 2>&1
beta_created=true
docker exec -i "$beta_container" psql -U supabase_admin -d "$beta_restore" -Xq -v ON_ERROR_STOP=1 <"$beta_tmp/restore-owner.sql" >"$beta_tmp/schema-owner.log" 2>&1
docker cp "$beta_tmp/restore.list" "$beta_container:/tmp/$beta_restore.list" >/dev/null
beta_stage=disposable_restore
docker exec -i "$beta_container" pg_restore -U supabase_admin -d "$beta_restore" --use-list="/tmp/$beta_restore.list" --exit-on-error <"$beta_tmp/staging.dump" >"$beta_tmp/restore.log" 2>&1
docker exec "$beta_container" rm -f "/tmp/$beta_restore.list" >/dev/null
beta_stage=restored_fingerprint
docker exec -i "$beta_container" psql -U supabase_admin -d "$beta_restore" -XqAt -v ON_ERROR_STOP=1 <infra/sql/private-beta-recovery-fingerprint.sql >"$beta_tmp/restored.json" 2>"$beta_tmp/restored.log"
beta_stage=fingerprint_compare
node --input-type=module - "$beta_tmp" <<'NODE'
import{readFileSync,writeFileSync}from'node:fs';import{comparePrivateBetaRecovery}from'./scripts/private-beta-backup-verify.mjs';
const dir=process.argv[2],read=n=>JSON.parse(readFileSync(dir+'/'+n,'utf8').trim());
const a=read('source-before.json'),b=read('source-after.json'),r=read('restored.json');
const comparison=comparePrivateBetaRecovery(a,b,r,readFileSync(dir+'/sequence-state.sql','utf8'));
writeFileSync(process.env.RUNNER_TEMP+'/private-beta-backup-comparison.json',JSON.stringify(comparison,null,2)+'\n',{mode:0o600});
if(comparison.result!=='PASS')throw Error(comparison.code);
writeFileSync(process.env.RUNNER_TEMP+'/private-beta-backup-evidence.json',JSON.stringify({mode:'HOSTED_READ_ONLY_BACKUP_DISPOSABLE_RESTORE',source_project:'xqvwkghpmezcpgugetqc',sha:process.env.GITHUB_SHA,restore:'PASS',scope:['public','private','auth','extensions/pgcrypto'],exclusions:['Storage objects','Vault secrets','external provider state'],consistency:'EXPORTED_REPEATABLE_READ_SNAPSHOT',sequence_state:'EXACT_ARCHIVE_SETVAL_VERIFIED',source_progress_is_not_rollback:comparison.source_rows_changed||comparison.source_sequence_values_changed,fingerprint:r,hosted_migration_performed:false},null,2),{mode:0o600});
NODE
beta_stage=encrypted_recovery_custody
node scripts/private-beta-backup-crypto.mjs encrypt "$beta_tmp/staging.dump" "$RUNNER_TEMP/private-beta-staging.dump.enc"
node scripts/private-beta-backup-crypto.mjs verify "$RUNNER_TEMP/private-beta-staging.dump.enc" "$beta_tmp/staging.dump" >"$RUNNER_TEMP/private-beta-backup-encryption.json"
docker exec "$beta_container" rm -f "$PGSSLROOTCERT" >/dev/null
beta_elapsed=$((($(date +%s%N)-beta_started)/1000000))
PRIVATE_BETA_BACKUP_ELAPSED_MS="$beta_elapsed" node --input-type=module <<'NODE'
import{readFileSync,writeFileSync}from'node:fs';
const path=process.env.RUNNER_TEMP+'/private-beta-backup-evidence.json',value=JSON.parse(readFileSync(path,'utf8'));
value.observed_elapsed_ms=Number(process.env.PRIVATE_BETA_BACKUP_ELAPSED_MS);value.commercial_rpo_rto='NOT_ACCEPTED';writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
NODE
beta_stage=restore_cleanup
printf '%s\n' 'PASS: exact staging read-only backup; independent disposable PG17 restore/fingerprints; encrypted recoverable artifact. No hosted migration yet.'
