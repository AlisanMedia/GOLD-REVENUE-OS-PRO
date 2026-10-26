import { describe, expect, it } from "vitest";
import { selectAuthorizedTenant, tenantSelectionValue } from "../../apps/web/src/lib/auth/tenant-selection";
import type { TenantSummary } from "@gold-revenue-os/contracts";
const user = "b0a00000-0000-4000-8000-000000000001", other = "b0a00000-0000-4000-8000-000000000002";
const tenants: TenantSummary[] = [{ id: "b0a00000-0000-4000-8000-000000000011", name: "Existing", slug: "existing", role: "support" }, { id: "b0a00000-0000-4000-8000-000000000012", name: "Private Beta", slug: "private-beta-fixture", role: "manager" }];
describe("membership-authoritative Admin workspace selection", () => {
  it("selects only an actual active membership without changing its role", () => {
    const selected = selectAuthorizedTenant(tenants, user, tenantSelectionValue(user, tenants[1]!.id));
    expect(selected[0]).toEqual(tenants[1]); expect(selected[0]?.role).toBe("manager"); expect(tenants[0]?.role).toBe("support");
  });
  it("cannot grant a foreign tenant or cross authenticated user preferences", () => {
    expect(selectAuthorizedTenant(tenants, user, tenantSelectionValue(user, other))).toBe(tenants);
    expect(selectAuthorizedTenant(tenants, other, tenantSelectionValue(user, tenants[1]!.id))).toBe(tenants);
  });
  it("loses preference immediately when membership is revoked", () => {
    expect(selectAuthorizedTenant(tenants.slice(0, 1), user, tenantSelectionValue(user, tenants[1]!.id))[0]).toEqual(tenants[0]);
  });
  it("rejects tampered/oversized authority-bearing cookie shapes", () => {
    for (const raw of ["bad", "x".repeat(241), JSON.stringify({ user_id: user, tenant_id: tenants[1]!.id, role: "super_admin" })]) expect(selectAuthorizedTenant(tenants, user, raw)).toBe(tenants);
  });
});
