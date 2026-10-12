import Link from "next/link";
import {KB_CATEGORIES} from "@gold-revenue-os/domain";
import {commercialList} from "@/lib/commercial/admin";
import {requireAdminCapability} from "@/lib/admin/server";
import {hasAdminCapability} from "@/lib/admin/permissions";
export default async function KnowledgePage({searchParams}:{searchParams:Promise<{q?:string;category?:string;error?:string}>}){
 const c=await requireAdminCapability("commercial.read"),s=await searchParams,items=await commercialList("knowledge",s.q,s.category);
 return <main className="admin-main"><p className="eyebrow">APPROVED BUSINESS KNOWLEDGE</p><h1>Knowledge Base</h1><p>Owner-reviewed explanations and policies. Structured catalog prices remain authoritative.</p>{s.error&&<p role="alert">Entry rejected ({s.error}). Check required fields, source and safe content.</p>}
 {hasAdminCapability(c.role,"commercial.write")&&<Link href="/admin/knowledge/new">Add knowledge</Link>}
 <form className="commercial-links"><label>Search<input name="q" defaultValue={s.q}/></label><label>Category<select name="category" defaultValue={s.category}><option value="">All</option>{KB_CATEGORIES.map(k=><option key={k}>{k}</option>)}</select></label><button>Search</button></form>
 <div className="table-scroll"><table><thead><tr><th>Title</th><th>Category / language</th><th>Status / version</th><th>Source / effective date</th></tr></thead><tbody>{items.map(x=><tr key={x.id}><td><Link href={"/admin/knowledge/"+x.id}>{String(x.payload.title)}</Link>{x.test_only?" · TEST-ONLY":""}</td><td>{String(x.payload.category)} / {String(x.payload.locale)}</td><td>{x.archived_at?"archived":x.status} · v{x.version}</td><td>{String(x.payload.source)}<br/>{x.effective_from}</td></tr>)}</tbody></table></div></main>;
}
