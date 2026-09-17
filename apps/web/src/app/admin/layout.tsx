import { signOut } from "@/app/(auth)/login/actions";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { requireUserContext } from "@/lib/auth/context";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, tenants } = await requireUserContext();
  const tenant = tenants[0]!;
  const nav = [
    { href: "/admin", label: "Dashboard", capability: "dashboard.read" as const },
    { href: "/admin/customers", label: "Customers", capability: "customers.list" as const },
    { href: "/admin/attention", label: "Needs attention", capability: "attention.read" as const },
    { href: "/admin/conversations", label: "Conversations", capability: "messaging.read" as const },
    { href: "/admin/imports", label: "Import review", capability: "imports.read" as const },
    { href: "/admin/events", label: "Event operations", capability: "events.read" as const },
    { href: "/admin/audit", label: "Audit log", capability: "audit.read" as const },
    { href: "/admin/system", label: "System health", capability: "health.read" as const },
  ];
  return <div className="admin-shell">
    <aside className="sidebar">
      <Link className="sidebar-brand" href="/admin"><span className="brand-mark" aria-hidden="true">G</span><span>Gold Revenue OS</span></Link>
      <div className="workspace-block"><span>Active tenant</span><strong>{tenant.name}</strong><small>{tenant.slug}</small></div>
      <nav aria-label="Admin navigation">{nav.filter((item) => hasAdminCapability(tenant.role, item.capability)).map((item) => <Link className="nav-item" href={item.href} key={item.href}>{item.label}</Link>)}</nav>
      <div className="sidebar-footer"><span>{tenant.role.replaceAll("_", " ")}</span><small>{user.email ?? user.id}</small></div>
    </aside>
    <div className="admin-workspace">
      <header className="topbar"><div><span className="environment-badge">STAGING</span><span className="topbar-tenant">{tenant.name}</span></div><div className="topbar-user"><span>{user.email ?? user.id}</span><strong>{tenant.role.replaceAll("_", " ")}</strong><form action={signOut}><button className="text-button" type="submit">Sign out</button></form></div></header>
      {children}
    </div>
  </div>;
}
