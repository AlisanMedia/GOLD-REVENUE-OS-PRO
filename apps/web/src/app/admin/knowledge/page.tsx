import { T, AdminDate } from "../../../components/admin-i18n";
import Link from "next/link";
import {KB_CATEGORIES} from "@gold-revenue-os/domain";
import {commercialList} from "@/lib/commercial/admin";
import {requireAdminCapability} from "@/lib/admin/server";
import {hasAdminCapability} from "@/lib/admin/permissions";
export default async function KnowledgePage({searchParams}:{searchParams:Promise<{q?:string;category?:string;error?:string}>}){
 const c=await requireAdminCapability("commercial.read"),s=await searchParams,items=await commercialList("knowledge",s.q,s.category);
 return <main className="admin-main"><p className="eyebrow"><T k="APPROVED BUSINESS KNOWLEDGE"/></p><h1><T k="Knowledge Base"/></h1><p><T k="Owner-reviewed explanations and policies. Structured catalog prices remain authoritative."/></p>{s.error&&<p role="alert"><T k="Entry rejected ("/>{s.error}<T k="). Check required fields, source and safe content."/></p>}
 {hasAdminCapability(c.role,"commercial.write")&&<Link href="/admin/knowledge/new"><T k="Add knowledge"/></Link>}
 <form className="commercial-links"><label><T k="Search"/><input name="q" defaultValue={s.q}/></label><label><T k="Category"/><select name="category" defaultValue={s.category}><option value=""><T k="All"/></option>{KB_CATEGORIES.map(k=><option key={k}>{k}</option>)}</select></label><button><T k="Search"/></button></form>
 <div className="table-scroll"><table><thead><tr><th><T k="Title"/></th><th><T k="Category / language"/></th><th><T k="Status / version"/></th><th><T k="Source / effective date"/></th></tr></thead><tbody>{items.map(x=><tr key={x.id}><td><Link href={"/admin/knowledge/"+x.id}>{String(x.payload.title)}</Link>{x.test_only?" · TEST-ONLY":""}</td><td>{String(x.payload.category)} / {String(x.payload.locale)}</td><td>{x.archived_at?<T k="archived"/>:x.status} <T k="· v"/>{x.version}</td><td>{String(x.payload.source)}<br/>{<AdminDate value={x.effective_from}/>}</td></tr>)}</tbody></table></div></main>;
}
