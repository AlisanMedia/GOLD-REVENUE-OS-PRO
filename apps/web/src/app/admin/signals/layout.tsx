import { requireSignalRead } from "@/lib/signals/admin";
// Match the accepted Analytics boundary: authorize before this segment's loading/Suspense UI.
export default async function SignalOperationsLayout({children}:{children:React.ReactNode}){
 await requireSignalRead();
 return children;
}
