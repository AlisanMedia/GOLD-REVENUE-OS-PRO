import Link from "next/link";
import { T, AdminNumber } from "./admin-i18n";
import { entitlementHref, type EntitlementCursor } from "../lib/entitlements/read-model";
import type { EntitlementReadFailure } from "../lib/entitlements/admin";

export function EntitlementReadError({ error, href }: { error: EntitlementReadFailure; href: string }) {
  return <section className="detail-card case-section" role="alert"><p><T k={error === "cursor" ? "This page link is invalid or expired. Refresh the list." : "Entitlement records could not be loaded. No empty result is assumed."}/></p>
    <Link className="table-link" href={href}><T k="Refresh records"/></Link></section>;
}
export function EntitlementPagination({ path, size, customer, evidence, next, hasMore, count, continued = false }: {
  path: string; size: string; customer?: string | undefined; evidence?: string | undefined;
  next: EntitlementCursor | null; hasMore: boolean; count: number; continued?: boolean | undefined;
}) {
  const first = entitlementHref(path, { size, customer, evidence });
  return <section className="case-section">
    <p className="muted"><T k="Records may change while browsing. Refresh to include new records and current statuses."/></p>
    <nav className="pagination" aria-labelledby="entitlement-pagination-title" style={{ flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
      <span id="entitlement-pagination-title" hidden><T k="Subscription evidence"/></span>
      <Link style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }} href={first}><T k={continued ? "First page / refresh" : "Refresh records"}/></Link>
      <span role="status"><AdminNumber value={count}/> · <T k={hasMore ? "More records available" : "End of current results"}/></span>
      {hasMore && next && <Link style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }} className="table-link" href={entitlementHref(path, { size, customer, evidence, cursor: next })}><T k="Next records"/> →</Link>}
    </nav>
  </section>;
}
