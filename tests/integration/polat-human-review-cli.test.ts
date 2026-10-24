import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve("."), cli = join(root, "scripts/polat-human-review.mjs"), loader = join(root, "scripts/polat-typescript-resolver.mjs");
function run(args: string[], block?: string, cwd = root) {
  return spawnSync(process.execPath, ["--experimental-transform-types", ...(block ? ["--import", block] : []), "--import", loader, cli, ...args], { encoding: "utf8", timeout: 30000, cwd });
}
describe("offline human-review CLI uses actual source and no model or network", () => {
  it("prepares blank blind material, reexports the same samples and refuses overwrite", () => {
    const dir = mkdtempSync(join(tmpdir(), "polat-review-cli-"));
    try {
      const block = join(dir, "no-network.mjs");
      writeFileSync(block, 'globalThis.fetch=()=>{throw Error("NETWORK_FORBIDDEN")};');
      const out = join(dir, "pack"), prepared = run(["prepare", "--out", out], block, dir);
      expect(prepared.status, prepared.stderr).toBe(0);
      expect(JSON.parse(prepared.stdout)).toMatchObject({ samples: 216, actual_human_reviews: 0, human_state: "HUMAN_REVIEW_PENDING" });
      const rows = readFileSync(join(out, "private-plan.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line) as {record_type:string;value:Record<string,unknown>});
      const header = rows[0]!.value;
      expect(header.repository_sha).toBe(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: root }).trim());
      const html = readFileSync(join(out, "unassigned-review.html"), "utf8");
      expect(html).not.toMatch(/DIRECT|ONE_QUESTION|private_index|target_key/u);
      expect(html).toContain("NATURALNESS_NOT_MEASURED");
      const exported = join(dir, "same"), result = run(["export", "--pack", join(out, "private-plan.jsonl"), "--out", exported], block);
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(exported, "blind-material.jsonl"), "utf8")).toBe(readFileSync(join(out, "unassigned-blind.jsonl"), "utf8"));
      const repeated = run(["prepare", "--out", out], block);
      expect(repeated.status).toBe(2);
      expect(repeated.stderr).toContain("POLAT_REVIEW_INPUT_INVALID");
      const summary = JSON.parse(readFileSync(join(out, "pending-summary.json"), "utf8")) as { validation:string;actual_verified_human_reviews:number };
      expect(summary.validation).toBe("INCOMPLETE"); expect(summary.actual_verified_human_reviews).toBe(0);
      expect(readdirSync(out)).not.toContain("scores.json");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
  it("rejects duplicate-key roster and arbitrary activation flags without echoing input", () => {
    const dir = mkdtempSync(join(tmpdir(), "polat-review-invalid-"));
    try {
      const file = join(dir, "invalid.jsonl"); writeFileSync(file, '{"role":"REVIEWER","role":"ADJUDICATOR","secret":"never-echo-this"}\n');
      const result = run(["prepare", "--out", join(dir, "out"), "--roster", file]);
      expect(result.status).toBe(2); expect(result.stdout).toBe(""); expect(result.stderr).not.toContain("never-echo-this");
      expect(run(["prepare", "--enable-live"]).status).toBe(2);
      expect(run(["seal", "--declared-human", "--fixture-validation"]).status).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
