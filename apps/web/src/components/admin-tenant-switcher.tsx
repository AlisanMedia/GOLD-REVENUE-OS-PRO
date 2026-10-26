import type { AdminLocale } from "../lib/i18n/core";
export function AdminTenantSwitcher({ locale, tenants, selectedId }: { locale: AdminLocale; tenants: ReadonlyArray<{ id: string; name: string }>; selectedId: string }) {
  if (tenants.length < 2) return null;
  const tr = locale === "tr-TR";
  return <form action="/api/v1/admin/workspace" method="post" className="tenant-switcher"><label htmlFor="admin-workspace-select" className="sr-only">{tr ? "Çalışma alanı" : "Workspace"}</label><select id="admin-workspace-select" name="tenant_id" defaultValue={selectedId}>{tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><button type="submit" className="secondary-button">{tr ? "Geç" : "Switch"}</button></form>;
}
