import { z } from "zod";
import { notFound } from "next/navigation";
import { surveyWorkspace } from "@/lib/surveys/server";
import { SurveyBoundary,SurveyBuilder,SurveyTabs,SurveyTestControls } from "@/components/surveys/admin";
import { T,AdminDate } from "@/components/admin-i18n";
export default async function SurveyDetailPage({params}:{params:Promise<{id:string}>}){const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();const {data}=await surveyWorkspace(id),version=data.versions[0];if(!version)notFound();return <main className="admin-main"><SurveyBoundary enabled={data.sandbox_enabled}/><SurveyTabs active="surveys"/><SurveyBuilder key={`${version.id}:${version.revision}`} version={version} enabled={data.sandbox_enabled} canManage={data.can_manage}/><SurveyTestControls key={data.contacts.map(c=>c.consent_revision).join("-")} data={data} version={version}/><details className="detail-card"><summary><T k="Audit history"/></summary>{data.history.map((h,i)=><p key={i}><AdminDate value={h.created_at}/> · <code>{h.action}</code></p>)}</details></main>;}
