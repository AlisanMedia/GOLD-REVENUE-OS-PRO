import { isDeepStrictEqual } from 'node:util';

const assert = (ok, code) => { if (!ok) throw Error(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = v => Object.keys(v).sort();
const sameKeys = (a, b) => isDeepStrictEqual(keys(a), keys(b));
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const integer = v => typeof v === 'string' && /^(?:0|-?[1-9][0-9]{0,18})$/u.test(v) && BigInt(v) >= -(2n ** 63n) && BigInt(v) < 2n ** 63n;
const sequenceMetadata = v => Object.fromEntries(Object.entries(v).map(([k, s]) => [k, { increment: s.increment, min: s.min, max: s.max, cycle: s.cycle }]));
function snapshot(v) {
  const fields = ['tables', 'function_hash', 'ownership_acl_hash', 'rls_constraints_policy_hash', 'sequences', 'database_owner', 'public_schema_owner', 'pg_major'];
  assert(object(v) && isDeepStrictEqual(keys(v), fields.sort()) && v.pg_major === 17, 'RECOVERY_FINGERPRINT_INVALID');
  assert(['function_hash', 'ownership_acl_hash', 'rls_constraints_policy_hash'].every(k => hash(v[k])) && ['database_owner', 'public_schema_owner'].every(k => typeof v[k] === 'string' && Buffer.byteLength(v[k]) >= 1 && Buffer.byteLength(v[k]) <= 63), 'RECOVERY_FINGERPRINT_INVALID');
  assert(object(v.tables) && object(v.sequences) && keys(v.tables).length <= 4096 && keys(v.sequences).length <= 4096, 'RECOVERY_FINGERPRINT_INVALID');
  for (const t of Object.values(v.tables)) assert(object(t) && sameKeys(t, { rows: 0, sha256: '' }) && Number.isSafeInteger(t.rows) && t.rows >= 0 && t.rows <= 200000 && hash(t.sha256), 'RECOVERY_FINGERPRINT_INVALID');
  for (const s of Object.values(v.sequences)) {
    assert(object(s) && sameKeys(s, { last_value: null, state_value: '', is_called: false, increment: '', min: '', max: '', cycle: false }), 'RECOVERY_SEQUENCE_INVALID');
    assert([s.state_value, s.increment, s.min, s.max].every(integer) && typeof s.is_called === 'boolean' && typeof s.cycle === 'boolean' && BigInt(s.increment) !== 0n && BigInt(s.min) <= BigInt(s.state_value) && BigInt(s.state_value) <= BigInt(s.max) && s.last_value === (s.is_called ? s.state_value : null), 'RECOVERY_SEQUENCE_INVALID');
  }
  return v;
}

/** Select only SEQUENCE SET archive entries, never table data or executable input. */
export function privateBetaSequenceToc(toc, source) {
  snapshot(source);
  assert(typeof toc === 'string' && Buffer.byteLength(toc) <= 8388608, 'RECOVERY_SEQUENCE_TOC_INVALID');
  const selected = toc.split('\n').filter(line => /^\d+;\s+\d+\s+\d+\s+SEQUENCE SET\s+(?:public|private|auth)\s/u.test(line));
  assert(selected.length === keys(source.sequences).length, 'RECOVERY_SEQUENCE_TOC_INVALID');
  return selected.join('\n') + '\n';
}
function sequenceName(literal) {
  const decoded = literal.replaceAll("''", "'");
  const match = /^(public|private|auth)\.((?:[a-z_][a-z0-9_$]*)|(?:"(?:[^"]|"")+"))$/u.exec(decoded);
  assert(match, 'RECOVERY_ARCHIVE_SEQUENCE_INVALID');
  return match[1] + '.' + (match[2].startsWith('"') ? match[2].slice(1, -1).replaceAll('""', '"') : match[2]);
}
/** pg_dump sequences are not MVCC: verify exact archive state, never a later live counter. */
function archiveSequences(sql, source) {
  assert(typeof sql === 'string' && Buffer.byteLength(sql) <= 1048576, 'RECOVERY_ARCHIVE_SEQUENCE_INVALID');
  const result = Object.create(null);
  for (const raw of sql.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('--') || /^\\(?:un)?restrict [A-Za-z0-9]+$/u.test(line) || /^SET (?:statement_timeout|lock_timeout|idle_in_transaction_session_timeout|transaction_timeout) = 0;$/u.test(line) || /^SET (?:standard_conforming_strings = on|check_function_bodies = false|xmloption = content|client_min_messages = warning|row_security = off);$/u.test(line) || /^SET client_encoding = 'UTF8';$/u.test(line) || line === "SELECT pg_catalog.set_config('search_path', '', false);") continue;
    const match = /^SELECT pg_catalog\.setval\('((?:[^'\\]|'')+)', (-?[0-9]+), (true|false)\);$/u.exec(line);
    assert(match && integer(match[2]), 'RECOVERY_ARCHIVE_SEQUENCE_INVALID');
    const name = sequenceName(match[1]);
    assert(Object.hasOwn(source.sequences, name) && !Object.hasOwn(result, name), 'RECOVERY_ARCHIVE_SEQUENCE_INVALID');
    const meta = source.sequences[name], value = match[2];
    assert(BigInt(value) >= BigInt(meta.min) && BigInt(value) <= BigInt(meta.max), 'RECOVERY_ARCHIVE_SEQUENCE_INVALID');
    result[name] = { state_value: value, is_called: match[3] === 'true' };
  }
  assert(sameKeys(result, source.sequences), 'RECOVERY_ARCHIVE_SEQUENCE_INVALID');
  return result;
}
function sequenceProgress(before, archive, after) {
  for (const [name, state] of Object.entries(archive)) {
    const first = before[name], last = after[name], increment = BigInt(first.increment);
    const forward = (a, b) => {
      if (a.is_called && !b.is_called) return false;
      const delta = BigInt(b.state_value) - BigInt(a.state_value);
      if (first.cycle) return delta === 0n && a.is_called === b.is_called;
      return (increment > 0n ? delta >= 0n : delta <= 0n) && delta % increment === 0n && (b.is_called || delta === 0n);
    };
    assert(forward(first, state) && forward(state, last), 'RECOVERY_SOURCE_SEQUENCE_REWIND');
  }
}

