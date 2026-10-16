import { z } from "zod";
import { notFound } from "next/navigation";
import { successDetail,successList } from "@/lib/customer-success/server";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { SuccessTaskDetail } from "@/components/customer-success-views";
export default async function CustomerSuccessDetail({params}:{params:Promise<{id:string}>}) {const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();const result=await successDetail(id);if(!result.data)notFound();const list=await successList({customer:result.data.task.customer_id});return <SuccessTaskDetail data={result.data} userId={result.context.userId} canManage={hasAdminCapability(result.context.role,"success.manage")&&list.sandbox_enabled} managers={list.managers}/>;}
