import Link from "next/link";

export default function Home() {
  return (
    <main className="landing-shell">
      <div className="brand-mark" aria-hidden="true">G</div>
      <p className="eyebrow">GOLD REVENUE OS</p>
      <h1>Revenue operations, controlled from one foundation.</h1>
      <p className="lede">Phase 1 establishes identity, tenant isolation, permissions and auditability.</p>
      <Link className="primary-button" href="/login">Open admin</Link>
      <p className="phase-note">Foundation · Phase 1</p>
    </main>
  );
}
