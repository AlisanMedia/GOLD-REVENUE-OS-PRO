import { requireUserContext } from "@/lib/auth/context";
import { getAdminI18n } from "@/lib/i18n/server";
import { AdminWorkspaceFrame } from "@/components/admin-workspace-frame";
export const dynamic="force-dynamic";
export default async function AdminLayout({children}:{children:React.ReactNode}) {
 const [{user,tenants},{locale}]=await Promise.all([requireUserContext(),getAdminI18n()]);const tenant=tenants[0]!;
 return <AdminWorkspaceFrame locale={locale} tenantName={tenant.name} userLabel={user.email??user.id} role={tenant.role}>{children}</AdminWorkspaceFrame>;
}
