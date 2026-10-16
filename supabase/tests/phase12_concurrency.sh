#!/usr/bin/env bash
set -euo pipefail
phase12_db_url="$1"
phase12_tmp=$(mktemp -d)
trap 'rm -rf "$phase12_tmp"' EXIT
psql "$phase12_db_url" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into public.tenants(id,name,slug) values('c1220000-0000-4000-8000-000000000001','Phase12 concurrency','phase12-sandbox-concurrent');
select public.configure_phase12_escalation('c1220000-0000-4000-8000-000000000001',true,'synthetic-concurrency','12345','99999');
select public.ingest_telegram_message('c1220000-0000-4000-8000-000000000001','p12-concurrent-start','13000','13000','13000',null,'Test',null,'Hello',null,now());
SQL
for worker in a b; do
 psql "$phase12_db_url" -v ON_ERROR_STOP=1 -Atq >"$phase12_tmp/ingest-$worker" <<SQL &
select public.ingest_telegram_message('c1220000-0000-4000-8000-000000000001','p12-concurrent-$worker','1300$worker','13000','13000',null,'Test',null,'I want a refund',null,now());
SQL
done
wait
phase12_cases=$(psql "$phase12_db_url" -Atq -c "select count(*) from public.escalation_cases where tenant_id='c1220000-0000-4000-8000-000000000001'")
test "$phase12_cases" = "1"
for worker in a b; do
 psql "$phase12_db_url" -v ON_ERROR_STOP=1 -Atq >"$phase12_tmp/claim-$worker" <<'SQL' &
begin;
select case when public.escalation_claim_notification('c1220000-0000-4000-8000-000000000001') is null then 0 else 1 end;
select pg_sleep(1);
commit;
SQL
done
wait
phase12_claims=$(awk '/^[01]$/ {n+=$1} END {print n+0}' "$phase12_tmp/claim-a" "$phase12_tmp/claim-b")
test "$phase12_claims" = "1"
psql "$phase12_db_url" -v ON_ERROR_STOP=1 -Atq <<'SQL'
do $$begin
 if (select count(*) from public.escalation_evidence where tenant_id='c1220000-0000-4000-8000-000000000001')<>2 then raise exception 'evidence lost';end if;
 if not (select human_takeover and not automatic_replies_enabled from public.conversations where tenant_id='c1220000-0000-4000-8000-000000000001') then raise exception 'AI not paused';end if;
end;$$;
-- A crashed/expired notification sender is UNCERTAIN, never automatically sent twice.
update public.escalation_notifications set lease_until=now()-interval '1 second' where tenant_id='c1220000-0000-4000-8000-000000000001';
select public.escalation_claim_notification('c1220000-0000-4000-8000-000000000001');
do $$begin if (select status from public.escalation_notifications where tenant_id='c1220000-0000-4000-8000-000000000001')<>'UNCERTAIN' then raise exception 'uncertain send replayed';end if;end;$$;
SQL
echo 'PASS: concurrent source ingestion creates one case/two evidence rows; one notification lease; crashed sender held UNCERTAIN.'
