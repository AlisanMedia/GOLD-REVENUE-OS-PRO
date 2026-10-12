import {KB_CATEGORIES,COMMERCIAL_LOCALES} from "@gold-revenue-os/domain";
import {saveCommercial} from "@/app/admin/catalog/actions";
import type {CommercialRow} from "@/lib/commercial/admin";
export default function CommercialEditor({kind,item,products=[],plans=[]}:{kind:string;item?:CommercialRow;products?:CommercialRow[];plans?:CommercialRow[]}){
 const p=item?.payload??{},str=(k:string)=>String(p[k]??""),arr=(k:string)=>Array.isArray(p[k])?(p[k] as string[]).join("\n"):"";
 const eligibility=(p.eligibility??{}) as Record<string,unknown>;
 return <form action={saveCommercial} className="commercial-form">
 <input type="hidden" name="kind" value={kind}/><input type="hidden" name="item_id" value={item?.id??""}/>
 <label>Title<input name="title" required maxLength={120} defaultValue={str("title")}/></label>
 <label>Language<select name="locale" defaultValue={str("locale")||"en"}>{COMMERCIAL_LOCALES.map(l=><option key={l}>{l}</option>)}</select></label>
 <label>Source / provenance<textarea name="source" required maxLength={1200} defaultValue={str("source")}/></label>
 {kind==="product"?<>
 <label>Description<textarea name="description" required defaultValue={str("description")}/></label>
 <label>Verified service / reseller rights<textarea name="service_rights" required defaultValue={str("service_rights")}/></label>
 </>:kind==="plan"?<>
 <label>Product<select name="product_id" required defaultValue={str("product_id")}><option value="">Select product</option>{products.map(x=><option value={x.id} key={x.id}>{String(x.payload.title)}{x.test_only?" · TEST-ONLY":""}</option>)}</select></label>
 <label>Exact price<input name="amount" required inputMode="decimal" placeholder="79.00" defaultValue={str("amount")}/></label>
 <label>ISO currency<input name="currency" required pattern="[A-Z]{3}" defaultValue={str("currency")}/></label>
 <label>Duration<select name="duration_unit" defaultValue={str("duration_unit")||"fixed_days"}><option value="fixed_days">Fixed days</option><option value="calendar_month">Calendar months</option><option value="calendar_year">Calendar years</option></select></label>
 <label>Duration count<input type="number" name="duration_count" required min="1" max="366" defaultValue={str("duration_count")||"1"}/></label>
 <label>Billing rule<select name="billing" defaultValue={str("billing")||"unknown"}><option value="unknown">Not specified</option><option value="one_off">One-off membership</option><option value="recurring">Recurring (only if approved)</option></select></label>
 {["inclusions","restrictions","disclosures"].map(k=><label key={k}>{k} (one per line)<textarea name={k} defaultValue={arr(k)}/></label>)}
 <label>Approved terms<textarea name="terms" required defaultValue={str("terms")}/></label>
 <fieldset><legend>Verified eligibility restrictions (blank = no configured restriction)</legend>
 <label>Instrument<input name="instrument" defaultValue={String(eligibility.instrument??"")}/></label>
 <label>Experience<input name="experience_level" defaultValue={String(eligibility.experience_level??"")}/></label>
 <label>Actively trades<select name="actively_trades" defaultValue={eligibility.actively_trades===null||eligibility.actively_trades===undefined?"":String(eligibility.actively_trades)}><option value="">No restriction</option><option value="true">Yes, explicitly evidenced</option><option value="false">No, explicitly evidenced</option></select></label></fieldset>
 <label>Maximum discount (basis points; 100 = 1%)<input type="number" name="max_discount_bps" min="0" max="10000" defaultValue={str("max_discount_bps")||"0"}/></label>
 <label>Offer validity (hours)<input type="number" name="offer_valid_hours" min="1" max="168" defaultValue={str("offer_valid_hours")||"24"}/></label>
 <label><input type="checkbox" name="trial" defaultChecked={p.trial===true}/>Approved trial offering (no access grant)</label>
 {["tax_rule","renewal_rule","cancellation_rule"].map(k=><label key={k}>{k} (blank = unknown)<textarea name={k} defaultValue={str(k)}/></label>)}
 </>:<>
 <label>Category<select name="category" defaultValue={str("category")||"FAQ"}>{KB_CATEGORIES.map(k=><option key={k}>{k}</option>)}</select></label>
 <label>Approved explanatory content<textarea name="content" required maxLength={1200} defaultValue={str("content")}/></label>
 <label>Related plan<select name="plan_id" defaultValue={str("plan_id")}><option value="">None</option>{plans.map(x=><option value={x.id} key={x.id}>{String(x.payload.title)}</option>)}</select></label>
 <label>Declared amount (required for Pricing)<input name="declared_amount" defaultValue={str("declared_amount")}/></label>
 <label>Declared ISO currency<input name="declared_currency" defaultValue={str("declared_currency")}/></label>
 </>}
 <label>Effective date/time (UTC)<input type="datetime-local" step="1" name="effective_from" defaultValue={new Date().toISOString().slice(0,19)} required/></label>
 <label>Expiry (UTC, optional)<input type="datetime-local" name="expires_at"/></label>
 {!item&&<label><input type="checkbox" name="test_only"/>TEST-ONLY — isolated authorized staging conversation</label>}
 <p>Saving creates an unpublished version. Review the preview, approve, then publish. Unknown taxes, renewal and cancellation stay unknown.</p>
 <button type="submit">Save draft</button></form>;
}
