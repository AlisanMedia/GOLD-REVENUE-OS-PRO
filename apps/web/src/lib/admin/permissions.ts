import type { AppRole } from "@gold-revenue-os/contracts";

export const ADMIN_CAPABILITIES = [
  "dashboard.read",
  "customers.list",
  "customers.detail",
  "customers.identities",
  "customers.transition",
  "events.read",
  "attention.read",
  "imports.read",
  "imports.review",
  "audit.read",
  "health.read",
  "messaging.read",
  "messaging.send",
  "messaging.kill_switch",
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

const ROLE_CAPABILITIES: Readonly<Record<AppRole, ReadonlySet<AdminCapability>>> = {
  super_admin: new Set(ADMIN_CAPABILITIES),
  manager: new Set(ADMIN_CAPABILITIES),
  support: new Set([
    "dashboard.read", "customers.list", "customers.detail",
    "customers.identities", "attention.read", "messaging.read", "messaging.send",
  ]),
  analyst: new Set([
    "dashboard.read", "customers.list", "customers.detail",
    "events.read", "attention.read", "health.read",
  ]),
  readonly: new Set(["dashboard.read", "customers.list", "customers.detail"]),
};

export function hasAdminCapability(role: AppRole, capability: AdminCapability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function visibleAdminCapabilities(role: AppRole): readonly AdminCapability[] {
  return ADMIN_CAPABILITIES.filter((capability) => hasAdminCapability(role, capability));
}
