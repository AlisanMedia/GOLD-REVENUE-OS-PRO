import { SurveyMonthFilter } from "@/components/surveys/month-filter";
import { surveyWorkspace } from "@/lib/surveys/server";
import { SurveyBoundary,SurveyImprovementQueue,SurveyTabs } from "@/components/surveys/admin";
import { getAdminI18n } from "@/lib/i18n/server";
export default async function InsightsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const raw=await searchParams,month=typeof raw.month==="string"&&/^\d{4}-\d{2}$/.test(raw.month)?raw.month+"-01":undefined;const [{data},{t}]=await Promise.all([surveyWorkspace(undefined,month),getAdminI18n()]);return <main className="admin-main"><p className="eyebrow">GOLD REVENUE OS</p><h1>{t("Improvement queue")}</h1><p className="lede">{t("Review the source evidence and propose a specific, approved service improvement.")}</p><SurveyBoundary enabled={data.sandbox_enabled}/><SurveyTabs active="insights"/><SurveyMonthFilter month={data.month}/><SurveyImprovementQueue data={data}/></main>;}
