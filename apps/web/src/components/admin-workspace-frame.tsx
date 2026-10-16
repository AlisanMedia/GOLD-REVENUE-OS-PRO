import { AdminFormValidation } from "./admin-form-validation";
import { signOut } from "@/app/(auth)/login/actions";
import { AdminI18nProvider } from "./admin-i18n";
import { AdminLanguageSwitcher } from "./admin-language-switcher";
import { MobileNavigation, NavigationItems } from "./admin-navigation";
import Link from "next/link";
import type { AppRole } from "@gold-revenue-os/contracts";
import { translator, type AdminLocale } from "../lib/i18n/core";
export function AdminWorkspaceFrame({children,locale,tenantName,userLabel,role}:{children:React.ReactNode;locale:AdminLocale;tenantName:string;userLabel:string;role:AppRole}) {
 const t=translator(locale);
 const roleLabel=locale==="tr-TR"?({super_admin:"Sistem yöneticisi",manager:"Yönetici",support:"Destek",analyst:"Analist",readonly:"Görüntüleyici"})[role]:({super_admin:"System administrator",manager:"Manager",support:"Support",analyst:"Analyst",readonly:"Viewer"})[role];
 return <AdminI18nProvider locale={locale}><AdminFormValidation><div className="admin-shell" lang={locale}><a className="skip-link" href="#admin-content">{t("Skip to content")}</a><aside className="sidebar"><Link className="sidebar-brand" href="/admin"><span className="brand-mark" aria-hidden="true">G</span><span>Gold Revenue <b>OS</b><small>{t("Operations workspace")}</small></span></Link><div className="workspace-block"><span>{t("Aktif Marka")}</span><strong>{tenantName}</strong><span className="workspace-environment">STAGING · TEST</span></div><NavigationItems role={role}/><div className="sidebar-footer"><strong>{roleLabel}</strong><small>{userLabel}</small></div></aside><div className="admin-workspace"><header className="topbar"><div><MobileNavigation role={role} tenantName={tenantName}/><span className="environment-badge">STAGING</span><span className="topbar-tenant">{tenantName}</span></div><div className="topbar-user"><AdminLanguageSwitcher/><span className="topbar-role">{roleLabel}</span><form action={signOut}><button className="text-button" type="submit">{t("Çıkış Yap")}</button></form></div></header><div id="admin-content" tabIndex={-1}>{children}</div></div></div></AdminFormValidation></AdminI18nProvider>;
}
