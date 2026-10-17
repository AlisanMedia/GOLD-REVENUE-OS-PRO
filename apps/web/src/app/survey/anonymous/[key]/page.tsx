import { SurveyExperience } from "@/components/surveys/customer-form";
import { notFound } from "next/navigation";
import { z } from "zod";
export const dynamic="force-dynamic";
export const metadata={title:"Anonymous feedback · Gold Revenue OS",robots:{index:false,follow:false},referrer:"no-referrer" as const};
export default async function AnonymousSurveyPage({params}:{params:Promise<{key:string}>}){const {key}=await params;if(process.env.SURVEY_SANDBOX_FORMS_ENABLED!=="true"||!z.uuid().safeParse(key).success)notFound();return <SurveyExperience anonymousKey={key}/>;}
