import {ANALYTICS_SECTIONS,type AnalyticsSection} from "@gold-revenue-os/domain";
import {notFound} from "next/navigation";
import {analyticsPage} from "@/lib/analytics/page";
export default async function Page({params,searchParams}:{params:Promise<{section:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){const {section}=await params;if(!ANALYTICS_SECTIONS.includes(section as AnalyticsSection))notFound();return analyticsPage(section as AnalyticsSection,await searchParams);}
