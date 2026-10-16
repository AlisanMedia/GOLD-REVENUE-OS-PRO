import { operationalDashboard } from "@/lib/customer-success/server";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { OperationalDashboard } from "@/components/operational-dashboard";
export default async function AdminDashboardPage({searchParams}:{searchParams:Promise<{days?:string}>}) {
 const {days}=await searchParams;const {data,context}=await operationalDashboard([7,30,90].includes(Number(days))?Number(days):30);
 return <OperationalDashboard data={data} canSuccess={hasAdminCapability(context.role,"success.read")} canAttention={hasAdminCapability(context.role,"attention.read")}/>;
}
