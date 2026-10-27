import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/private-beta-uat.yml", "utf8");
const retentionInput = workflow.match(/^      backup_retention_days:\n((?:^        [^\n]*\n)+)/mu)?.[1];
const guards = workflow.split("\n").map(line => line.trim()).filter(line => line.startsWith('[[ "$BACKUP_RETENTION_DAYS"'));
const strictGuard = '[[ "$BACKUP_RETENTION_DAYS" =~ ^([1-9]|[12][0-9]|30)$ ]]';

function validateInBash(value: string) {
  // Execute only the existing integer guard, never the release workflow or its
  // Node/network steps. Candidate values are environment data, not shell code.
  if (guards.length !== 4 || guards.some(guard => guard !== strictGuard)) throw new Error("RETENTION_GUARDS_CHANGED");
  const result = spawnSync("bash", ["--noprofile", "--norc", "-euo", "pipefail", "-c", guards[0]!], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", BACKUP_RETENTION_DAYS: value },
    encoding: "utf8", timeout: 1000,
  });
  expect(result.error).toBeUndefined();
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
  return result.status;
}

describe("private-beta dispatch retention input regression (offline Bash only)", () => {
  it("uses a required string input so entered 14 stays 14 rather than numeric 14.0", () => {
    expect(workflow.match(/^      backup_retention_days:$/gmu)).toHaveLength(1);
    expect(retentionInput).toMatch(/^        required: true$/mu);
    expect(retentionInput).toMatch(/^        type: string$/mu);
    expect(retentionInput).not.toMatch(/^        type: number$/mu);
  });

  it("preserves the same strict integer guard in every protected release/preflight job", () => {
    expect(guards).toHaveLength(4);
    expect(guards.every(guard => guard === strictGuard)).toBe(true);
  });

  it.each(Array.from({ length: 30 }, (_, index) => String(index + 1)))("accepts canonical integer %s", value => {
    expect(validateInBash(value)).toBe(0);
  });

  it.each(["", "0", "31", "100", "-1", "+14", "014", "1.0", "14.0", "30.0", "14.5", "1e1", "NaN", "Infinity", " 14", "14 ", "14\n", "\n14", "14; exit 0", "$(exit 0)", "14\n30", "١٤", "14,0"])("rejects noncanonical or out-of-range input %j without normalization", value => {
    expect(validateInBash(value)).toBe(1);
  });
});
