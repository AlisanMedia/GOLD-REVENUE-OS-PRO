import{JeffOperationsView}from "@/components/jeff-operations";
import{jeffOperations,requireJeffRead}from "@/lib/jeff/admin";
import{jeffSearchSchema}from "@/lib/jeff/read-model";
import{hasAdminCapability}from "@/lib/admin/permissions";
export default async function JeffOperationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const admin=await requireJeffRead(),raw=await searchParams;
 // Empty HTML select means all states; repeated/unknown parameters remain invalid.
 const values={...raw};if(values.state==="")delete values.state;
 const q=jeffSearchSchema.safeParse(values),search=q.success?q.data:jeffSearchSchema.parse({});
 const result=q.success?await jeffOperations(search):{page:null,summary:null,model:null,business:null,businessError:false,businessDenied:false,error:"cursor"as const,summaryError:false};
 return <JeffOperationsView search={search} result={result} canConversation={hasAdminCapability(admin.role,"messaging.read")} canCase={hasAdminCapability(admin.role,"escalations.read")}/>;
}
