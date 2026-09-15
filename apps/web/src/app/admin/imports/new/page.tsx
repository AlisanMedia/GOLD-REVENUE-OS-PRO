import { requireCustomerTenant } from "@/lib/customer-os/server";
import ImportUpload from "@/components/import-upload";
import Link from "next/link";

export default async function NewImportPage() {
  await requireCustomerTenant(["super_admin", "manager"]);
  return <main className="admin-main"><Link className="back-link" href="/admin/imports">← Import batches</Link><p className="eyebrow">DRY-RUN ONLY</p><h1>Prepare an import</h1><p className="lede">Upload a CSV or XLSX file. No customer mutation is executed; the result is a reconciliation report for explicit review.</p><ImportUpload /></main>;
}
