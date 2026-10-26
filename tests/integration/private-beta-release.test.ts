import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validatePrivateBetaReleaseGate } from "../../scripts/private-beta-release-gate.mjs";
import { PRIVATE_BETA_VERCEL, privateBetaBuildEnvironment, validatePrivateBetaDeployment, validatePrivateBetaVercelProject } from "../../scripts/private-beta-release-vercel.mjs";
import { parsePrivateBetaAccountProgram } from "../../scripts/private-beta-release-account.mjs";
import { privateBetaRestorePlan } from "../../scripts/private-beta-release-restore.mjs";
import { privateBetaBotWebhookRequest, verifyAndRecordPrivateBetaBot } from "../../scripts/private-beta-release-bot.mjs";
const sha = "a".repeat(40);
const gate = () => ({ sha, workflow_sha: sha, repository: "AlisanMedia/GOLD-REVENUE-OS-PRO", ref: "refs/heads/main", repositoryInfo: { default_branch: "main" }, main: { protected: true, commit: { sha } }, ruleset: { id: 25348710, enforcement: "active", bypass_actors: [], conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } }, rules: [{ type: "deletion" }, { type: "non_fast_forward" }, { type: "pull_request", parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: true, required_review_thread_resolution: true } }, { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "Application", integration_id: 15368 }, { context: "Database", integration_id: 15368 }] } }] }, checks: { check_runs: ["Application", "Database"].map((name, i) => ({ name, id: i + 1, app: { id: 15368 }, head_sha: sha, status: "completed", conclusion: "success", details_url: "https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/1/job/" + i })) }, environment: { name: "staging", can_admins_bypass: false, protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: { login: "AlisanMedia" } }] }], deployment_branch_policy: { custom_branch_policies: true } }, branchPolicies: { branch_policies: [{ name: "main", type: "branch" }] } });
const project = () => ({ id: PRIVATE_BETA_VERCEL.project, name: PRIVATE_BETA_VERCEL.name, accountId: PRIVATE_BETA_VERCEL.team, ssoProtection: { enabled: true, deploymentType: "all_except_custom_domains" }, link: { type: "github", org: "AlisanMedia", repo: "GOLD-REVENUE-OS-PRO" }, targets: { production: { id: "dpl_previous" } } });
const team = { id: PRIVATE_BETA_VERCEL.team, slug: PRIVATE_BETA_VERCEL.name };
describe("private-beta protected release gates (offline only)", () => {
  it("requires exact current main, both independent Actions checks and the existing owner environment", () => {
    expect(validatePrivateBetaReleaseGate(gate())).toMatchObject({ sha, admins_bypass: false, financial_authority: "NONE", commercial_pilot: "NO_GO" });
  });
  it.each(["pending", "failure", "cancelled", "skipped", null])("never accepts Database conclusion %s", conclusion => {
    const input = gate(); input.checks.check_runs[1]!.conclusion = conclusion as string;
    expect(() => validatePrivateBetaReleaseGate(input)).toThrow("EXACT_HEAD_CI_SUCCESS_REQUIRED");
  });
  it("rejects missing/foreign-app/duplicate/stale checks and a changed main", () => {
    const missing = gate(); missing.checks.check_runs.pop(); expect(() => validatePrivateBetaReleaseGate(missing)).toThrow();
    const foreign = gate(); foreign.checks.check_runs[1]!.app.id = 2; expect(() => validatePrivateBetaReleaseGate(foreign)).toThrow();
    const duplicate = gate(); duplicate.checks.check_runs.push(duplicate.checks.check_runs[0]!); expect(() => validatePrivateBetaReleaseGate(duplicate)).toThrow();
    const stale = gate(); stale.main.commit.sha = "b".repeat(40); expect(() => validatePrivateBetaReleaseGate(stale)).toThrow();
  });
  it("rejects bypass, non-main environment rules, lost protection or a foreign workflow ref", () => {
    const bypass = gate(); bypass.environment.can_admins_bypass = true; expect(() => validatePrivateBetaReleaseGate(bypass)).toThrow();
    const policy = gate(); policy.branchPolicies.branch_policies[0]!.name = "*"; expect(() => validatePrivateBetaReleaseGate(policy)).toThrow();
    const branch = gate(); branch.ref = "refs/heads/codex/private-beta-uat"; expect(() => validatePrivateBetaReleaseGate(branch)).toThrow();
    const protection = gate(); protection.main.protected = false; expect(() => validatePrivateBetaReleaseGate(protection)).toThrow();
  });
  it("validates the exact team/project, connected repo and preserved SSO", () => {
    expect(validatePrivateBetaVercelProject(project(), team)).toMatchObject({ id: PRIVATE_BETA_VERCEL.project, prior_deployment: "dpl_previous" });
    expect(() => validatePrivateBetaVercelProject({ ...project(), id: "another" }, team)).toThrow();
    expect(() => validatePrivateBetaVercelProject({ ...project(), ssoProtection: { enabled: false } }, team)).toThrow();
    expect(() => validatePrivateBetaVercelProject({ ...project(), link: null }, team)).toThrow();
  });
  it("does not put model, admin, bot, database-secret or backup credentials into build inputs", () => {
    const content = privateBetaBuildEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://xqvwkghpmezcpgugetqc.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test-publishable-key", POLAT_UAT_ANTHROPIC_API_KEY: "private-model-fixture", POLAT_UAT_ANTHROPIC_ADMIN_KEY: "private-admin-fixture", POLAT_UAT_TELEGRAM_BOT_TOKEN: "private-bot-fixture", POLAT_UAT_STARS_TEST_BOT_TOKEN: "private-stars-fixture", POLAT_UAT_STARS_TEST_WEBHOOK_SECRET: "private-stars-webhook-fixture", POLAT_UAT_STARS_RELAY_SECRET: "private-stars-relay-fixture", SUPABASE_SECRET_KEY: "private-db-fixture", STAGING_BACKUP_PASSPHRASE: "private-backup-fixture" });
    expect(content).toContain("\nNEXT_PUBLIC_SUPABASE_URL="); expect(content).not.toMatch(/private-(model|admin|bot|stars|db|backup)/);
    expect(() => privateBetaBuildEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://foreign.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public" })).toThrow();
  });
  it("rejects a wrong SHA, Preview, non-READY or foreign-project deployment", () => {
    const deployment = { id: "dpl_new", url: "fixture.vercel.app", projectId: PRIVATE_BETA_VERCEL.project, name: PRIVATE_BETA_VERCEL.name, target: "production", readyState: "READY", meta: { githubCommitSha: sha } };
    expect(validatePrivateBetaDeployment(deployment, sha)).toMatchObject({ sha, commercial_production: false });
    for (const change of [{ target: "preview" }, { readyState: "ERROR" }, { projectId: "another" }, { meta: { githubCommitSha: "b".repeat(40) } }]) expect(() => validatePrivateBetaDeployment({ ...deployment, ...change }, sha)).toThrow();
  });
  it("registers only a manually dispatched protected release, with backup upload before migration", () => {
    const workflow = readFileSync(".github/workflows/private-beta-uat.yml", "utf8");
    expect(workflow).toContain("workflow_dispatch:"); expect(workflow).not.toMatch(/pull_request_target|schedule:|workflow_run:/u);
    expect(workflow).toContain("environment: staging"); expect(workflow).toContain("group: staging-validation");
    expect(workflow.indexOf("Retain encrypted recoverable backup before migration")).toBeLessThan(workflow.indexOf("Apply only reviewed pending staging migrations"));
    expect(workflow).toContain("--skip-vault"); expect(workflow).toContain("--skip-domain"); expect(workflow.split("\n  account_preflight:")[0]).not.toContain("POLAT_UAT_ANTHROPIC_ADMIN_KEY:");
    expect(workflow.indexOf("Authenticated infrastructure smoke")).toBeLessThan(workflow.indexOf("Promote only the verified isolated staging build"));
    const attach = workflow.slice(workflow.indexOf("Attach the narrowly scoped runtime configuration"), workflow.indexOf("Reverify protected main before publication"));
    expect(attach).toContain("POLAT_UAT_STARS_TEST_BOT_TOKEN"); expect(attach).not.toContain("POLAT_UAT_ANTHROPIC_ADMIN_KEY");
  });
  it("requires a real owned program read before a read-only account observation", () => {
    const program = "b0b00000-0000-4000-8000-000000000001", tenant = "b0b00000-0000-4000-8000-000000000002";
    const value = [{ private_beta_program: { program_id: program, tenant_id: tenant, repository_sha: sha, stage: "CANARY", starts_at: "2026-10-26T00:00:00Z", expires_at: "2026-10-27T00:00:00Z" } }];
    expect(parsePrivateBetaAccountProgram(value, program, sha)).toMatchObject({ program_id: program, tenant_id: tenant });
    expect(() => parsePrivateBetaAccountProgram([], program, sha)).toThrow("OWNED_PROGRAM_REQUIRED");
    expect(() => parsePrivateBetaAccountProgram(value, tenant, sha)).toThrow("OWNED_PROGRAM_REQUIRED");
    expect(() => parsePrivateBetaAccountProgram(value, program, "b".repeat(40))).toThrow("OWNED_PROGRAM_REQUIRED");
    expect(() => parsePrivateBetaAccountProgram(value, "' or true--", sha)).toThrow("OWNED_PROGRAM_REQUIRED");
  });
  it("retains every ACL entry while preserving the initdb public-schema baseline", () => {
    const toc = "; Archive TOC\n3; 2615 2200 SCHEMA - public pg_database_owner\n8; 0 0 ACL - SCHEMA public pg_database_owner\n9; 1259 100 TABLE public fixture postgres\n";
    const plan = privateBetaRestorePlan(toc, { database_owner: "postgres", public_schema_owner: "pg_database_owner" });
    expect(plan.toc).toContain("; 3; 2615 2200 SCHEMA - public"); expect(plan.toc).toContain("\n8; 0 0 ACL - SCHEMA public"); expect(plan.toc).toContain("9; 1259 100 TABLE public fixture postgres");
    expect(plan.owner_sql).toBe('ALTER SCHEMA public OWNER TO "pg_database_owner";\n');
    expect(() => privateBetaRestorePlan(toc + "4; 2615 2300 SCHEMA - public postgres\n", { database_owner: "postgres", public_schema_owner: "postgres" })).toThrow();
    expect(privateBetaRestorePlan(toc, { database_owner: "postgres", public_schema_owner: 'quoted"owner' }).owner_sql).toContain('"quoted""owner"');
  });
});

describe("protected real bot identity import (offline HTTP fixtures only)", () => {
  const program = "b0b00000-0000-4000-8000-000000000001", tenant = "b0b00000-0000-4000-8000-000000000002";
  const botToken = "123456789:fixture_only_not_a_real_bot_token", managementToken = "fixture-management-not-a-real-key";
  function fake(change = "") {
    const calls: { url: string; init: RequestInit }[] = []; let databaseReads = 0; let proof: unknown;
    const network = async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url); calls.push({ url: target, init: init ?? {} });
      const json = (value: unknown, status = 200) => Response.json(value, { status });
      if (target.startsWith("https://api.telegram.org/")) {
        if (change === "timeout") throw new DOMException("token-bearing fixture URL must not escape", "TimeoutError");
        if (change === "denied") return json({ ok: false, error_code: 401 }, 401);
        if (change === "oversize") return new Response(" ".repeat(16385), { headers: { "content-type": "application/json" } });
        if (change === "duplicates") return new Response('{"ok":true,"ok":false,"result":{"id":123456789,"is_bot":true}}', { headers: { "content-type": "application/json" } });
        return json({ ok: true, result: { id: change === "wrong-bot" ? 123456780 : 123456789, is_bot: change !== "human", first_name: "Synthetic bot", username: "fixture_never_logged", can_join_groups: true } });
      }
      expect(target).toBe("https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query");
      const sql = JSON.parse(String(init?.body)).query as string;
      if (sql.startsWith("do $private_beta_bot$")) {
        const encoded = /decode\('([a-f0-9]+)','hex'\)/u.exec(sql)?.[1]; expect(encoded).toBeDefined();
        proof = JSON.parse(Buffer.from(encoded!, "hex").toString("utf8"));
        expect(sql).toContain("for update of p"); expect(sql).toContain("p.generation=1"); expect(sql).toContain("PRIVATE_BETA_BOT_REVISION_CHANGED");
        expect(sql).not.toContain(botToken); return json([]);
      }
      if (databaseReads++ === 0) return json(change === "no-program" ? [] : [{ private_beta_program: { database_role: change === "wrong-role" ? "service_role" : "postgres", program_id: program, tenant_id: tenant, repository_sha: change === "wrong-sha" ? "b".repeat(40) : sha, stage: "DRAFT", generation: "1", manifest_hash: "c".repeat(64), authorization_record_hash: "d".repeat(64) } }]);
      return json([{ bot_control: change === "stale-readback" ? { ...(proof as object), bot_id: "123456780" } : proof }]);
    };
    return { network: network as typeof fetch, calls };
  }
  const run = (network: typeof fetch) => verifyAndRecordPrivateBetaBot({ programId: program, sha, managementToken, botToken, network, now: () => Date.parse("2026-10-26T10:00:00Z") });
  it("validates actual getMe, fences the database import and independently reads its persisted binding", async () => {
    const f = fake(), result = await run(f.network);
    expect(result).toMatchObject({ database_readback_verified: true, bot_id: "123456789", program_id: program, tenant_id: tenant, telegram_messages: 0, model_requests: 0, webhook_registered: false });
    expect(f.calls).toHaveLength(4); expect(f.calls.filter(c => c.url.startsWith("https://api.telegram.org/"))).toHaveLength(1);
    expect(f.calls.every(c => c.init.redirect === "error" && c.init.signal instanceof AbortSignal)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(botToken); expect(JSON.stringify(result)).not.toContain(managementToken); expect(JSON.stringify(result)).not.toContain("fixture_never_logged");
    expect(f.calls.every(c => !/sendMessage|setWebhook|Messages/iu.test(c.url))).toBe(true);
  });
  it.each(["no-program", "wrong-sha", "wrong-role", "wrong-bot", "human", "denied", "duplicates", "oversize", "timeout"])("fails closed for %s without writing a false identity", async change => {
    const f = fake(change); await expect(run(f.network)).rejects.toThrow();
    expect(f.calls.some(c => String(c.init.body).includes("private.private_beta_bot_control_record"))).toBe(false);
    expect(f.calls.filter(c => c.url.startsWith("https://api.telegram.org/"))).toHaveLength(["no-program", "wrong-sha", "wrong-role"].includes(change) ? 0 : 1);
  });
  it("does not treat a successful write response as proof when independent read-back disagrees", async () => {
    const f = fake("stale-readback"); await expect(run(f.network)).rejects.toThrow("BOT_CONTROL_PERSISTENCE_UNVERIFIED");
  });
  it("rejects caller-selected SQL/tenant/host paths before dispatch", async () => {
    const f = fake(); await expect(verifyAndRecordPrivateBetaBot({ programId: "' or true--", sha, managementToken, botToken, network: f.network })).rejects.toThrow("EXACT_BOT_PROGRAM_RELEASE_REQUIRED");
    expect(f.calls).toHaveLength(0);
  });
  it("only prepares a fixed authenticated ingress payload and never drops queued updates", () => {
    const plan = privateBetaBotWebhookRequest("fixture_webhook_" + "x".repeat(32));
    expect(plan).toMatchObject({ url: "https://xqvwkghpmezcpgugetqc.supabase.co/functions/v1/polat-private-beta-ingress", allowed_updates: ["message"], max_connections: 1, drop_pending_updates: false });
    expect(() => privateBetaBotWebhookRequest("bad\nsecret")).toThrow();
    const workflow = readFileSync(".github/workflows/private-beta-uat.yml", "utf8"), botJob = workflow.split("\n  verify_bot:\n")[1]!;
    expect(botJob).toContain("environment: staging"); expect(botJob).toContain("private-beta-release-gate.mjs");
    expect(botJob).toContain("private-beta-release-bot.mjs"); expect(botJob).not.toMatch(/ANTHROPIC|setWebhook|sendMessage|db push|vercel.*deploy/iu);
  });
});
