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
  "agents.read",
  "agents.review",
  "agents.control",
  "commercial.read",
  "commercial.write",
  "payments.read",
  "payments.test",
  "entitlements.read",
  "entitlements.manage",
  "escalations.read",
  "escalations.manage",
  "success.read",
  "success.manage",
  "surveys.read",
  "surveys.manage",
  "analytics.read",
  "analytics.manage",
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

const ROLE_CAPABILITIES: Readonly<Record<AppRole, ReadonlySet<AdminCapability>>> = {
  super_admin: new Set(ADMIN_CAPABILITIES),
  manager: new Set(ADMIN_CAPABILITIES),
  support: new Set([
    "dashboard.read", "customers.list", "customers.detail",
    "customers.identities", "attention.read", "messaging.read", "messaging.send",
    "agents.read", "agents.review",
    "commercial.read", "payments.read", "entitlements.read", "escalations.read", "success.read", "surveys.read",
  ]),
  analyst: new Set([
    "dashboard.read", "customers.list", "customers.detail",
    "events.read", "attention.read", "health.read",
    "agents.read",
    "commercial.read", "payments.read", "entitlements.read", "escalations.read", "success.read", "surveys.read", "analytics.read",
  ]),
  readonly: new Set(["dashboard.read", "customers.list", "customers.detail"]),
};

export function hasAdminCapability(role: AppRole, capability: AdminCapability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function visibleAdminCapabilities(role: AppRole): readonly AdminCapability[] {
  return ADMIN_CAPABILITIES.filter((capability) => hasAdminCapability(role, capability));
}
