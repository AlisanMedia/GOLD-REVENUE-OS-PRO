import { T } from "../../../../components/admin-i18n";
import {requireAdminCapability} from "@/lib/admin/server";
import {commercialList} from "@/lib/commercial/admin";
import CommercialEditor from "@/components/commercial-editor";
export default async function NewCatalogPage({searchParams}:{searchParams:Promise<{kind?:string}>}){
 await requireAdminCapability("commercial.write");const {kind}=await searchParams;
 return <main className="admin-main"><h1><T k="Create"/> {kind==="plan"?<T k="membership plan"/>:<T k="product"/>}</h1><CommercialEditor kind={kind==="plan"?"plan":"product"} products={await commercialList("product")}/></main>;
}
