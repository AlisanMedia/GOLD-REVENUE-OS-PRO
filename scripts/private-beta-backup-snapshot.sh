#!/usr/bin/env bash
# Sourced only by the reviewed backup and disposable recovery tests. The caller
# supplies remote(), beta_tmp and an EXIT trap which always stops this session.
# No credential, host or SQL command is accepted from snapshot/experiment data.
beta_snapshot_start(){
 beta_snapshot_id=
 coproc BETA_SNAPSHOT { remote psql -XqAt -v ON_ERROR_STOP=1 2>"$beta_tmp/snapshot.log"; }
 beta_snapshot_pid=$BETA_SNAPSHOT_PID
 exec {beta_snapshot_input}>&"${BETA_SNAPSHOT[1]}"
 exec {beta_snapshot_output}<&"${BETA_SNAPSHOT[0]}"
 printf '%s\n' "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;" "SET LOCAL idle_in_transaction_session_timeout='180s';" "SELECT pg_export_snapshot();" >&"$beta_snapshot_input"
 if ! IFS= read -r -t 15 beta_snapshot_id <&"$beta_snapshot_output" || ! [[ "$beta_snapshot_id" =~ ^[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{1,8}$ ]];then
  printf '%s\n' CONSISTENT_BACKUP_SNAPSHOT_UNAVAILABLE >&2;return 1
 fi
}
beta_snapshot_stop(){
 if test -n "${beta_snapshot_pid:-}";then
  local beta_snapshot_status=0
  printf 'ROLLBACK;\n\\q\n' >&"$beta_snapshot_input" || beta_snapshot_status=1
  exec {beta_snapshot_input}>&-
  exec {beta_snapshot_output}<&-
  wait "$beta_snapshot_pid" || beta_snapshot_status=1
  beta_snapshot_pid=
  return "$beta_snapshot_status"
 fi
}
