"use client";
import { useAdminI18n } from "../../../components/admin-i18n";
export default function SuccessError({reset}:{reset:()=>void}) {const {t}=useAdminI18n();return <main className="admin-main"><div className="case-panel"><h1>{t("Customer Success is unavailable")}</h1><p>{t("The operation could not be confirmed. Check the latest state.")}</p><button className="secondary-button" onClick={reset}>{t("Yeniden Dene")}</button></div></main>;}
