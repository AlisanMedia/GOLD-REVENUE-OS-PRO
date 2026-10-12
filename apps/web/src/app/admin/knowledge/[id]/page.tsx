import CommercialDetail from "@/components/commercial-detail";
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{error?:string}>}){return <CommercialDetail knowledge id={(await params).id} error={(await searchParams).error??""}/>;}
