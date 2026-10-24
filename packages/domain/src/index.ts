export type Role = "super_admin" | "manager" | "support" | "analyst" | "readonly";
export type Permission = "admin.access" | "audit.read" | "tenant.read";

const permissions: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  super_admin: new Set(["admin.access", "audit.read", "tenant.read"]),
  manager: new Set(["admin.access", "audit.read", "tenant.read"]),
  support: new Set(["admin.access", "tenant.read"]),
  analyst: new Set(["admin.access", "tenant.read"]),
  readonly: new Set(["admin.access", "tenant.read"]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissions[role].has(permission);
}

export function canAccessTenant(
  requestedTenantId: string,
  memberships: readonly { tenantId: string; role: Role; active: boolean }[],
): boolean {
  return memberships.some(({ tenantId, active }) => active && tenantId === requestedTenantId);
}

export * from "./customer-os";
export * from "./state-event-engine";

export * from "./messaging";
export * from "./agent-runtime";
export * from "./conversation-quality";

export * from "./conversation-evidence";
export * from "./evidence-handles";
export * from "./speech-acts";
export * from "./lead-intelligence";
export * from "./commercial";

export * from "./payments";

export * from "./subscriptions";
export * from "./escalations";
export * from "./surveys";
export * from "./analytics";
export * from "./financial-source";
export * from "./financial-source-canonical";
export * from "./financial-evidence";
export * from "./signals";

export * from "./signal-commerce";
export * from "./signal-distribution";

export * from "./signal-recovery";
