import {requireAdminCapability} from "@/lib/admin/server";
import {commercialList} from "@/lib/commercial/admin";
import CommercialEditor from "@/components/commercial-editor";
export default async function NewCatalogPage({searchParams}:{searchParams:Promise<{kind?:string}>}){
 await requireAdminCapability("commercial.write");const {kind}=await searchParams;
 return <main className="admin-main"><h1>Create {kind==="plan"?"membership plan":"product"}</h1><CommercialEditor kind={kind==="plan"?"plan":"product"} products={await commercialList("product")}/></main>;
}
