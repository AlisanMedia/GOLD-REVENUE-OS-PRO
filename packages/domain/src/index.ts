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
export * from "./telegram-delivery-evidence";
export * from "./telegram-operational-capability";
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

export * from "./signal-parser";

export * from "./signal-wave";

export * from "./signal-review";
export * from "./jeff-conversation";
export * from "./jeff-private-beta-runtime";
export * from "./jeff-response";

export * from "./jeff-sales";
export * from "./campaign";
export * from "./campaign-import";

export * from "./jeff-evaluation";
export * from "./jeff-contact";
export * from "./jeff-runtime-profile";
export * from "./jeff-multiturn-corpus";
export * from "./jeff-multiturn-evaluation";

export * from "./jeff-model-evaluation";

export * from "./jeff-model-acceptance";

export * from "./jeff-multiturn-v2-corpus";
export * from "./jeff-multiturn-v2-evaluation";

export * from "./jeff-human-review";
export * from "./jeff-human-review-form";

export * from "./jeff-campaign-runtime";
export * from "./telegram-stars-commerce";
