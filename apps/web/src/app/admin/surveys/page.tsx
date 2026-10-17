import { surveyWorkspace } from "@/lib/surveys/server";
import { SurveyList,SurveyPolicy } from "@/components/surveys/admin";
export default async function SurveysPage(){const {data}=await surveyWorkspace();return <main className="admin-main"><SurveyList data={data}/><SurveyPolicy key={data.settings?.revision??0} data={data}/></main>;}
