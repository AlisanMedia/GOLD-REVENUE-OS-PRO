import { getAdminI18n } from "@/lib/i18n/server";
export async function SurveyMonthFilter({month,customer}:{month:string;customer?:string|undefined}){
 const {t,locale}=await getAdminI18n(),now=new Date(),formatter=new Intl.DateTimeFormat(locale,{month:"long",year:"numeric",timeZone:"UTC"});
 const months=Array.from({length:25},(_,i)=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1)));
 return <form className="filter-bar"><label>{t("Review month")} · UTC<select name="month" defaultValue={month.slice(0,7)}>{months.map(d=><option key={d.toISOString()} value={d.toISOString().slice(0,7)}>{formatter.format(d)}</option>)}</select></label>{customer&&<input type="hidden" name="customer" value={customer}/>}<button className="secondary-button">{t("Apply filters")}</button></form>;
}
