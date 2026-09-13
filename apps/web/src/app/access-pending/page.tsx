import { signOut } from "@/app/(auth)/login/actions";

export default function AccessPendingPage() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">ACCESS PENDING</p>
        <h1>No active tenant</h1>
        <p className="lede">Your identity is valid, but an operator has not assigned an active workspace membership.</p>
        <form action={signOut}><button className="secondary-button" type="submit">Sign out</button></form>
      </section>
    </main>
  );
}
