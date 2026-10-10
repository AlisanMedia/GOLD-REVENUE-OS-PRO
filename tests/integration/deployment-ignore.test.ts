import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("keeps Supabase runtime source while excluding root database and non-runtime evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "gold-deployment-ignore-"));
  try {
    expect(spawnSync("git", ["init", "--quiet"], { cwd: directory }).status).toBe(0);
    writeFileSync(join(directory, ".git", "info", "exclude"), readFileSync(".vercelignore"));
    const excluded = ["supabase/migrations/202609120001_foundation.sql", "docs/evidence/phase7/report.json", ".github/workflows/ci.yml", "tests/integration/openai-provider.test.ts"];
    const paths = ["apps/web/src/lib/supabase/admin.ts", "apps/web/src/lib/supabase/server.ts", ...excluded];
    const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: directory, encoding: "utf8", input: paths.join("\n") + "\n" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual(excluded);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
