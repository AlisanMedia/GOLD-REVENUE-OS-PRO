import { SignalOperationsView } from "@/components/signal-operations";
import { requireSignalRead,signalOperations } from "@/lib/signals/admin";
import { signalSearchSchema } from "@/lib/signals/read-model";
export default async function SignalOperationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 await requireSignalRead();
 const parsed=signalSearchSchema.safeParse(await searchParams);
 if(!parsed.success)return <SignalOperationsView query={{collection:"deliveries",size:"25"}} page={null} summary={null} error="cursor"/>;
 const q=parsed.data;
 const result=await signalOperations(q);return <SignalOperationsView query={q} {...result}/>;
}
