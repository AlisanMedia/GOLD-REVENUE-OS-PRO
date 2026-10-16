import { copy } from "./dictionary";
export type AdminLocale = "tr-TR" | "en-US";
export type CopyKey = keyof typeof copy;
export function adminLocale(value: unknown): AdminLocale { return value === "en-US" ? "en-US" : "tr-TR"; }
export function translator(locale: AdminLocale) {
  return (key: CopyKey): string => copy[key][locale === "tr-TR" ? 0 : 1];
}
export function formatNumber(locale: AdminLocale, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
export function formatDate(locale: AdminLocale, value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}
export function formatDuration(locale: AdminLocale, seconds: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const tr = locale === "tr-TR";
  if (tr) {
    if (n < 60) return "1 dakikadan az";
    if (n < 3600) return `${formatNumber(locale,Math.floor(n/60))} dakika`;
    if (n < 86400) return `${formatNumber(locale,Math.floor(n/3600))} saat${n%3600>=60?` ${formatNumber(locale,Math.floor(n%3600/60))} dakika`:""}`;
    return `${formatNumber(locale,Math.floor(n/86400))} gün${n%86400>=3600?` ${formatNumber(locale,Math.floor(n%86400/3600))} saat`:""}`;
  }
  if (n < 60) return `${formatNumber(locale,n)} sec`;
  if (n < 3600) return `${formatNumber(locale,Math.floor(n/60))} min`;
  if (n < 86400) return `${formatNumber(locale,Math.floor(n/3600))} hr`;
  const days=Math.floor(n/86400);return `${formatNumber(locale,days)} ${days===1?"day":"days"}`;
}
// Only for existing trusted UI helper output. Never apply to customer-supplied content.
export function operatorText(value:string,locale:AdminLocale):string {return Object.hasOwn(copy,value)?translator(locale)(value as CopyKey):locale==="en-US"&&/^Yönetici · [A-F0-9]{6}$/u.test(value)?value.replace("Yönetici", "Manager"):value;}
// Exact decimal strings retain financial precision; grouping never converts to Number.
export function formatDecimal(locale:AdminLocale,value:string):string {
 if(!/^-?\d+(?:\.\d+)?$/u.test(value))return value;
 const [whole,fraction]=value.split(".");
 const grouped=(value.startsWith("-")&&BigInt(whole!)===0n?"-":"")+new Intl.NumberFormat(locale).format(BigInt(whole!));
 return fraction?`${grouped}${locale==="tr-TR"?",":"."}${fraction}`:grouped;
}
export function formatCount(locale:AdminLocale,value:number,kind:"tasks"|"records"|"conversations"|"events"):string {
 const words={tasks:["görev","task","tasks"],records:["kayıt","record","records"],conversations:["görüşme","conversation","conversations"],events:["işlem","event","events"]} as const;
 const noun=words[kind][locale==="tr-TR"?0:new Intl.PluralRules(locale).select(value)==="one"?1:2];return `${formatNumber(locale,value)} ${noun}`;
}
export function formatPlanDuration(locale:AdminLocale,count:unknown,unit:unknown):string {
 if(typeof count!=="number"||!Number.isFinite(count))return "—";
 const units:Record<string,string>={fixed_days:"day",calendar_month:"month",calendar_year:"year"};
 const value=typeof unit==="string"&&Object.hasOwn(units,unit)?units[unit]:null;
 return value?new Intl.NumberFormat(locale,{style:"unit",unit:value,unitDisplay:"long"}).format(count):"—";
}
