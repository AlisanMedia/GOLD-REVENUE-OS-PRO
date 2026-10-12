function display(value:unknown):string{
 if(value===null)return "Not specified";
 if(Array.isArray(value))return value.length?value.map(display).join("; "):"None configured";
 if(typeof value==="object")return Object.entries(value as Record<string,unknown>).map(([k,v])=>k.replaceAll("_"," ")+": "+display(v)).join("; ");
 return String(value);
}
export default function CommercialPreview({payload}:{payload:Record<string,unknown>}){return <dl className="commercial-preview">{Object.entries(payload).map(([k,v])=><div key={k}><dt><strong>{k.replaceAll("_"," ")}</strong></dt><dd>{display(v)}</dd></div>)}</dl>;}
