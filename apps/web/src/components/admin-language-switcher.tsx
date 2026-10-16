"use client";
import { useActionState } from "react";
import { changeAdminLocale } from "@/app/admin/preferences/actions";
import { useAdminI18n } from "./admin-i18n";
export function AdminLanguageSwitcher() {
  const { locale, t } = useAdminI18n();
  const [state, action, pending] = useActionState(changeAdminLocale, "");
  return <form action={action} className="locale-switcher"><label><span className="sr-only">{t("Panel language")}</span><select aria-label={t("Panel language")} name="locale" defaultValue={locale} disabled={pending} onChange={e => e.currentTarget.form?.requestSubmit()}><option value="tr-TR">Türkçe</option><option value="en-US">English</option></select></label><noscript><button type="submit">{t("Apply")}</button></noscript>{state === "SAVE_FAILED" || state === "INVALID_LOCALE" ? <span role="alert">{t("Language could not be saved. Try again.")}</span> : null}{pending ? <span role="status" className="sr-only">{t("Saving…")}</span> : null}</form>;
}
