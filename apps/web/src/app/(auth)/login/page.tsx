import Link from "next/link";
import { signIn } from "./actions";

const errors: Record<string, string> = {
  missing: "Enter both your email and password.",
  invalid: "The credentials could not be verified.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; mfa_recovery?: string }> }) {
  const { error, mfa_recovery } = await searchParams;
  const recovery = mfa_recovery === "1";
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">SECURE ADMIN</p>
        <h1 id="login-title">Sign in</h1>
        <p className="lede">Access is limited to invited operators with an active tenant membership.</p>
        {recovery ? <p>Sign in with the same account to authorize recovery of an unfinished MFA setup. This does not remove a factor or verify MFA.</p> : null}
        {error && errors[error] ? <p className="error-banner" role="alert">{errors[error]}</p> : null}
        <form className="form-stack" action={signIn}>
          {recovery ? <input type="hidden" name="mfa_recovery" value="1"/> : null}
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="primary-button" type="submit">Sign in</button>
        </form>
        <p className="phase-note"><Link href="/">← Gold Revenue OS</Link></p>
      </section>
    </main>
  );
}
