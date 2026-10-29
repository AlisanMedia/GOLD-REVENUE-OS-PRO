import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { comparePrivateBetaRecovery, privateBetaSequenceToc } from "../../scripts/private-beta-backup-verify.mjs";

const clone = <T>(v: T): T => structuredClone(v);
function fingerprint() {
  return { pg_major: 17, database_owner: "postgres", public_schema_owner: "pg_database_owner", tables: { "private.fixture": { rows: 1, sha256: "a".repeat(64) } }, function_hash: "b".repeat(64), ownership_acl_hash: "c".repeat(64), rls_constraints_policy_hash: "d".repeat(64), sequences: { "private.fixture_id_seq": { last_value: "1" as string | null, state_value: "1", is_called: true, increment: "1", min: "1", max: "9223372036854775807", cycle: false } } };
}
const seq = "SELECT pg_catalog.setval('private.fixture_id_seq', 2, true);\n";
function setup() {
  const before = fingerprint(), after = clone(before), restored = clone(before);
  after.tables["private.fixture"] = { rows: 3, sha256: "e".repeat(64) };
  after.sequences["private.fixture_id_seq"].last_value = after.sequences["private.fixture_id_seq"].state_value = "3";
  restored.sequences["private.fixture_id_seq"].last_value = restored.sequences["private.fixture_id_seq"].state_value = "2";
  return { before, after, restored };
}
describe("shared-snapshot recovery with concurrent source progress", () => {
  it("accepts exactly the exported row snapshot and archive sequence state, not the later source", () => {
    const { before, after, restored } = setup();
    expect(comparePrivateBetaRecovery(before, after, restored, seq)).toEqual({ result: "PASS", code: "EXPORTED_SNAPSHOT_AND_ARCHIVE_MATCH", source_rows_changed: true, source_sequence_values_changed: true });
  });
  it("also verifies a quiescent source and exact sequence state above JS safe-integer precision", () => {
    const a = fingerprint(); a.sequences["private.fixture_id_seq"].last_value = a.sequences["private.fixture_id_seq"].state_value = "9007199254740993";
    expect(comparePrivateBetaRecovery(a, a, a, "SELECT pg_catalog.setval('private.fixture_id_seq', 9007199254740993, true);").result).toBe("PASS");
  });
  it("preserves uncalled sequence value as well as is_called; null alone is insufficient", () => {
    const a = fingerprint(); Object.assign(a.sequences["private.fixture_id_seq"], { last_value: null, state_value: "69", is_called: false });
    expect(comparePrivateBetaRecovery(a, a, a, "SELECT pg_catalog.setval('private.fixture_id_seq', 69, false);").result).toBe("PASS");
    expect(comparePrivateBetaRecovery(a, a, a, "SELECT pg_catalog.setval('private.fixture_id_seq', 70, false);").code).toBe("RECOVERY_ARCHIVE_SEQUENCE_MISMATCH");
  });
  it.each(["function_hash", "ownership_acl_hash", "rls_constraints_policy_hash"] as const)("holds genuine source catalog drift in %s", field => {
    const { before, after, restored } = setup(); after[field] = "f".repeat(64);
    expect(comparePrivateBetaRecovery(before, after, restored, seq).code).toBe("RECOVERY_SOURCE_CATALOG_DRIFT");
  });
  it.each(["function_hash", "ownership_acl_hash", "rls_constraints_policy_hash"] as const)("holds a corrupted restored %s", field => {
    const { before, after, restored } = setup(); restored[field] = "f".repeat(64);
    expect(comparePrivateBetaRecovery(before, after, restored, seq).code).toBe("RECOVERY_RESTORED_CATALOG_MISMATCH");
  });
  it("never substitutes the latest source rows for the backup snapshot", () => {
    const { before, after, restored } = setup(); restored.tables = clone(after.tables);
    expect(comparePrivateBetaRecovery(before, after, restored, seq).code).toBe("RECOVERY_SNAPSHOT_DATA_MISMATCH");
  });
  it("rejects new tables and lost tables after export", () => {
    const { before, after, restored } = setup();
    expect(comparePrivateBetaRecovery(before, { ...after, tables: {} }, restored, seq).code).toBe("RECOVERY_SOURCE_CATALOG_DRIFT");
    expect(comparePrivateBetaRecovery(before, after, { ...restored, tables: {} }, seq).code).toBe("RECOVERY_RESTORED_CATALOG_MISMATCH");
  });
  it.each(["database_owner", "public_schema_owner"] as const)("preserves exact %s", field => {
    const { before, after, restored } = setup(); restored[field] = "another_role";
    expect(comparePrivateBetaRecovery(before, after, restored, seq).code).toBe("RECOVERY_RESTORED_CATALOG_MISMATCH");
  });
  it.each(["increment", "min", "max"] as const)("preserves sequence metadata %s while allowing counter progress", field => {
    const { before, after, restored } = setup(); after.sequences["private.fixture_id_seq"][field] = field === "max" ? "9223372036854775806" : field === "min" ? "0" : "2";
    expect(comparePrivateBetaRecovery(before, after, restored, seq).code).toBe("RECOVERY_SOURCE_CATALOG_DRIFT");
  });
  it("rejects a restored counter different from the archive, despite valid source progress", () => {
    const { before, after, restored } = setup(); restored.sequences["private.fixture_id_seq"].state_value = restored.sequences["private.fixture_id_seq"].last_value = "3";
    expect(comparePrivateBetaRecovery(before, after, restored, seq).code).toBe("RECOVERY_ARCHIVE_SEQUENCE_MISMATCH");
  });
  it("rejects counter rewind, reset-to-uncalled and unverifiable cyclic progress", () => {
    const { before, after, restored } = setup();
    const rewind = clone(after); rewind.sequences["private.fixture_id_seq"].last_value = rewind.sequences["private.fixture_id_seq"].state_value = "1";
    expect(comparePrivateBetaRecovery(before, rewind, restored, seq).code).toBe("RECOVERY_SOURCE_SEQUENCE_REWIND");
    const reset = clone(after); Object.assign(reset.sequences["private.fixture_id_seq"], { last_value: null, state_value: "3", is_called: false });
    expect(comparePrivateBetaRecovery(before, reset, restored, seq).code).toBe("RECOVERY_SOURCE_SEQUENCE_REWIND");
    for (const v of [before, after, restored]) v.sequences["private.fixture_id_seq"].cycle = true;
    expect(comparePrivateBetaRecovery(before, after, restored, seq).code).toBe("RECOVERY_SOURCE_SEQUENCE_REWIND");
  });
  it("accepts provable descending sequence progress without rounding", () => {
    const { before, after, restored } = setup();
    for (const [v, value] of [[before, "9"], [after, "5"], [restored, "7"]] as const) Object.assign(v.sequences["private.fixture_id_seq"], { state_value: value, last_value: value, increment: "-2" });
    expect(comparePrivateBetaRecovery(before, after, restored, "SELECT pg_catalog.setval('private.fixture_id_seq', 7, true);").result).toBe("PASS");
  });
  it.each(["", seq + seq, "SELECT pg_catalog.setval('private.unknown', 2, true);", "SELECT pg_catalog.setval('private.fixture_id_seq', 9223372036854775808, true);", "SELECT pg_catalog.setval('private.fixture_id_seq', 1.5, true);", "SELECT pg_catalog.setval('private.fixture_id_seq', 02, true);", "SELECT pg_catalog.setval('private.fixture_id_seq', 0, true);", seq + "DROP SCHEMA private CASCADE;", seq + "SELECT pg_sleep(1);", seq + "\\connect remote", " ".repeat(1048577)])("fails closed on missing/duplicate/malformed/unexpected archive SQL (%#)", sql => {
    const { before, after, restored } = setup();
    expect(comparePrivateBetaRecovery(before, after, restored, sql).code).toBe("RECOVERY_ARCHIVE_SEQUENCE_INVALID");
  });
  it("accepts only documented non-executable archive/session framing", () => {
    const { before, after, restored } = setup();
    const sql = "-- PostgreSQL database dump\n\\restrict fixture123\nSET statement_timeout = 0;\nSET client_encoding = 'UTF8';\nSELECT pg_catalog.set_config('search_path', '', false);\n" + seq + "\\unrestrict fixture123\n";
    expect(comparePrivateBetaRecovery(before, after, restored, sql).result).toBe("PASS");
  });
  it("supports safely quoted sequence identifiers without executing their text", () => {
    const a = fingerprint(), state = a.sequences["private.fixture_id_seq"];
    const v = { ...a, sequences: { 'private.fixture"name': state } };
    expect(comparePrivateBetaRecovery(v, v, v, 'SELECT pg_catalog.setval(\'private."fixture""name"\', 1, true);').result).toBe("PASS");
  });
  it.each([null, {}, { ...fingerprint(), pg_major: 16 }, { ...fingerprint(), extra: true }, { ...fingerprint(), tables: [] }, { ...fingerprint(), sequences: [] }, { ...fingerprint(), function_hash: "not-a-hash" }])("denies malformed or wrong-version evidence (%#)", input => {
    const a = fingerprint(); expect(comparePrivateBetaRecovery(input, a, a, seq).result).toBe("FAIL");
  });
  it("emits only fixed diagnostic codes and flags, never data or catalog identities", () => {
    const { before, after, restored } = setup();
    const result = JSON.stringify(comparePrivateBetaRecovery(before, after, restored, seq));
    expect(result).not.toMatch(/fixture|postgres|sha256|922337|SELECT|setval/);
    expect(JSON.stringify(comparePrivateBetaRecovery(before, after, restored, seq + "secret_customer_text"))).not.toContain("secret_customer_text");
  });
  it("handles archives without sequences", () => {
    const a = { ...fingerprint(), sequences: {} };
    expect(comparePrivateBetaRecovery(a, a, a, "-- no sequences\n").result).toBe("PASS");
  });
  it("selects only the exact number of scoped SEQUENCE SET entries, retaining the full restore separately", () => {
    const toc = "3; 2615 2200 SCHEMA - public postgres\n5; 0 0 TABLE DATA private fixture postgres\n6; 0 0 SEQUENCE SET private fixture_id_seq postgres\n";
    expect(privateBetaSequenceToc(toc, fingerprint())).toBe("6; 0 0 SEQUENCE SET private fixture_id_seq postgres\n");
    expect(() => privateBetaSequenceToc(toc + "7; 0 0 SEQUENCE SET private duplicate postgres\n", fingerprint())).toThrow();
    expect(() => privateBetaSequenceToc("6; 0 0 SEQUENCE SET vault secret postgres\n", fingerprint())).toThrow();
  });
  it("keeps TLS, read-only transactions, shared snapshot, full restore and fail-closed release ordering", () => {
    const shell = readFileSync("scripts/private-beta-staging-backup.sh", "utf8"), helper = readFileSync("scripts/private-beta-backup-snapshot.sh", "utf8"), sql = readFileSync("infra/sql/private-beta-recovery-fingerprint.sql", "utf8");
    expect(shell).toContain("PGSSLMODE=verify-full"); expect(shell).toContain('--snapshot="$beta_snapshot_id"'); expect(shell).toContain('-v private_beta_snapshot="$beta_snapshot_id"');
    expect(helper).toContain("REPEATABLE READ READ ONLY"); expect(helper).toContain("pg_export_snapshot()"); expect(helper).toContain("read -r -t 15"); expect(helper).toContain("idle_in_transaction_session_timeout='180s'"); expect(helper).toContain("ROLLBACK;");
    expect(sql).toContain("set transaction snapshot :'private_beta_snapshot'"); expect(shell).toContain("comparePrivateBetaRecovery"); expect(shell).toContain("comparison.result!=='PASS'"); expect(shell).toContain("--exit-on-error");
    expect(shell).not.toMatch(/--no-owner|--no-acl|--exclude-table|ALTER SYSTEM|pg_terminate_backend|retry/);
  });
});
