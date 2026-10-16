import { T, AdminEnum, AdminDate } from "./admin-i18n";
import Link from "next/link";
import {commercialHistory,commercialList} from "@/lib/commercial/admin";
import {requireAdminCapability} from "@/lib/admin/server";
import {hasAdminCapability} from "@/lib/admin/permissions";
import {reviewCommercial} from "@/app/admin/catalog/actions";
import CommercialEditor from "./commercial-editor";
import CommercialPreview from "./commercial-preview";
export default async function CommercialDetail({id,knowledge=false,error=""}:{id:string;knowledge?:boolean;error?:string}){
 const c=await requireAdminCapability("commercial.read");
 const [history,products,plans,entries]=await Promise.all([commercialHistory(id),commercialList("product"),commercialList("plan"),commercialList("knowledge")]),latest=history[0]!;
 const item=[...products,...plans,...entries].find(i=>i.id===id);if(!item)throw new Error("Item unavailable");
 const root=knowledge?"/admin/knowledge":"/admin/catalog",canWrite=hasAdminCapability(c.role,"commercial.write");
 return <main className="admin-main"><Link href={root}>← {knowledge?<T k="Knowledge Base"/>:<T k="Products & Pricing"/>}</Link><h1>{String(item.payload.title)}</h1>
 {error&&<p role="alert"><T k="Operation rejected ("/>{error}<T k="). Review eligibility, dates, publication status and pricing conflicts."/></p>}
 <p>{item.kind} · {item.archived_at?<T k="ARCHIVED"/>:item.status} <T k="· v"/>{item.version}{item.test_only?" · TEST-ONLY":""}</p>
 <h2><T k="Version preview"/></h2><CommercialPreview payload={latest.payload}/>
 {canWrite&&<><h2><T k="Edit as a new draft"/></h2><CommercialEditor kind={item.kind} item={item} products={products} plans={plans}/></>}
 <h2><T k="Version / review / publication history"/></h2>
 <div className="table-scroll"><table><thead><tr><th><T k="Version / status"/></th><th><T k="Creator / reviewer"/></th><th><T k="Effective / expiry"/></th><th><T k="Actions"/></th></tr></thead><tbody>{history.map(v=><tr key={v.id}><td><T k="v"/>{v.version} · {<AdminEnum value={v.status}/>}<details><summary><T k="Preview"/></summary><CommercialPreview payload={v.payload}/></details></td><td>{v.created_by}<br/>{v.reviewer??<T k="Not reviewed"/>}<br/>{v.reviewed_at??""}</td><td>{<AdminDate value={v.effective_from}/>}<br/>{v.expires_at??<T k="No configured expiry"/>}<br/><T k="Published:"/> {v.published_at??<T k="No"/>}</td><td>{canWrite&&<form action={reviewCommercial}><input type="hidden" name="kind" value={item.kind}/><input type="hidden" name="item_id" value={item.id}/><input type="hidden" name="version_id" value={v.id}/>{v.status==="draft"&&<button name="action" value="approve"><T k="Approve"/></button>}{v.status==="approved"&&<button name="action" value="publish"><T k="Publish approved version"/></button>}{v.status!=="draft"&&<button name="action" value="restore"><T k="Restore as draft"/></button>}<button name="action" value="archive"><T k="Archive / deactivate"/></button></form>}</td></tr>)}</tbody></table></div>
 <Link href="/admin/audit"><T k="Publication and offer audit log"/></Link></main>;
}
