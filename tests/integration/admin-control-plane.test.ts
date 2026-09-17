import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasAdminCapability, visibleAdminCapabilities } from "../../apps/web/src/lib/admin/permissions";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Phase 4 role matrix", () => {
  it("allows management capabilities and keeps non-management roles read-only", () => {
    for (const role of ["super_admin", "manager"] as const) {
      expect(hasAdminCapability(role, "customers.transition")).toBe(true);
      expect(hasAdminCapability(role, "imports.review")).toBe(true);
      expect(hasAdminCapability(role, "audit.read")).toBe(true);
    }
    for (const role of ["support", "analyst", "readonly"] as const) {
      expect(hasAdminCapability(role, "customers.transition")).toBe(false);
      expect(hasAdminCapability(role, "imports.review")).toBe(false);
      expect(hasAdminCapability(role, "audit.read")).toBe(false);
    }
  });

  it("limits operational PII and event views by role", () => {
    expect(hasAdminCapability("support", "customers.identities")).toBe(true);
    expect(hasAdminCapability("support", "events.read")).toBe(false);
    expect(hasAdminCapability("analyst", "customers.identities")).toBe(false);
    expect(hasAdminCapability("analyst", "events.read")).toBe(true);
    expect(visibleAdminCapabilities("readonly")).toEqual(["dashboard.read", "customers.list", "customers.detail"]);
  });
});

describe("Phase 4 application security contracts", () => {
  it("uses server-side bounded customer and event queries", () => {
    const adminServer = read("apps/web/src/lib/admin/server.ts");
    const customer360 = read("apps/web/src/lib/customer-os/server.ts");
    expect(adminServer).toContain('rpc("admin_customer_list"');
    expect(adminServer).toContain('rpc("admin_event_list"');
    expect(customer360).toContain(".limit(100)");
    expect(customer360).not.toMatch(/domain_events[^\n]+payload/);
  });

  it("guards routes and mutations with backend capabilities or role checks", () => {
    expect(read("apps/web/src/app/admin/layout.tsx")).toContain("hasAdminCapability");
    expect(read("apps/web/src/app/api/v1/customers/[id]/state/route.ts")).toContain('requireCustomerTenant(["super_admin", "manager"])');
    expect(read("apps/web/src/app/api/v1/imports/[id]/commit/route.ts")).toContain("IMPORT_EXECUTION_LOCKED");
    expect(read("apps/web/src/app/api/v1/imports/[id]/commit/route.ts")).toContain("status: 423");
  });

  it("does not ship fake revenue metrics or privileged browser credentials", () => {
    const dashboard = read("apps/web/src/app/admin/page.tsx");
    expect(dashboard).toContain("Not available yet");
    expect(dashboard).not.toMatch(/hardcoded|demo revenue|fake/i);
    for (const path of [
      "apps/web/src/app/admin/page.tsx",
      "apps/web/src/app/admin/customers/page.tsx",
      "apps/web/src/components/manual-state-transition.tsx",
    ]) {
      expect(read(path)).not.toMatch(/NEXT_PUBLIC_(?:SUPABASE_)?(?:SERVICE_ROLE|SECRET)/);
    }
  });

  it("keeps financial and access edges out of the manual transition UI", () => {
    const page = read("apps/web/src/app/admin/customers/[id]/page.tsx");
    expect(page).not.toMatch(/state:\s*"(?:PAYMENT_PENDING|PAID|ACCESS_GRANTED|ACTIVE|RENEWAL_DUE|RENEWED)"/);
    expect(page).toContain("Manual state transition");
  });
});
