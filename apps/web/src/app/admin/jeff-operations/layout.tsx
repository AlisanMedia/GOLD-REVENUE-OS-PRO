import{requireJeffRead}from "@/lib/jeff/admin";
export default async function JeffOperationsLayout({children}:{children:React.ReactNode}){await requireJeffRead();return children;}
