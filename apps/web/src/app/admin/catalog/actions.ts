"use server";
import {requireAdminCapability} from "@/lib/admin/server";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {commercialPayload} from "@gold-revenue-os/domain";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
const value=(f:FormData,k:string)=>String(f.get(k)??"").trim();
const optional=(f:FormData,k:string)=>value(f,k)||null;
const lines=(f:FormData,k:string)=>value(f,k).split(/\r?\n/u).map(x=>x.trim()).filter(Boolean);
export async function saveCommercial(f:FormData){
 const c=await requireAdminCapability("commercial.write"),kind=value(f,"kind"),root=kind==="knowledge"?"/admin/knowledge":"/admin/catalog";
 const base={title:value(f,"title"),locale:value(f,"locale"),source:value(f,"source")};
 const payload=kind==="product"?{...base,description:value(f,"description"),service_rights:value(f,"service_rights")}:kind==="plan"?{...base,product_id:value(f,"product_id"),amount:value(f,"amount"),currency:value(f,"currency"),duration_unit:value(f,"duration_unit"),duration_count:Number(value(f,"duration_count")),billing:value(f,"billing"),inclusions:lines(f,"inclusions"),restrictions:lines(f,"restrictions"),terms:value(f,"terms"),eligibility:{instrument:optional(f,"instrument"),experience_level:optional(f,"experience_level"),actively_trades:value(f,"actively_trades")===""?null:value(f,"actively_trades")==="true"},max_discount_bps:Number(value(f,"max_discount_bps")),trial:f.get("trial")==="on",offer_valid_hours:Number(value(f,"offer_valid_hours")),tax_rule:optional(f,"tax_rule"),renewal_rule:optional(f,"renewal_rule"),cancellation_rule:optional(f,"cancellation_rule"),disclosures:lines(f,"disclosures")}:{...base,content:value(f,"content"),category:value(f,"category"),plan_id:optional(f,"plan_id"),declared_amount:optional(f,"declared_amount"),declared_currency:optional(f,"declared_currency")};
 const parsed=(()=>{try{return commercialPayload(kind,payload);}catch{return null;}})();
 if(!parsed)redirect(root+"?error=invalid");
 const db=await createSupabaseServerClient();
 const {data,error}=await db.rpc("admin_save_commercial",{target_tenant_id:c.tenantId,kind_value:kind,payload_value:parsed,item_id_value:optional(f,"item_id"),effective_from_value:value(f,"effective_from")?new Date(value(f,"effective_from")).toISOString():new Date().toISOString(),expires_at_value:value(f,"expires_at")?new Date(value(f,"expires_at")).toISOString():null,test_conversation_value:f.get("test_only")==="on"?"67aad0a3-6c20-4a34-8263-b87d6d151420":null});
 if(error)redirect(root+"?error="+encodeURIComponent(error.code??"save"));
 revalidatePath(root);redirect(root+"/"+String(data.item_id));
}
export async function reviewCommercial(f:FormData){
 const c=await requireAdminCapability("commercial.write"),db=await createSupabaseServerClient(),root=value(f,"kind")==="knowledge"?"/admin/knowledge":"/admin/catalog";
 const action=value(f,"action"),id=value(f,"version_id");
 const {error}=action==="restore"?await db.rpc("admin_restore_commercial",{target_tenant_id:c.tenantId,target_version_id:id}):await db.rpc("admin_review_commercial",{target_tenant_id:c.tenantId,target_version_id:id,action_value:action});
 revalidatePath(root);redirect(root+"/"+value(f,"item_id")+(error?"?error="+encodeURIComponent(error.code??"review"):""));
}
