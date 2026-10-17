import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { surveyAnswersSchema } from "@gold-revenue-os/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const access=z.union([z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),z.object({anonymous_key:z.uuid()}).strict()]);
export const publicSurveyRequest=z.discriminatedUnion("action",[
 z.object({action:z.literal("open"),access}).strict(),
 z.object({action:z.literal("complete"),access,answers:surveyAnswersSchema,processing_consent:z.literal(true),permit:z.string().max(300).optional()}).strict(),
 z.object({action:z.literal("stop"),token:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
]);
export const surveyHeaders={"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow","X-Content-Type-Options":"nosniff"};
function signingKey(){const key=process.env.CRON_SECRET?.trim();if(!key)throw Error("SURVEY_UNAVAILABLE");return createHmac("sha256",key).update("gold14-anonymous-admission-v1").digest();}
export function createAnonymousPermit(versionKey:string,now=Date.now()):string {
 const payload=`${versionKey}.${Math.floor(now/1000)+1800}.${randomBytes(24).toString("hex")}`;
 return payload+"."+createHmac("sha256",signingKey()).update(payload).digest("hex");
}
export function verifyAnonymousPermit(value:string,versionKey:string,now=Date.now()) {
 const parts=value.split("."),[key,expiry,nonce,signature]=parts;
 if(parts.length!==4||key!==versionKey||!/^\d{10}$/.test(expiry??"")||!/^[a-f0-9]{48}$/.test(nonce??"")||!/^[a-f0-9]{64}$/.test(signature??""))throw Error("SURVEY_PERMIT_INVALID");
 const time=Number(expiry)*1000;
 if(time<=now||time>now+1801000)throw Error("SURVEY_PERMIT_INVALID");
 const expected=createHmac("sha256",signingKey()).update(parts.slice(0,3).join(".")).digest();
 if(!timingSafeEqual(expected,Buffer.from(signature!,"hex")))throw Error("SURVEY_PERMIT_INVALID");
 return {hash:createHash("sha256").update(nonce!).digest("hex"),expires:new Date(time).toISOString()};
}
export async function readSurveyBody(request:Request):Promise<unknown> {
 if(request.headers.get("content-type")?.split(";")[0]!=="application/json")throw Error("SURVEY_INPUT_INVALID");
 const reader=request.body?.getReader();if(!reader)throw Error("SURVEY_INPUT_INVALID");let size=0;const chunks:Uint8Array[]=[];
 for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();throw Error("SURVEY_INPUT_TOO_LARGE");}chunks.push(part.value);}
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function surveyRequest(request:Request) {
 if(process.env.SURVEY_SANDBOX_FORMS_ENABLED!=="true")return Response.json({error:"SURVEY_UNAVAILABLE"},{status:404,headers:surveyHeaders});
 // Same-origin JSON requests only; cookies never establish survey authority.
 const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin&&origin!==`${new URL(request.url).protocol}//${request.headers.get("host")}`)return Response.json({error:"SURVEY_UNAVAILABLE"},{status:403,headers:surveyHeaders});
 try {
 const input=publicSurveyRequest.parse(await readSurveyBody(request)),db=createSupabaseAdminClient();let name:string,args:Record<string,unknown>;
 if(input.action==="stop"){name="survey_stop";args={token_value:input.token};}
 else if(input.action==="open"){name="survey_web_open";args="token" in input.access?{token_value:input.access.token}:{anonymous_key_value:input.access.anonymous_key};}
 else if("token" in input.access){name="survey_complete_identified";args={token_value:input.access.token,answers_value:input.answers};}
 else {if(!input.permit)throw Error("SURVEY_PERMIT_INVALID");const permit=verifyAnonymousPermit(input.permit,input.access.anonymous_key);name="survey_complete_anonymous";args={anonymous_key_value:input.access.anonymous_key,permit_hash_value:permit.hash,expires_value:permit.expires,answers_value:input.answers};}
 const response=await db.rpc(name,args);const data:unknown=response.data;const error=response.error;
 if(error){const code=error.code==="PT429"?429:error.code==="PT409"?409:error.code==="22023"?400:404;return Response.json({error:code===429?"SURVEY_RATE_LIMIT":code===409?"SURVEY_CHANGED":"SURVEY_UNAVAILABLE"},{status:code,headers:surveyHeaders});}
 const result=input.action==="open"&&"anonymous_key" in input.access?{...z.record(z.string(),z.unknown()).parse(data),permit:createAnonymousPermit(input.access.anonymous_key)}:data;
 return Response.json(result,{headers:surveyHeaders});
 }catch{return Response.json({error:"SURVEY_INPUT_INVALID"},{status:400,headers:surveyHeaders});}
}
