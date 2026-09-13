import { requireUserContext } from "@/lib/auth/context";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { tenants } = await requireUserContext();
  const tenant = tenants[0]!;
  return (
    <div className="admin-grid">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark" aria-hidden="true">G</div><span>Gold Revenue OS</span></div>
        <p className="tenant-label">Operational workspace</p>
        <nav aria-label="Admin navigation"><a className="nav-item" href="/admin">Foundation status</a></nav>
        <p className="sidebar-footer">{tenant.name}<br />{tenant.role.replace("_", " ")}</p>
      </aside>
      {children}
    </div>
  );
}
