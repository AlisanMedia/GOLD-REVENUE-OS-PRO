import{PolatOperationsView}from "@/components/polat-operations";
import{polatOperations,requirePolatRead}from "@/lib/polat/admin";
import{polatSearchSchema}from "@/lib/polat/read-model";
import{hasAdminCapability}from "@/lib/admin/permissions";
export default async function PolatOperationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const admin=await requirePolatRead(),raw=await searchParams;
 // Empty HTML select means all states; repeated/unknown parameters remain invalid.
 const values={...raw};if(values.state==="")delete values.state;
 const q=polatSearchSchema.safeParse(values),search=q.success?q.data:polatSearchSchema.parse({});
 const result=q.success?await polatOperations(search):{page:null,summary:null,model:null,business:null,businessError:false,businessDenied:false,error:"cursor"as const,summaryError:false};
 return <PolatOperationsView search={search} result={result} canConversation={hasAdminCapability(admin.role,"messaging.read")} canCase={hasAdminCapability(admin.role,"escalations.read")}/>;
}
