#!/usr/bin/env bash
set -euo pipefail

database_url="${1:?database URL is required}"
tenant_id="72000000-0000-0000-0000-000000000001"
customer_id="73000000-0000-0000-0000-000000000001"

psql "$database_url" --set ON_ERROR_STOP=1 <<SQL
insert into public.tenants (id, name, slug)
values ('$tenant_id', 'Concurrency Tenant', 'phase3-concurrency')
on conflict (id) do nothing;
insert into public.customers (id, tenant_id, display_name)
values ('$customer_id', '$tenant_id', 'Concurrent Customer')
on conflict (id) do nothing;
SQL

first_result="$(mktemp)"
second_result="$(mktemp)"
trap 'rm -f "$first_result" "$second_result"' EXIT

psql "$database_url" --set ON_ERROR_STOP=1 --tuples-only --no-align --command "
select public.transition_customer_state(
  '$tenant_id', '$customer_id', 'NEW', 'CONTACT_READY', 'concurrent_test',
  'SYSTEM', null, '74000000-0000-0000-0000-000000000001', null,
  'operator.requested', null, 'concurrency-1', now()
)->>'result';" >"$first_result" &
first_pid=$!

psql "$database_url" --set ON_ERROR_STOP=1 --tuples-only --no-align --command "
select public.transition_customer_state(
  '$tenant_id', '$customer_id', 'NEW', 'CONTACT_READY', 'concurrent_test',
  'SYSTEM', null, '74000000-0000-0000-0000-000000000002', null,
  'operator.requested', null, 'concurrency-2', now()
)->>'result';" >"$second_result" &
second_pid=$!

wait "$first_pid"
wait "$second_pid"

accepted_count="$(grep -hxc 'accepted' "$first_result" "$second_result" | awk '{total += $1} END {print total}')"
rejected_count="$(grep -hxc 'rejected' "$first_result" "$second_result" | awk '{total += $1} END {print total}')"
test "$accepted_count" = "1"
test "$rejected_count" = "1"

psql "$database_url" --set ON_ERROR_STOP=1 --tuples-only --no-align <<SQL | grep -qx 'CONTACT_READY|1|1'
select state::text || '|' ||
  (select count(*) from public.customer_state_history where customer_id = '$customer_id' and from_state = 'NEW' and to_state = 'CONTACT_READY') || '|' ||
  (select count(*) from public.customer_state_transition_attempts where customer_id = '$customer_id' and result = 'rejected')
from public.customers where id = '$customer_id';
SQL
