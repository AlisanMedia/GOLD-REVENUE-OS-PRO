import {requireAdminCapability} from "@/lib/admin/server";
// Gate the subtree before its loading boundary; no financial skeleton/data for denied roles.
export default async function AnalyticsLayout({children}:{children:React.ReactNode}){await requireAdminCapability("analytics.read");return children;}
