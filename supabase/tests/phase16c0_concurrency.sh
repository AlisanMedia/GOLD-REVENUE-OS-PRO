#!/usr/bin/env bash
set -euo pipefail
# Reuses only the disposable Phase11 concurrency fixture. Never hosted staging.
bounded_db_url="$1"
case "$bounded_db_url" in postgresql://*@127.0.0.1:*/*) ;; *) echo 'LOCAL_DATABASE_REQUIRED' >&2; exit 1;; esac
bounded_tmp=$(mktemp -d)
bounded_writer_pid=''
bounded_cleanup() {
  bounded_status=$?
  if test "$bounded_status" -ne 0; then cat "$bounded_tmp/reader" "$bounded_tmp/writer" >&2 2>/dev/null || true; fi
  if test -n "$bounded_writer_pid"; then kill "$bounded_writer_pid" 2>/dev/null || true; fi
  rm -rf "$bounded_tmp"
}
trap bounded_cleanup EXIT
psql "$bounded_db_url" -v ON_ERROR_STOP=1 -q >"$bounded_tmp/setup" <<'SQL'
insert into public.entitlement_audit(tenant_id,subscription_id,action,mode,created_at)
select tenant_id,id,'retry','test',now()-interval '1 hour'+make_interval(secs=>n)
from public.subscriptions cross join generate_series(1,35)n where tenant_id='f3200000-0000-4000-8000-000000000001';
insert into public.entitlement_jobs(tenant_id,access_id,revision,operation,status)
select tenant_id,id,n+20,'reconcile','STALE' from public.channel_access cross join generate_series(1,35)n where tenant_id='f3200000-0000-4000-8000-000000000001';
SQL
# Writer holds an advisory barrier until the reader has captured its first pages.
psql "$bounded_db_url" -v ON_ERROR_STOP=1 -q >"$bounded_tmp/writer" 2>&1 <<SQL &
begin;
select pg_advisory_xact_lock(160160000);
\! touch '$bounded_tmp/writer-ready'
\! for n in \$(seq 1 100); do test -f '$bounded_tmp/reader-ready' && exit 0; sleep .05; done; exit 1
insert into public.entitlement_audit(id,tenant_id,subscription_id,action,mode,created_at)
select 'fc080000-0000-4000-8000-000000000001',tenant_id,id,'retry','test',clock_timestamp() from public.subscriptions where tenant_id='f3200000-0000-4000-8000-000000000001';
update public.entitlement_jobs set available_at=now()+interval '1 day',status='STALE' where tenant_id='f3200000-0000-4000-8000-000000000001';
commit;
SQL
bounded_writer_pid=$!
for bounded_attempt in $(seq 1 100); do test -f "$bounded_tmp/writer-ready" && break; sleep .05; done
test -f "$bounded_tmp/writer-ready"
psql "$bounded_db_url" -v ON_ERROR_STOP=1 -q >"$bounded_tmp/reader" 2>&1 <<SQL
begin;
create temp table bounded_expected(k text,ids uuid[]);
insert into bounded_expected select 'audit',array_agg(id order by id) from public.entitlement_audit where tenant_id='f3200000-0000-4000-8000-000000000001';
insert into bounded_expected select 'jobs',array_agg(id order by id) from public.entitlement_jobs where tenant_id='f3200000-0000-4000-8000-000000000001';
grant select on bounded_expected to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','f3100000-0000-4000-8000-000000000001',true);
create temp table bounded_first(k text,p jsonb);
insert into bounded_first select k,public.admin_entitlement_page_v1('f3200000-0000-4000-8000-000000000001',k,null,null,10) from unnest(array['audit','jobs'])k;
\! touch '$bounded_tmp/reader-ready'
select pg_advisory_xact_lock(160160000);
do \$\$declare collection_key text;p jsonb;cur jsonb;ids uuid[];expected uuid[];seen integer;begin
 foreach collection_key in array array['audit','jobs'] loop
  select f.p into p from bounded_first f where f.k=collection_key;ids:='{}';seen:=0;
  loop
   ids:=ids||array(select (x->>'id')::uuid from jsonb_array_elements(p->'items') x);seen:=seen+1;
   if p->>'has_more'='false' then exit;end if;
   if seen>20 then raise exception 'read pagination did not terminate';end if;
   cur:=p->'next_cursor';p:=public.admin_entitlement_page_v1('f3200000-0000-4000-8000-000000000001',collection_key,null,null,10,cur);
  end loop;
  select e.ids into expected from bounded_expected e where e.k=collection_key;
  if cardinality(ids)<>(select count(distinct x) from unnest(ids)x) or not expected<@ids then raise exception 'concurrent history loss or duplication: %',collection_key;end if;
 end loop;
 p:=public.admin_entitlement_page_v1('f3200000-0000-4000-8000-000000000001','audit',null,null,10);
 if p->'items'->0->>'id'<>'fc080000-0000-4000-8000-000000000001' then raise exception 'refresh must show concurrent inserted record';end if;
end\$\$;
rollback;
SQL
wait "$bounded_writer_pid"
bounded_writer_pid=''
echo 'PASS: two-connection insert/update barrier; immutable key order preserves prior evidence without duplicates; refresh shows the new audit.'
