import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ sql: [] as string[], calls: [] as { argv: string[]; env: Record<string, string> }[], failure: "", index: 0 }));
vi.mock("node:child_process", () => ({ spawnSync: (_command: string, argv: string[], options: { input: string; env: Record<string, string> }) => {
  const i = fake.index++;fake.sql.push(options.input);fake.calls.push({ argv, env: options.env });
  if (fake.failure === "sql" && i === 1) return { status: 1, stderr: "secret user text must not be retained", stdout: "" };
  const value = i === 0 ? JSON.stringify({ pg: fake.failure === "version" ? 16 : 17, migration: fake.failure !== "migration" }) : i === 2 ? fake.failure === "rollback" ? "f\n" : "t\n" : JSON.stringify({ version: 1, result: "PASS", assertions: fake.failure === "incomplete" ? 55 : 56, fixture_rows_rolled_back: true, authentication: "SQL_FIXTURE_NOT_REAL_FOUNDER_LOGIN", real_model_calls: 0, real_customer_messages: 0, financial_authority: "NONE" });
  return { status: 0, stdout: value };
} }));
import { runCampaignStagingAcceptance } from "../../scripts/campaign-staging-run.mjs";

const directory = mkdtempSync(join(tmpdir(), "campaign-runner-test-"));
// The link selector is normally Supabase CLI output. Never read an existing
// linked project's file into a test or overwrite it.
const previousCwd = process.cwd();
afterEach(() => { process.chdir(previousCwd);fake.calls=[];fake.sql=[];fake.failure="";fake.index=0; });
function fixture() {
  const run = mkdtempSync(join(directory, "run-")), sha = "a".repeat(40);
  mkdirSync(join(run, "supabase/.temp"), { recursive: true });
  writeFileSync(join(run, "supabase/.temp/pooler-url"), "postgres://postgres@db.xqvwkghpmezcpgugetqc.supabase.co/postgres");
  // Keep the accepted SQL sources real; only the network/process boundary is fake.
  for (const name of ["supabase/tests/campaign_activation.test.sql", "supabase/tests/helpers/campaign_fixtures.sql", "supabase/tests/helpers/polat_inbound_fixtures.sql", "supabase/migrations/20261029111003_founder_campaign_activation.sql"]) {
    mkdirSync(join(run, name, ".."), { recursive: true });writeFileSync(join(run, name), readFileSync(join(previousCwd, name)));
  }
  writeFileSync(join(run, "private-beta-release-gate.json"), JSON.stringify({ sha, ruleset_id: 25348710, admins_bypass: false, staging_reviewer: "AlisanMedia" }));
  process.chdir(run);
  const env = { GITHUB_REPOSITORY: "AlisanMedia/GOLD-REVENUE-OS-PRO", GITHUB_REF: "refs/heads/main", GITHUB_SHA: sha, VALIDATED_SHA: sha, RUNNER_TEMP: run, PATH: "/usr/bin", SUPABASE_DB_PASSWORD: "OFFLINE_TEST_NOT_A_CREDENTIAL", STAGING_SUPABASE_SSL_ROOT_CERT: "OFFLINE_TEST_CA", OPENAI_API_KEY: "MUST_NOT_REACH_PROCESS", GH_TOKEN: "MUST_NOT_REACH_PROCESS" };
  return { run, env };
}
describe("campaign acceptance runner with offline process boundary", () => {
  it("uses three independent PG connections, verify-full TLS and only database credentials; retains no raw output", () => {
    const { run, env } = fixture();
    const result = runCampaignStagingAcceptance(env);
    expect(result).toMatchObject({ result: "PASS", founder_ui: "NOT_TESTED", independent_rollback_verified: true, deployment_performed: false });
    expect(fake.calls).toHaveLength(3);
    for (const call of fake.calls) {
      expect(call.env).toMatchObject({ PGSSLMODE: "verify-full", PGPORT: "5432", PGCONNECT_TIMEOUT: "10", PGPASSWORD: env.SUPABASE_DB_PASSWORD });
      expect(call.env).not.toHaveProperty("OPENAI_API_KEY");expect(call.env).not.toHaveProperty("GH_TOKEN");
      expect(call.argv.join(" ")).not.toContain(env.SUPABASE_DB_PASSWORD);
      expect(call.argv).toContain("ON_ERROR_STOP=1");
    }
    expect(fake.sql[1]).toMatch(/^begin;[\s\S]+rollback;\n$/u);
    const retained = readFileSync(join(run, "campaign-staging-acceptance.json"), "utf8");
    expect(retained).not.toContain(env.SUPABASE_DB_PASSWORD);
    expect(retained).not.toContain("OFFLINE_TEST_CA");
    expect(() => readFileSync(join(run, "source-ca.pem"))).toThrow();
  });
  it.each(["sql", "version", "migration", "rollback", "incomplete"])("preserves %s as FAIL, never as hosted acceptance", failure => {
    const { run, env } = fixture();fake.failure=failure;
    expect(() => runCampaignStagingAcceptance(env)).toThrow(/^CAMPAIGN_STAGING_ACCEPTANCE_FAILED_/u);
    const text = readFileSync(join(run, "campaign-staging-acceptance.json"), "utf8");
    expect(JSON.parse(text)).toMatchObject({ result: "FAIL", hosted_acceptance: "NOT_ACCEPTED" });
    expect(text).not.toContain("secret user text");
    if (["version", "migration"].includes(failure)) expect(fake.calls).toHaveLength(1);
  });
  it("a branch, SHA drift or missing gate cannot reach the process boundary", () => {
    const { run, env } = fixture();
    expect(() => runCampaignStagingAcceptance({ ...env, GITHUB_REF: "refs/heads/feature" })).toThrow();
    expect(() => runCampaignStagingAcceptance({ ...env, VALIDATED_SHA: "b".repeat(40) })).toThrow();
    rmSync(join(run, "private-beta-release-gate.json"));
    expect(() => runCampaignStagingAcceptance(env)).toThrow();
    expect(fake.calls).toHaveLength(0);
  });
});
