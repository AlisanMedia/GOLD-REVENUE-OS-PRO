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
 return <main className="admin-main"><Link href={root}>← {knowledge?"Knowledge Base":"Products & Pricing"}</Link><h1>{String(item.payload.title)}</h1>
 {error&&<p role="alert">Operation rejected ({error}). Review eligibility, dates, publication status and pricing conflicts.</p>}
 <p>{item.kind} · {item.archived_at?"ARCHIVED":item.status} · v{item.version}{item.test_only?" · TEST-ONLY":""}</p>
 <h2>Version preview</h2><CommercialPreview payload={latest.payload}/>
 {canWrite&&<><h2>Edit as a new draft</h2><CommercialEditor kind={item.kind} item={item} products={products} plans={plans}/></>}
 <h2>Version / review / publication history</h2>
 <div className="table-scroll"><table><thead><tr><th>Version / status</th><th>Creator / reviewer</th><th>Effective / expiry</th><th>Actions</th></tr></thead><tbody>{history.map(v=><tr key={v.id}><td>v{v.version} · {v.status}<details><summary>Preview</summary><CommercialPreview payload={v.payload}/></details></td><td>{v.created_by}<br/>{v.reviewer??"Not reviewed"}<br/>{v.reviewed_at??""}</td><td>{v.effective_from}<br/>{v.expires_at??"No configured expiry"}<br/>Published: {v.published_at??"No"}</td><td>{canWrite&&<form action={reviewCommercial}><input type="hidden" name="kind" value={item.kind}/><input type="hidden" name="item_id" value={item.id}/><input type="hidden" name="version_id" value={v.id}/>{v.status==="draft"&&<button name="action" value="approve">Approve</button>}{v.status==="approved"&&<button name="action" value="publish">Publish approved version</button>}{v.status!=="draft"&&<button name="action" value="restore">Restore as draft</button>}<button name="action" value="archive">Archive / deactivate</button></form>}</td></tr>)}</tbody></table></div>
 <Link href="/admin/audit">Publication and offer audit log</Link></main>;
}