/** Redacted diagnostics: no object names, rows, definitions, credentials or counter values. */
export function comparePrivateBetaRecovery(before, after, restored, sequenceSql) {
  let sourceRowsChanged = false, sourceSequenceValuesChanged = false;
  try {
    snapshot(before); snapshot(after); snapshot(restored);
    sourceRowsChanged = !isDeepStrictEqual(before.tables, after.tables);
    sourceSequenceValuesChanged = !isDeepStrictEqual(before.sequences, after.sequences);
    const catalog = v => ({ function_hash: v.function_hash, ownership_acl_hash: v.ownership_acl_hash, rls_constraints_policy_hash: v.rls_constraints_policy_hash, database_owner: v.database_owner, public_schema_owner: v.public_schema_owner, pg_major: v.pg_major, tables: keys(v.tables), sequences: sequenceMetadata(v.sequences) });
    assert(isDeepStrictEqual(catalog(before), catalog(after)), 'RECOVERY_SOURCE_CATALOG_DRIFT');
    assert(isDeepStrictEqual(catalog(before), catalog(restored)), 'RECOVERY_RESTORED_CATALOG_MISMATCH');
    assert(isDeepStrictEqual(before.tables, restored.tables), 'RECOVERY_SNAPSHOT_DATA_MISMATCH');
    const expected = archiveSequences(sequenceSql, before);
    for (const [name, value] of Object.entries(expected)) {
      const actual = restored.sequences[name];
      assert(actual.state_value === value.state_value && actual.is_called === value.is_called, 'RECOVERY_ARCHIVE_SEQUENCE_MISMATCH');
    }
    sequenceProgress(before.sequences, expected, after.sequences);
    return Object.freeze({ result: 'PASS', code: 'EXPORTED_SNAPSHOT_AND_ARCHIVE_MATCH', source_rows_changed: sourceRowsChanged, source_sequence_values_changed: sourceSequenceValuesChanged });
  } catch (error) {
    return Object.freeze({ result: 'FAIL', code: error instanceof Error && /^RECOVERY_[A-Z_]+$/u.test(error.message) ? error.message : 'RECOVERY_FINGERPRINT_INVALID', source_rows_changed: sourceRowsChanged, source_sequence_values_changed: sourceSequenceValuesChanged });
  }
}
