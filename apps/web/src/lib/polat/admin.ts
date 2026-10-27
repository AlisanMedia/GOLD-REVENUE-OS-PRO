import "server-only";
import{cache}from "react";
import{requireAdminCapability}from "@/lib/admin/server";
import{hasAdminCapability}from "@/lib/admin/permissions";
import{createSupabaseServerClient}from "@/lib/supabase/server";
import{analyticsWorkspace}from "@/lib/analytics/server";
import{polatCrmMetricEvidence}from "@gold-revenue-os/domain";
import{polatSearchSchema,polatCursor,polatPeriod,polatInboundPageSchema,polatSummarySchema,polatModelSummarySchema,type PolatSearch}from "./read-model";
import { experimentPageSchema, experimentCursor, type ExperimentPage } from "./experiment-read";
import { privateBetaCursor, privateBetaNotesCursor, parsePrivateBetaNotesPage, parsePrivateBetaWorkspace, parsePrivateBetaOperators, parsePrivateBetaBusinessScope, parsePrivateBetaBusinessDiscovery, type PrivateBetaWorkspace, type PrivateBetaNotesPage, type PrivateBetaBusinessScope, type PrivateBetaBusinessDiscovery } from "./private-beta-read";
const readContext=cache(async()=>({context:await requireAdminCapability("agents.read"),db:await createSupabaseServerClient()}));
export async function requirePolatRead(){return(await readContext()).context;}
export async function polatOperations(input:PolatSearch){
 const{context,db}=await readContext();let q:PolatSearch,cursor=null;
 try{q=polatSearchSchema.parse(input);cursor=q.cursor?(q.view==="experiments"?experimentCursor(q.cursor):q.view==="beta"?q.beta_collection==="notes"?privateBetaNotesCursor(q.cursor):privateBetaCursor(q.cursor):polatCursor(q.cursor)):null;}catch{return{page:null,summary:null,model:null,business:null,businessError:false,businessDenied:false,error:"cursor"as const,summaryError:false};}
 if(q.view==="beta"){
  if(!["super_admin","manager","support"].includes(context.role))return{page:null,summary:null,model:null,business:null,businessError:false,businessDenied:false,error:null,summaryError:false,beta:null,betaDenied:true};
  let beta:PrivateBetaWorkspace|null=null;let error:"cursor"|"unavailable"|null=null;
  try{const result=await db.rpc("admin_private_beta_workspace_v1",{target_tenant_id:context.tenantId,page_size_value:Number(q.size),cursor_value:q.beta_collection==="notes"?null:cursor});if(result.error)error=result.error.code==="22023"?"cursor":"unavailable";else{const parsed=parsePrivateBetaWorkspace(result.data);if(parsed.page_size!==Number(q.size))throw Error("BETA_PAGE_SIZE");beta=parsed;}}catch{error="unavailable";}
  let betaNotes:PrivateBetaNotesPage|null=null;
  if(beta?.program&&q.beta_collection==="notes"){
   try{const result=await db.rpc("admin_private_beta_notes_page_v1",{target_tenant_id:context.tenantId,page_size_value:Number(q.size),cursor_value:cursor});if(result.error)error=result.error.code==="22023"?"cursor":"unavailable";else{const parsed=parsePrivateBetaNotesPage(result.data);if(parsed.page_size!==Number(q.size)||parsed.program_id!==beta.program.id||parsed.program_generation!==beta.program.generation)error="cursor";else betaNotes=parsed;}}catch{error="unavailable";}
  }
  let betaOperators:{id:string;role:string;current:boolean}[]|null=null;
  if(beta&&context.role==="super_admin"&&(!beta.program||beta.program.stage==="DRAFT")){
   try{const members=await db.from("tenant_members").select("user_id,role").eq("tenant_id",context.tenantId).eq("status","active").in("role",["super_admin","manager"]).order("user_id").limit(100);if(!members.error)betaOperators=parsePrivateBetaOperators(members.data,context.userId);}catch{betaOperators=null;}
  }
  let betaBusinessScope:PrivateBetaBusinessScope|null=null,betaBusinessUnavailable=false;
  let betaBusinessDiscovery:PrivateBetaBusinessDiscovery|null=null,betaBusinessDiscoveryUnavailable=false;
  if(beta?.program&&context.role==="super_admin"){
   try{const result=await db.rpc("admin_private_beta_business_scope_v1",{target_tenant_id:context.tenantId,program_id_value:beta.program.id});if(result.error)betaBusinessUnavailable=true;else betaBusinessScope=parsePrivateBetaBusinessScope(result.data,beta.program.id,beta.program.generation);}catch{betaBusinessUnavailable=true;}
  }
  if(beta?.program?.stage==="DRAFT"&&context.role==="super_admin"){
   try{const result=await db.rpc("admin_private_beta_business_discovery_v1",{target_tenant_id:context.tenantId,program_id_value:beta.program.id});if(result.error)betaBusinessDiscoveryUnavailable=true;else betaBusinessDiscovery=parsePrivateBetaBusinessDiscovery(result.data,{tenantId:context.tenantId,programId:beta.program.id,generation:beta.program.generation,repositorySha:beta.program.repository_sha});}catch{betaBusinessDiscoveryUnavailable=true;}
  }
  return{page:null,summary:null,model:null,business:null,businessError:false,businessDenied:false,error,summaryError:false,beta,betaNotes,betaBusinessScope,betaBusinessUnavailable,betaBusinessDiscovery,betaBusinessDiscoveryUnavailable,betaDenied:false,betaCanConfigure:context.role==="super_admin",betaCanNote:["super_admin","manager","support"].includes(context.role),betaCanAcceptOperator:["super_admin","manager"].includes(context.role),betaStarsCommandId:context.role==="super_admin"&&beta?.program?crypto.randomUUID():null,betaOperators};
 }
 if(q.view==="experiments"){
  let experiments:ExperimentPage|null=null;let error:"cursor"|"unavailable"|null=null;
  try{const result=await db.rpc("admin_polat_experiment_page_v1",{target_tenant_id:context.tenantId,page_size_value:Number(q.size),cursor_value:cursor});const parsed=experimentPageSchema.safeParse(result.data);if(!result.error&&parsed.success&&parsed.data.page_size===Number(q.size))experiments=parsed.data;else error=result.error?.code==="22023"?"cursor":"unavailable";}catch{error="unavailable";}
  return{page:null,summary:null,model:null,business:null,businessError:false,businessDenied:false,error,summaryError:false,experiments};
 }
 if(q.view==="business"){
  if(!hasAdminCapability(context.role,"analytics.read"))return{page:null,summary:null,model:null,business:null,businessError:false,businessDenied:true,error:null,summaryError:false};
  try{const{data}=await analyticsWorkspace({...polatPeriod(q.days),mode:q.mode});return{page:null,summary:null,model:null,business:polatCrmMetricEvidence(data),businessError:false,businessDenied:false,error:null,summaryError:false};}catch{return{page:null,summary:null,model:null,business:null,businessError:true,businessDenied:false,error:null,summaryError:false};}
 }
 if(q.view==="model"){
  const range=polatPeriod(q.days);try{const{data,error}=await db.rpc("admin_polat_model_summary_v1",{target_tenant_id:context.tenantId,start_value:range.start,end_value:range.end});const v=polatModelSummarySchema.safeParse(data);return{page:null,summary:null,model:!error&&v.success?v.data:null,business:null,businessError:false,businessDenied:false,error:null,summaryError:!!error||!v.success};}catch{return{page:null,summary:null,model:null,business:null,businessError:false,businessDenied:false,error:null,summaryError:true};}
 }
 const rpc=async(name:string,args:Record<string,unknown>)=>Promise.resolve(db.rpc(name,args)).catch(()=>({data:null,error:{code:"READ_UNAVAILABLE"}}));
 const range=polatPeriod(q.days);const[rows,summary]=await Promise.all([rpc("admin_polat_inbound_page_v1",{target_tenant_id:context.tenantId,conversation_value:q.conversation??null,state_value:q.state??null,page_size_value:Number(q.size),cursor_value:cursor}),rpc("admin_polat_response_summary_v1",{target_tenant_id:context.tenantId,start_value:range.start,end_value:range.end})]);
 const p=polatInboundPageSchema.safeParse(rows.data),s=polatSummarySchema.safeParse(summary.data);const page=!rows.error&&p.success&&p.data.page_size===Number(q.size)?p.data:null;
 return{page,model:null,summary:!summary.error&&s.success?s.data:null,business:null,businessError:false,businessDenied:false,error:page?null:rows.error?.code==="22023"?"cursor"as const:"unavailable"as const,summaryError:!!summary.error||!s.success};
}
export type PolatOperations=Awaited<ReturnType<typeof polatOperations>>;
