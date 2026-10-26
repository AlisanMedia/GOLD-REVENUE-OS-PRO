#!/usr/bin/env bash
set -euo pipefail
umask 077
# Actual disposable PG17 dump/restore. No hosted endpoint or credentials are accepted.
beta_local_container=${PRIVATE_BETA_PG_CONTAINER:-supabase_db_gold-revenue-os}
beta_local_source=${1:-postgres}
[[ "$beta_local_container" = supabase_db_gold-revenue-os || "$beta_local_container" = gold16c1b-pg17 ]]
[[ "$beta_local_source" = postgres || "$beta_local_source" = goldpolat_runtime_master_regress || "$beta_local_source" =~ ^private_beta_uat_[a-z0-9_]{1,40}$ ]]
beta_local_tmp=$(mktemp -d)
beta_local_restore="beta_release_test_$(node -e 'process.stdout.write(require("node:crypto").randomBytes(8).toString("hex"))')"
beta_local_created=false
beta_docker(){ docker --host=unix:///var/run/docker.sock "$@"; }
beta_restore_role=postgres
beta_cleanup(){
 local beta_exit=$?
 trap - EXIT
 if test "$beta_local_created" = true;then beta_docker exec "$beta_local_container" dropdb -U "$beta_restore_role" --force "$beta_local_restore" >/dev/null || beta_exit=1;fi
 beta_docker exec "$beta_local_container" rm -f "/tmp/$beta_local_restore.list" >/dev/null 2>&1 || true
 rm -rf "$beta_local_tmp"
 if test "$beta_exit" != 0;then printf '%s\n' 'FAIL PRIVATE_BETA_LOCAL_RECOVERY; no dump, row content or credential exposed' >&2;fi
 exit "$beta_exit"
}
trap beta_cleanup EXIT
test "$(beta_docker exec "$beta_local_container" psql -U postgres -d "$beta_local_source" -XqAt -c "select current_setting('server_version_num')::int/10000")" = 17
if test "$(beta_docker exec "$beta_local_container" psql -U postgres -d "$beta_local_source" -XqAt -c "select count(*)from pg_roles where rolname='supabase_admin'and rolsuper and rolcanlogin")" = 1;then beta_restore_role=supabase_admin;fi
beta_local_start=$(date +%s%N)
beta_docker exec -i "$beta_local_container" psql -U postgres -d "$beta_local_source" -XqAt -v ON_ERROR_STOP=1 <infra/sql/private-beta-recovery-fingerprint.sql >"$beta_local_tmp/before.json"
beta_docker exec "$beta_local_container" pg_dump -U postgres -d "$beta_local_source" --format=custom --schema=public --schema=private --schema=auth --schema=extensions --extension=pgcrypto >"$beta_local_tmp/source.dump"
beta_docker exec -i "$beta_local_container" pg_restore --list <"$beta_local_tmp/source.dump" >"$beta_local_tmp/source.list"
node scripts/private-beta-release-restore.mjs "$beta_local_tmp/source.list" "$beta_local_tmp/before.json" "$beta_local_tmp"
beta_local_owner=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).database_owner' "$beta_local_tmp/restore-plan.json")
beta_docker exec "$beta_local_container" createdb -U "$beta_restore_role" --owner="$beta_local_owner" --template=template0 "$beta_local_restore"
beta_local_created=true
beta_docker exec -i "$beta_local_container" psql -U "$beta_restore_role" -d "$beta_local_restore" -Xq -v ON_ERROR_STOP=1 <"$beta_local_tmp/restore-owner.sql"
beta_docker cp "$beta_local_tmp/restore.list" "$beta_local_container:/tmp/$beta_local_restore.list" >/dev/null
beta_docker exec -i "$beta_local_container" pg_restore -U "$beta_restore_role" -d "$beta_local_restore" --use-list="/tmp/$beta_local_restore.list" --exit-on-error <"$beta_local_tmp/source.dump"
beta_docker exec -i "$beta_local_container" psql -U "$beta_restore_role" -d "$beta_local_restore" -XqAt -v ON_ERROR_STOP=1 <infra/sql/private-beta-recovery-fingerprint.sql >"$beta_local_tmp/restored.json"
# Deliberately change ONLY the newly created restore copy, never the source.
beta_docker exec "$beta_local_container" psql -U "$beta_restore_role" -d "$beta_local_restore" -Xq -v ON_ERROR_STOP=1 -c 'grant select on private.verified_payment_receipts to authenticated;'
beta_docker exec -i "$beta_local_container" psql -U "$beta_restore_role" -d "$beta_local_restore" -XqAt -v ON_ERROR_STOP=1 <infra/sql/private-beta-recovery-fingerprint.sql >"$beta_local_tmp/changed.json"
beta_docker exec "$beta_local_container" psql -U "$beta_restore_role" -d "$beta_local_restore" -Xq -v ON_ERROR_STOP=1 -c 'revoke select on private.verified_payment_receipts from authenticated;'
beta_docker exec -i "$beta_local_container" psql -U "$beta_restore_role" -d "$beta_local_restore" -XqAt -v ON_ERROR_STOP=1 <infra/sql/private-beta-recovery-fingerprint.sql >"$beta_local_tmp/revoked.json"
beta_docker exec -i "$beta_local_container" psql -U postgres -d "$beta_local_source" -XqAt -v ON_ERROR_STOP=1 <infra/sql/private-beta-recovery-fingerprint.sql >"$beta_local_tmp/after.json"
beta_local_elapsed=$((($(date +%s%N)-beta_local_start)/1000000))
node --input-type=module - "$beta_local_tmp" "$beta_local_elapsed" <<'NODE'
import{readFileSync,statSync}from'node:fs';
const dir=process.argv[2],read=n=>JSON.parse(readFileSync(dir+'/'+n,'utf8'));
const before=read('before.json'),restored=read('restored.json'),changed=read('changed.json'),revoked=read('revoked.json'),after=read('after.json');
if(JSON.stringify(before)!==JSON.stringify(restored)||JSON.stringify(before)!==JSON.stringify(revoked)||JSON.stringify(before)!==JSON.stringify(after)||before.ownership_acl_hash===changed.ownership_acl_hash)throw Error('RECOVERY_SECURITY_FINGERPRINT_MISMATCH');
console.log(JSON.stringify({classification:'OFFLINE_LOGICAL_RECOVERY',result:'PASS',postgres_major:17,tables:Object.keys(before.tables).length,rows:Object.values(before.tables).reduce((n,t)=>n+t.rows,0),sequences:Object.keys(before.sequences).length,elapsed_ms:Number(process.argv[3]),dump_bytes:statSync(dir+'/source.dump').size,source_preserved:true,restore_copy_acl_mutation_detected:true,acl_entries_skipped:0,hosted_backup:'NOT_RUN',hosted_tls:'NOT_TESTED'}));
NODE
