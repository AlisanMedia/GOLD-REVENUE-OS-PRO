import { signOut } from "@/app/(auth)/login/actions";
import { requireUserContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const { user, tenants } = await requireUserContext();
  const tenant = tenants[0]!;
  const supabase = await createSupabaseServerClient();
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const assuranceLevel = assurance?.currentLevel?.toUpperCase() ?? "AAL1";

  return (
    <main className="admin-main">
      <p className="eyebrow">PHASE 2 · CUSTOMER OS</p>
      <h1>Customer control plane ready.</h1>
      <p className="lede">The central customer record is tenant-scoped, auditable and prepared for safe import review.</p>
      <section className="status-grid" aria-label="Foundation status">
        <article className="status-card"><span>Tenant boundary</span><strong>{tenant.slug}</strong></article>
        <article className="status-card"><span>Access role</span><strong>{tenant.role.replace("_", " ")}</strong></article>
        <article className="status-card"><span>Session assurance</span><strong>{assuranceLevel}</strong></article>
      </section>
      <div className="identity-row"><span>Signed in as {user.email ?? user.id}</span><form action={signOut}><button className="secondary-button" type="submit">Sign out</button></form></div>
    </main>
  );
}
