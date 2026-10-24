import{requirePolatRead}from "@/lib/polat/admin";
export default async function PolatOperationsLayout({children}:{children:React.ReactNode}){await requirePolatRead();return children;}
