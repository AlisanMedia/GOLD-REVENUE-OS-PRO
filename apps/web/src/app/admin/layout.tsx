import { signOut } from "@/app/(auth)/login/actions";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { requireUserContext } from "@/lib/auth/context";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, tenants } = await requireUserContext();
  const tenant = tenants[0]!;
  const roleLabel = ({ super_admin: "Sistem Yöneticisi", manager: "Yönetici", support: "Destek", analyst: "Analist", readonly: "Görüntüleyici" })[tenant.role];
  const nav = [
    { href: "/admin", label: "Genel Bakış", capability: "dashboard.read" as const },
    { href: "/admin/customers", label: "Müşteriler", capability: "customers.list" as const },
    { href: "/admin/attention", label: "İnceleme Merkezi", capability: "attention.read" as const },
    { href: "/admin/conversations", label: "Görüşmeler", capability: "messaging.read" as const },
    { href: "/admin/imports", label: "İçe Aktarma İncelemesi", capability: "imports.read" as const },
    { href: "/admin/events", label: "İşlem Kayıtları", capability: "events.read" as const },
    { href: "/admin/agents", label: "Yapay Zekâ Yönetimi", capability: "agents.read" as const },
    { href: "/admin/agent-quality", label: "Yanıt Kalitesi", capability: "agents.read" as const },
    { href: "/admin/catalog",label:"Ürünler ve Fiyatlar",capability:"commercial.read" as const },
    { href: "/admin/knowledge",label:"Bilgi Bankası",capability:"commercial.read" as const },
    { href: "/admin/offers",label:"Teklifler",capability:"commercial.read" as const },
    { href: "/admin/payments", label: "Ödemeler", capability: "payments.read" as const },
    { href: "/admin/subscriptions", label: "Abonelikler", capability: "entitlements.read" as const },
    { href: "/admin/channel-access", label: "Kanal Erişimi", capability: "entitlements.read" as const },
    { href: "/admin/audit", label: "Denetim Kaydı", capability: "audit.read" as const },
    { href: "/admin/system", label: "Sistem Durumu", capability: "health.read" as const },
  ];
  return <div className="admin-shell" lang="tr">
    <aside className="sidebar">
      <Link className="sidebar-brand" href="/admin"><span className="brand-mark" aria-hidden="true">G</span><span>Gold Revenue OS</span></Link>
      <div className="workspace-block"><span>Aktif Marka</span><strong>{tenant.name}</strong><small>{tenant.slug}</small></div>
      <nav aria-label="Yönetim menüsü">{nav.filter((item) => hasAdminCapability(tenant.role, item.capability)).map((item) => <Link className="nav-item" href={item.href} key={item.href}>{item.label}</Link>)}</nav>
      <div className="sidebar-footer"><span>{roleLabel}</span><small>{user.email ?? user.id}</small></div>
    </aside>
    <div className="admin-workspace">
      <header className="topbar"><div><span className="environment-badge">STAGING</span><span className="topbar-tenant">{tenant.name}</span></div><div className="topbar-user"><span>{user.email ?? user.id}</span><strong>{roleLabel}</strong><form action={signOut}><button className="text-button" type="submit">Çıkış Yap</button></form></div></header>
      {children}
    </div>
  </div>;
}
