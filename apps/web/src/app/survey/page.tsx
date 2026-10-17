import { SurveyExperience } from "@/components/surveys/customer-form";
import { notFound } from "next/navigation";
export const dynamic="force-dynamic";
export const metadata={title:"Your feedback · Gold Revenue OS",robots:{index:false,follow:false},referrer:"no-referrer" as const};
export default function SurveyPage(){if(process.env.SURVEY_SANDBOX_FORMS_ENABLED!=="true")notFound();return <SurveyExperience/>;}
