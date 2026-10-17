import { requireAdminCapability } from "@/lib/admin/server";
import { surveyWorkspace } from "@/lib/surveys/server";
import { SurveyBoundary,SurveyBuilder,SurveyTabs } from "@/components/surveys/admin";
export default async function NewSurveyPage(){await requireAdminCapability("surveys.manage");const {data}=await surveyWorkspace();return <main className="admin-main"><SurveyBoundary enabled={data.sandbox_enabled}/><SurveyTabs active="surveys"/><SurveyBuilder enabled={data.sandbox_enabled} canManage={data.can_manage}/></main>;}
