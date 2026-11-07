#!/usr/bin/env bash
set -euo pipefail
umask 077
# Only a newly created disposable database; never hosted or an existing ledger.
jeff_container=${JEFF_IDENTITY_PG_CONTAINER:-supabase_db_gold-revenue-os}
[[ "$jeff_container" = supabase_db_gold-revenue-os || "$jeff_container" = jeff-identity-local ]]
jeff_db="jeff_identity_$(node -e 'process.stdout.write(require("node:crypto").randomBytes(8).toString("hex"))')"
jeff_tmp=$(mktemp -d)
jeff_created=false
jeff_docker(){ docker --host=unix:///var/run/docker.sock "$@"; }
jeff_sql(){ jeff_docker exec -i "$jeff_container" psql -U postgres -d "$jeff_db" -Xq -v ON_ERROR_STOP=1 "$@"; }
cleanup(){ local status=$?;set +e;if test "$status" != 0;then for log in "$jeff_tmp"/*.log;do sed -n '/ERROR:/p' "$log" >&2;done;fi;if test "$jeff_created" = true;then jeff_docker exec "$jeff_container" dropdb -U postgres --force "$jeff_db" >/dev/null || status=1;fi;rm -rf "$jeff_tmp";exit "$status"; }
trap cleanup EXIT
test "$(jeff_docker exec "$jeff_container" psql -U postgres -d postgres -XqAt -c "select current_setting('server_version_num')::int/10000")" = 17
jeff_docker exec "$jeff_container" createdb -U postgres --template=template0 "$jeff_db"
jeff_created=true
jeff_docker exec "$jeff_container" pg_dump -U postgres -d postgres --schema=auth --schema-only --no-owner --no-privileges >"$jeff_tmp/auth.sql"
jeff_sql -c 'create schema extensions;create extension pgcrypto with schema extensions;' >/dev/null
# The foundation migration creates this exact application trigger after its function.
sed -i '/^CREATE TRIGGER on_auth_user_created .* EXECUTE FUNCTION private.handle_new_auth_user();$/d' "$jeff_tmp/auth.sql"
jeff_sql <"$jeff_tmp/auth.sql" >"$jeff_tmp/auth.log" 2>&1
# Historical files remain byte-for-byte. Apply them once to the new fixture DB.
for jeff_migration in supabase/migrations/*.sql;do
 case "$jeff_migration" in *20261107091336_jeff_identity_namespace.sql) break;;esac
 jeff_sql <"$jeff_migration" >>"$jeff_tmp/schema.log" 2>&1
done
jeff_sql <supabase/tests/helpers/historical/identity_before.sql >"$jeff_tmp/seed.log" 2>&1
# A different numeric owner must roll back the WHOLE migration, including catalog renames.
jeff_sql -c "update public.tenant_members set user_id='9b001001-0000-4000-8000-000000006201'where tenant_id='a0a4bbf0-2246-4c36-95d1-3105e3557ffe';" >/dev/null
if jeff_sql <supabase/migrations/20261107091336_jeff_identity_namespace.sql >"$jeff_tmp/owner-denied.log" 2>&1;then echo 'IDENTITY_UNRELATED_OWNER_ACCEPTED' >&2;exit 1;fi
grep -q 'JEFF_IDENTITY_TENANT_OWNER_MISMATCH' "$jeff_tmp/owner-denied.log"
jeff_sql -c "do \$\$ begin if to_regclass('private.jeff_experiment_runs')is not null then raise exception 'IDENTITY_DENIAL_NOT_ATOMIC';end if;end;\$\$;" >/dev/null
jeff_sql -c "update public.tenant_members set user_id='9b001000-0000-4000-8000-000000006201'where tenant_id='a0a4bbf0-2246-4c36-95d1-3105e3557ffe';" >/dev/null
jeff_sql <supabase/migrations/20261107091336_jeff_identity_namespace.sql >"$jeff_tmp/migration.log" 2>&1
jeff_sql <supabase/tests/helpers/jeff_identity_after.sql
printf '%s\n' 'PASS: in-place catalog OIDs/ACL/RLS, two UNKNOWN attempts, full 4.6549184 reservation, immutable evidence, old RPC privileges and unrelated identity preserved.'
