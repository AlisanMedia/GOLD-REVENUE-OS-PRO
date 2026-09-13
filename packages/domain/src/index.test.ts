import { describe, expect, it } from "vitest";
import { canAccessTenant, hasPermission } from "./index";

describe("foundation authorization", () => {
  it("does not grant audit access to non-management roles", () => {
    expect(hasPermission("support", "audit.read")).toBe(false);
    expect(hasPermission("analyst", "audit.read")).toBe(false);
    expect(hasPermission("readonly", "audit.read")).toBe(false);
  });

  it("requires an active membership for the requested tenant", () => {
    const memberships = [
      { tenantId: "tenant-a", role: "manager" as const, active: true },
      { tenantId: "tenant-b", role: "readonly" as const, active: false },
    ];
    expect(canAccessTenant("tenant-a", memberships)).toBe(true);
    expect(canAccessTenant("tenant-b", memberships)).toBe(false);
    expect(canAccessTenant("tenant-c", memberships)).toBe(false);
  });
});
