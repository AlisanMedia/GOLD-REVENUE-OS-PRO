import { T } from "../../../../components/admin-i18n";
import {requireAdminCapability} from "@/lib/admin/server";
import {commercialList} from "@/lib/commercial/admin";
import CommercialEditor from "@/components/commercial-editor";
export default async function Page(){await requireAdminCapability("commercial.write");return <main className="admin-main"><h1><T k="Add knowledge"/></h1><CommercialEditor kind="knowledge" plans={await commercialList("plan")}/></main>;}
