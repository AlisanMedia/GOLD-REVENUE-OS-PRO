"use server";
import { z } from "zod";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runTestEntitlementCycle } from "@/lib/entitlements/service";
const text=(f:FormData,k:string)=>String(f.get(k)??"");
export async function subscriptionControl(f:FormData){const c=await requireAdminCapability("entitlements.manage"),db=await createSupabaseServerClient();const id=z.uuid().parse(text(f,"subscription_id"));const {error}=await db.rpc("admin_subscription_control",{target_tenant_id:c.tenantId,target_subscription_id:id,action_value:z.enum(["hold","suspend","cancel","release","reconcile","revoke"]).parse(text(f,"action")),request_id_value:z.uuid().parse(text(f,"request_id"))});if(error)redirect("/admin/subscriptions?error=control");revalidatePath("/admin/subscriptions");revalidatePath("/admin/channel-access");}
export async function testSubscription(f:FormData){const c=await requireAdminCapability("entitlements.manage"),db=await createSupabaseServerClient();const {error}=await db.rpc("admin_create_test_subscription",{target_tenant_id:c.tenantId,target_invoice_id:z.uuid().parse(text(f,"invoice_id"))});if(error)redirect("/admin/subscriptions?error=test");revalidatePath("/admin/subscriptions");}
export async function requestAccess(f:FormData){const c=await requireAdminCapability("entitlements.manage"),db=await createSupabaseServerClient();const {error}=await db.rpc("admin_request_entitlement_access",{target_tenant_id:c.tenantId,target_subscription_id:z.uuid().parse(text(f,"subscription_id"))});if(error)redirect("/admin/channel-access?error=access");revalidatePath("/admin/channel-access");}
export async function testAccessCycle(){const c=await requireAdminCapability("entitlements.manage");await runTestEntitlementCycle(c.tenantId);revalidatePath("/admin/channel-access");}
