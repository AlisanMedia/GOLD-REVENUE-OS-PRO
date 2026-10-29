import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareCampaignStagingAcceptance } from "../../scripts/campaign-staging-acceptance.mjs";
import { campaignDatabaseSelector, validateCampaignAcceptanceResult } from "../../scripts/campaign-staging-run.mjs";

describe("campaign staging acceptance without redeployment or provider activation", () => {
  it("reuses all 56 accepted conditions, retains role changes and expected denials, and rolls back even on success", () => {
    const { sql, manifest } = prepareCampaignStagingAcceptance();
    expect(sql.match(/^select pg_temp\.(?:is|ok|throws_ok)\(/gmu)).toHaveLength(56);
    expect(sql).toContain("set local role authenticated");
    expect(sql).toContain("PCA01");
    expect(sql).toContain("CAMPAIGN_ROLLBACK_UNVERIFIED");
    expect(sql).toMatch(/^begin;[\s\S]+rollback;\n$/u);
    expect(sql).not.toMatch(/\\ir |create extension|^commit;/mu);
    expect(manifest.sql_sha256).toBe(createHash("sha256").update(sql).digest("hex"));
    expect(manifest.sources).toHaveLength(3);
  });
  it.each(["migration", "count", "include", "transaction"])("rejects %s drift instead of silently weakening acceptance", change => {
    const read = (name: string) => {
      const raw = readFileSync(name, "utf8");
      if (change === "migration" && name.includes("migrations/")) return raw + "\n";
      if (change === "count" && name.endsWith("campaign_activation.test.sql")) return raw.replace("select is(", "select removed_assertion(");
      if (change === "include" && name.endsWith("campaign_fixtures.sql")) return raw + "\\ir unsafe.sql\n";
      if (change === "transaction" && name.endsWith("campaign_activation.test.sql")) return raw.replace("begin;\n", "");
      return raw;
    };
    expect(() => prepareCampaignStagingAcceptance(read)).toThrow();
  });
  it.each([
    "postgresql://postgres.xqvwkghpmezcpgugetqc@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    "postgres://postgres@db.xqvwkghpmezcpgugetqc.supabase.co/postgres",
  ])("accepts only the exact staging selector without embedding a password: %s", raw => {
    expect(campaignDatabaseSelector(raw)).toMatchObject({ PGPORT: "5432", PGDATABASE: "postgres" });
    expect(JSON.stringify(campaignDatabaseSelector(raw))).not.toContain("PGPASSWORD");
  });
  it.each([
    "postgres://postgres:secret@db.xqvwkghpmezcpgugetqc.supabase.co/postgres",
    "postgres://postgres@db.other.supabase.co/postgres",
    "postgres://postgres@db.xqvwkghpmezcpgugetqc.supabase.co/another",
    "postgres://postgres@db.xqvwkghpmezcpgugetqc.supabase.co:6543/postgres",
    "postgres://postgres@db.xqvwkghpmezcpgugetqc.supabase.co/postgres?sslmode=disable",
    "postgres://postgres@db.xqvwkghpmezcpgugetqc.supabase.co/postgres#override",
    "postgres://postgres.other@aws-0-eu-central-1.pooler.supabase.com/postgres",
    "https://db.xqvwkghpmezcpgugetqc.supabase.co/postgres",
  ])("denies an alternate target or connection policy: %s", raw => {
    expect(() => campaignDatabaseSelector(raw)).toThrow("EXACT_STAGING_DATABASE_REQUIRED");
  });
  const result = { version: 1, result: "PASS", assertions: 56, fixture_rows_rolled_back: true, authentication: "SQL_FIXTURE_NOT_REAL_FOUNDER_LOGIN", real_model_calls: 0, real_customer_messages: 0, financial_authority: "NONE" };
  it("never presents a SQL MFA fixture as genuine founder UI acceptance", () => {
    expect(validateCampaignAcceptanceResult(JSON.stringify(result))).toEqual(result);
  });
  it.each([{ assertions: 55 }, { result: "SKIP" }, { fixture_rows_rolled_back: false }, { authentication: "REAL_FOUNDER_LOGIN" }, { real_model_calls: 1 }, { real_customer_messages: 1 }, { financial_authority: "LIVE" }])("rejects incomplete or wrongly scoped results: %j", change => {
    expect(() => validateCampaignAcceptanceResult(JSON.stringify({ ...result, ...change }))).toThrow("CAMPAIGN_ACCEPTANCE_RESULT_INVALID");
  });
  it("keeps the protected staging review, exact main gate, isolated concurrency and least-privilege read permissions", () => {
    const workflow = readFileSync(".github/workflows/campaign-staging-acceptance.yml", "utf8");
    expect(workflow).toContain("environment: staging");
    expect(workflow).toContain("group: staging-validation");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("node scripts/private-beta-release-gate.mjs");
    expect(workflow).toContain("STAGING_GITHUB_GOVERNANCE_TOKEN");
    expect(workflow).not.toMatch(/db push|db reset|(?:vercel|release-vercel).*\b(?:deploy|promote|runtime-env)\b|workflow_run:|schedule:|pull_request_target:|OPENAI_API_KEY|TELEGRAM.*TOKEN|SUPABASE_SECRET_KEY|: write/iu);
  });
});
