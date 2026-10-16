"use client";
import { createContext, useContext } from "react";
import { formatPlanDuration, formatCount, formatDate, formatDecimal, formatDuration, formatNumber, operatorText, translator, type AdminLocale, type CopyKey } from "../lib/i18n/core";
import { enumLabel } from "../lib/i18n/labels";
const LocaleContext = createContext<AdminLocale>("tr-TR");
export function AdminI18nProvider({ locale, children }: { locale: AdminLocale; children: React.ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}
export function useAdminI18n() { const locale = useContext(LocaleContext); return { locale, t: translator(locale) }; }
export function T({ k }: { k: CopyKey }) { return useAdminI18n().t(k); }
export function OperatorText({value}:{value:string}) {const {locale}=useAdminI18n();return operatorText(value,locale);}
export function AdminDate({value}:{value:string|null|undefined}) {return formatDate(useAdminI18n().locale,value);}
export function AdminNumber({value}:{value:number}) {return formatNumber(useAdminI18n().locale,value);}
export function AdminEnum({value}:{value:string}) {return enumLabel(value,useAdminI18n().locale);}
export function AdminDuration({seconds}:{seconds:number}) {const {locale}=useAdminI18n();return formatDuration(locale,seconds);}
export function AdminDecimal({value}:{value:string}) {return formatDecimal(useAdminI18n().locale,value);}
export function AdminCount({value,kind}:{value:number;kind:"tasks"|"records"|"conversations"|"events"}) {return formatCount(useAdminI18n().locale,value,kind);}
export function CustomerPreviewBoundary({children}:{children:React.ReactNode}) {const {t}=useAdminI18n();return <section className="customer-preview-boundary"><p className="muted">{t("Customer preview · English default. Original content is not translated.")}</p><div lang="en">{children}</div></section>;}
export function AdminPlanDuration({count,unit}:{count:unknown;unit:unknown}) {return formatPlanDuration(useAdminI18n().locale,count,unit);}
