import{z}from "zod";
import{POLAT_INBOUND_STATES,polatInboundPageSchema,polatSummarySchema,polatModelSummarySchema}from "@gold-revenue-os/contracts";
export{polatInboundPageSchema,polatSummarySchema,polatModelSummarySchema};
export const polatSearchSchema=z.strictObject({view:z.enum(["responses","business","model","experiments"]).default("responses"),days:z.enum(["7","30","90"]).default("30"),mode:z.enum(["LIVE","SANDBOX"]).default("LIVE"),state:z.enum(POLAT_INBOUND_STATES).optional(),conversation:z.uuid().optional(),size:z.enum(["25","50","100"]).default("25"),cursor:z.string().min(1).max(4096).optional()});
export type PolatSearch=z.infer<typeof polatSearchSchema>;
const cursorSchema=z.strictObject({v:z.literal(1),tenant:z.uuid(),user:z.uuid(),role:z.enum(["super_admin","manager","support","analyst"]),conversation:z.uuid().nullable(),state:z.enum(POLAT_INBOUND_STATES).nullable(),size:z.number().int().min(1).max(100),generation:z.string().regex(/^[0-9]{1,19}$/u),anchor:z.string().regex(/^[0-9]{1,19}$/u),before:z.string().regex(/^[1-9][0-9]{0,18}$/u),expires:z.iso.datetime({offset:true})});
export function polatCursor(raw:string){return cursorSchema.parse(JSON.parse(raw));}
export function polatHref(q:PolatSearch,cursor?:Record<string,unknown>){const p=new URLSearchParams({view:q.view,days:q.days,mode:q.mode,size:q.size});if(q.state)p.set("state",q.state);if(q.conversation)p.set("conversation",q.conversation);if(cursor)p.set("cursor",JSON.stringify(cursor));return `/admin/polat-operations?${p}`;}
export function polatPeriod(days:PolatSearch["days"],now=new Date()){const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1));return{start:new Date(+end-Number(days)*86400000).toISOString().slice(0,10),end:end.toISOString().slice(0,10)};}
