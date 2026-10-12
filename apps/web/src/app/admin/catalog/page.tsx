import Link from "next/link";
import {commercialList} from "@/lib/commercial/admin";
import {requireAdminCapability} from "@/lib/admin/server";
import {hasAdminCapability} from "@/lib/admin/permissions";
export default async function CatalogPage({searchParams}:{searchParams:Promise<{error?:string}>}){
 const c=await requireAdminCapability("commercial.read"),[products,plans]=await Promise.all([commercialList("product"),commercialList("plan")]),{error}=await searchParams;
 return <main className="admin-main"><p className="eyebrow">COMMERCIAL CATALOG</p><h1>Products & Pricing</h1><p>Only published, currently effective offerings are available to customer conversations. Drafts remain private.</p>
 {error&&<p role="alert">Draft rejected ({error}). Check all required fields, dates and approved commercial content.</p>}
 {hasAdminCapability(c.role,"commercial.write")&&<div className="commercial-links"><Link href="/admin/catalog/new?kind=product">Create product</Link><Link href="/admin/catalog/new?kind=plan">Create membership plan</Link></div>}
 {(["Products","Membership plans"] as const).map((title,index)=><section key={title}><h2>{title}</h2><div className="table-scroll"><table><thead><tr><th>Name</th><th>Published current price</th><th>Duration</th><th>Status / version</th><th>Validity</th></tr></thead><tbody>{(index?plans:products).map(x=><tr key={x.id}><td><Link href={"/admin/catalog/"+x.id}>{String(x.payload.title)}</Link>{x.test_only&&<strong> · TEST-ONLY</strong>}</td><td>{x.current_price?.amount??"Unavailable"} {x.current_price?.currency??""}{x.status!=="published"&&<small>Draft: {String(x.payload.amount??"—")} {String(x.payload.currency??"")}</small>}</td><td>{String(x.payload.duration_count??"")} {String(x.payload.duration_unit??"")}</td><td>{x.archived_at?"archived":x.status} · v{x.version}</td><td>{x.effective_from}<br/>{x.expires_at??"No configured expiry"}</td></tr>)}</tbody></table></div></section>)}</main>;
}
