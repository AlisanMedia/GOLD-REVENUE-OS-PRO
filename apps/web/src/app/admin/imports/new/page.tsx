import { T } from "../../../../components/admin-i18n";
import { requireCustomerTenant } from "@/lib/customer-os/server";
import ImportUpload from "@/components/import-upload";
import Link from "next/link";

export default async function NewImportPage() {
  await requireCustomerTenant(["super_admin", "manager"]);
  return <main className="admin-main"><Link className="back-link" href="/admin/imports"><T k="← Import batches"/></Link><p className="eyebrow"><T k="DRY-RUN ONLY"/></p><h1><T k="Prepare an import"/></h1><p className="lede"><T k="Upload a CSV or XLSX file. No customer mutation is executed; the result is a reconciliation report for explicit review."/></p><ImportUpload /></main>;
}
