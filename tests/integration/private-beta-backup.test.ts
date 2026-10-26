import { describe, expect, it } from "vitest";
// CLI helper is pure and credential-free when imported.
import { encryptPrivateBetaBackup, decryptPrivateBetaBackup } from "../../scripts/private-beta-backup-crypto.mjs";
describe("private beta encrypted recovery artifact", () => {
  const key = "offline-only-backup-test-".padEnd(48, "x");
  it("roundtrips exact bytes with random salt/IV and authenticated metadata", () => {
    const bytes = Buffer.from("synthetic PostgreSQL dump fixture"), a = encryptPrivateBetaBackup(bytes, key), b = encryptPrivateBetaBackup(bytes, key);
    expect(a.equals(b)).toBe(false); expect(decryptPrivateBetaBackup(a, key).equals(bytes)).toBe(true);
    const corrupt = Buffer.from(a); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    expect(() => decryptPrivateBetaBackup(corrupt, key)).toThrow();
  });
  it("rejects wrong passphrase and missing custody without leaking dump content", () => {
    const a = encryptPrivateBetaBackup(Buffer.from("synthetic only"), key);
    expect(() => decryptPrivateBetaBackup(a, key + "wrong")).toThrow();
    expect(() => encryptPrivateBetaBackup(Buffer.from("fixture"), "short")).toThrow("BACKUP_CUSTODY_REQUIRED");
  });
});
