import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { normalizeSurveyTelegramUpdate, surveyDefinitionSchema, surveyTelegramPrompt } from "@gold-revenue-os/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readSurveyBody, surveyHeaders } from "@/lib/surveys/public";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
 const expected=Buffer.from(process.env.CRON_SECRET??""),actual=Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /,"")??"");
 if(!expected.length||actual.length!==expected.length||!timingSafeEqual(expected,actual))return Response.json({error:"UNAUTHORIZED"},{status:401,headers:surveyHeaders});
 if(process.env.SURVEY_SANDBOX_FORMS_ENABLED!=="true")return Response.json({error:"SURVEY_UNAVAILABLE"},{status:404,headers:surveyHeaders});
 try{const u=normalizeSurveyTelegramUpdate(await readSurveyBody(request));const db=createSupabaseAdminClient();
 const response=u.kind==="text"?await db.rpc("survey_telegram_text",{update_value:u.update,user_value:u.user,chat_value:u.chat,message_value:u.message,text_value:u.text}):await db.rpc("survey_telegram_step",{session_value:u.session,revision_value:u.revision,question_value:u.question,choice_value:u.choice.startsWith("sel_")?"select":u.choice,text_value:u.choice.startsWith("sel_")?u.choice.slice(4):null,update_value:u.update,callback_value:u.callback,user_value:u.user,chat_value:u.chat});
 const data:unknown=response.data;const error=response.error;
 const state=z.object({session:z.string(),revision:z.number(),question:z.number(),selected:z.array(z.string()),completed:z.boolean(),stopped:z.boolean(),duplicate:z.boolean().optional(),send_enabled:z.literal(false),transport:z.literal("PREVIEW"),anonymous_key:z.uuid().nullable().optional(),definition:surveyDefinitionSchema}).safeParse(data);
 const result=state.success&&!state.data.completed&&!state.data.stopped?{...state.data,prompt:surveyTelegramPrompt(state.data.definition,{...state.data,...(state.data.anonymous_key&&process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://")?{anonymousUrl:new URL(`/survey/anonymous/${state.data.anonymous_key}`,process.env.NEXT_PUBLIC_APP_URL).href}:{})})}:data;
 return Response.json(error?{error:"SURVEY_UPDATE_REJECTED"}:result,{status:error?(error.code==="PT409"?409:400):200,headers:surveyHeaders});}catch{return Response.json({error:"SURVEY_UPDATE_INVALID"},{status:400,headers:surveyHeaders});}
}
