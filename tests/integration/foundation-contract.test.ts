import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(resolve(root, "supabase/migrations/202609120001_foundation.sql"), "utf8");

describe("Phase 1 migration contract", () => {
  it("contains only foundation business tables", () => {
    const tables = [...migration.matchAll(/create table public\.(\w+)/gi)].map((match) => match[1]);
    expect(tables).toEqual(["app_users", "tenants", "tenant_members", "audit_logs"]);
  });

  it("enables RLS and gives authenticated users read-only table grants", () => {
    for (const table of ["app_users", "tenants", "tenant_members", "audit_logs"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`grant select on table public.${table} to authenticated`);
    }
    expect(migration).not.toMatch(/grant\s+(insert|update|delete|all)[^;]*to authenticated/i);
  });

  it("protects membership and audit decisions in database policies", () => {
    expect(migration).toContain("private.is_tenant_member");
    expect(migration).toContain("private.has_tenant_role");
    expect(migration).toContain("audit_logs_immutable");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = pg_catalog");
  });

  it("does not introduce later-phase domain tables", () => {
    const forbidden = ["customers", "messages", "agent_tasks", "payments", "subscriptions", "channel_access"];
    for (const table of forbidden) expect(migration).not.toMatch(new RegExp(`create table(?: public\\.)?${table}\\b`, "i"));
  });
});

describe("source-of-truth preservation", () => {
  it("matches every recorded checksum", () => {
    const sourceDir = resolve(root, "docs/source-of-truth/v1.0.0");
    const manifest = readFileSync(resolve(sourceDir, "SHA256SUMS"), "utf8").trim().split("\n");
    expect(manifest).toHaveLength(18);
    for (const line of manifest) {
      const [expected, relative] = line.split(/\s+/, 2);
      const contents = readFileSync(resolve(root, relative));
      expect(createHash("sha256").update(contents).digest("hex")).toBe(expected);
    }
    expect(readdirSync(sourceDir).filter((name) => name !== "SHA256SUMS")).toHaveLength(18);
  });
});
