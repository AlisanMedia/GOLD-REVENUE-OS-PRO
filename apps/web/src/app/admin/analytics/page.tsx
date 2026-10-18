import {analyticsPage} from "@/lib/analytics/page";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){return analyticsPage("overview",await searchParams);}
