"use client";

import { createBrowserClient } from "@supabase/ssr";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAdminI18n } from "./admin-i18n";
import { publicEnv } from "../lib/env";
import { createPrivateBetaMfaController, submitPrivateBetaMfaRecovery, type PrivateBetaMfaFailure, type PrivateBetaMfaFactor } from "../lib/auth/private-beta-mfa";

const messages: Record<PrivateBetaMfaFailure, readonly [string, string]> = {
  UNAVAILABLE: ["Hesap güvenliği doğrulanamadı. Supabase MFA ayarını ve oturumunuzu kontrol edin; gizli bilgi paylaşmayın.", "Account security could not be verified. Check the Supabase MFA configuration and your session; do not share secrets."],
  INVALID_CODE: ["Doğrulama tamamlanmadı. Authenticator uygulamasındaki güncel altı haneli kodu kontrol edin.", "Verification did not complete. Check the current six-digit code in your authenticator app."],
  NO_FACTOR: ["Bu hesaba ait doğrulanmış authenticator seçilmedi.", "No verified authenticator belonging to this account was selected."],
  ENROLLMENT_PENDING: ["Bu hesapta tamamlanmamış bir kurulum var. Açık kurulum sekmeniz varsa oradan devam edin. Sekme kaybolduysa aşağıdaki yetkili kurtarma adımlarını kullanın. Hiçbir faktör otomatik silinmedi.", "This account has an unfinished enrollment. Continue in its setup tab if you still have it. Otherwise use the authorized recovery steps below. No factor was deleted automatically."],
  ALREADY_ENROLLED: ["Bu hesabın authenticator kaydı zaten var. Yeni kayıt oluşturmak yerine mevcut authenticator ile doğrulayın.", "This account already has an authenticator. Verify with it instead of creating another enrollment."],
  VERIFICATION_NOT_CONFIRMED: ["Güncel MFA oturumu doğrulanamadı; işlem yetkisi verilmedi. Oturumu kontrol edip yeniden doğrulayın.", "A current MFA session could not be confirmed; no operation was authorized. Check the session and verify again."],
  RECOVERY_CONFIRMATION_REQUIRED: ["Yarım kurulumu kaldırmak için açık onayınız gerekiyor.", "Explicit confirmation is required to remove the unfinished setup."],
  RECOVERY_REAUTH_REQUIRED: ["Hesap sahipliğini doğrulamak için aşağıdaki bağlantıdan aynı hesabınızla yeniden giriş yapın; ardından güvenliği kontrol edip kurtarmayı onaylayın.", "Sign in again with the same account using the link below, then check security and confirm recovery."],
  RECOVERY_BLOCKED: ["Yalnız bu kurucu hesabının tek doğrulanmamış authenticator kaydı kurtarılabilir. Doğrulanmış veya değişmiş faktörler kaldırılmaz; güvenliği yeniden kontrol edin.", "Recovery is limited to this founder account's single unverified authenticator. Verified or changed factors are protected. Check account security again."],
  RECOVERY_NOT_CONFIRMED: ["Kurtarma sonucu doğrulanamadı. Otomatik tekrar yapılmadı. Güvenliği yeniden kontrol etmeden kaldırma işlemini tekrarlamayın.", "Recovery could not be confirmed. No automatic retry was made. Check account security before attempting removal again."],
};
export function PrivateBetaMfa({ canRecover = false }: { canRecover?: boolean } = {}) {
  const { locale } = useAdminI18n(), tr = locale === "tr-TR";
  const [factors, setFactors] = useState<PrivateBetaMfaFactor[] | null>(null), [factorId, setFactorId] = useState("");
  const [setup, setSetup] = useState<{ factorId: string; qr: string | null; secret: string } | null>(null), [code, setCode] = useState("");
  const [pendingFactor, setPendingFactor] = useState<string | null>(null);
  const [unfinished, setUnfinished] = useState(false), [recoveryConfirmed, setRecoveryConfirmed] = useState(false), [recovered, setRecovered] = useState(false);
  const [busy, setBusy] = useState(false), [fresh, setFresh] = useState(false), [error, setError] = useState<PrivateBetaMfaFailure | null>(null);
  const controller = useRef<ReturnType<typeof createPrivateBetaMfaController> | null>(null);
  const privacyEpoch = useRef(0);
  useEffect(() => {
    const hide = () => { privacyEpoch.current++; setSetup(null); setCode(""); };
    const visibility = () => { if (document.visibilityState !== "visible") hide(); };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => { privacyEpoch.current++; window.removeEventListener("pagehide", hide); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  function api() {
    if (!controller.current) {
      const env = publicEnv(), client = createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { isSingleton: false, auth: { detectSessionInUrl: false } });
      controller.current = createPrivateBetaMfaController({ ...client.auth.mfa, recoverUnverifiedEnrollment: value => submitPrivateBetaMfaRecovery(value) });
    }
    return controller.current;
  }
  async function inspect() {
    if (busy) return; setBusy(true); setError(null); setCode(""); setFresh(false); setRecoveryConfirmed(false);
    try {
      const result = await api().inspect();
      if (!result.ok) { setError(result.error); return; }
      setFactors([...result.factors]); setFactorId(result.pendingEnrollment ? pendingFactor ?? result.factors[0]?.id ?? "" : result.factors[0]?.id ?? ""); setFresh(result.fresh); setUnfinished(result.pendingEnrollment); setRecoveryConfirmed(false);
      if (!result.pendingEnrollment) setPendingFactor(null);
      if (result.pendingEnrollment && !pendingFactor) setError("ENROLLMENT_PENDING");
    } catch { setError("UNAVAILABLE"); } finally { setBusy(false); }
  }
  async function enroll() {
    if (busy) return; setBusy(true); setError(null); setCode(""); setFresh(false);
    const epoch = privacyEpoch.current;
    try {
      const result = await api().enroll();
      if (!result.ok) { setError(result.error); return; }
      setSetup(epoch === privacyEpoch.current && document.visibilityState === "visible" ? { factorId: result.factorId, qr: result.qr, secret: result.secret } : null);
      setPendingFactor(result.factorId); setFactorId(result.factorId); setUnfinished(true); setRecovered(false);
    } catch { setError("UNAVAILABLE"); } finally { setBusy(false); }
  }
  async function recover() {
    if (busy) return; setBusy(true); setError(null); setSetup(null); setCode(""); setFresh(false);
    try {
      const result = await api().recover(recoveryConfirmed);
      if (!result.ok) { setError(result.error); return; }
      setPendingFactor(null); setFactorId(""); setFactors([]); setUnfinished(false); setRecoveryConfirmed(false); setRecovered(true);
    } catch { setError("RECOVERY_NOT_CONFIRMED"); } finally { setBusy(false); }
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(null); setFresh(false);
    try {
      const result = await api().verify(factorId, code); setCode("");
      if (!result.ok) { setError(result.error); return; }
      setSetup(null); setPendingFactor(null); setFresh(true); window.location.reload();
    } catch { setCode(""); setError("UNAVAILABLE"); } finally { setBusy(false); }
  }
  return <section className="detail-card" aria-labelledby="private-beta-mfa-title" aria-busy={busy}>
    <h3 id="private-beta-mfa-title">{tr ? "Bu hesabın MFA doğrulaması" : "MFA for this account"}</h3>
    <p className="muted">{tr ? "Beta yönetimi ve operatör işlemleri gerçek Supabase MFA oturumu ister. Bu ekran finansal yetki, model çalıştırma veya otomatik devralma izni vermez. Kod ve QR yalnız bu özel ekranda kalır; sohbete veya test notlarına koymayın." : "Beta administration and operator actions require a real Supabase MFA session. This screen does not grant financial, model-execution or automatic-takeover authority. Keep codes and QR setup on this private screen; do not put them in chats or test notes."}</p>
    <button type="button" className="secondary-button" onClick={() => { void inspect(); }} disabled={busy} style={{ minHeight: 44 }}>{busy ? (tr ? "Doğrulanıyor…" : "Checking…") : (tr ? "Hesap Güvenliğini Kontrol Et" : "Check Account Security")}</button>
    {fresh ? <p role="status">{tr ? "Güncel MFA oturumu görüldü. Yetki, rol ve program kapsamı işlemlerde sunucuda tekrar doğrulanır." : "A current MFA session was observed. The server revalidates authorization, role and program scope for each operation."}</p> : null}
    {recovered ? <p role="status">{tr ? "Yarım kurulum kaldırıldı. Yeni QR için Authenticator Kurulumunu Başlat seçeneğine basın. Doğrulanmış faktör kaldırılmadı." : "The unfinished setup was removed. Select Set Up Authenticator for a new QR. No verified factor was removed."}</p> : null}
    {factors !== null && !factors.length && !pendingFactor && !unfinished ? <p><button type="button" className="secondary-button" onClick={() => { void enroll(); }} disabled={busy} style={{ minHeight: 44 }}>{tr ? "Authenticator Kurulumunu Başlat" : "Set Up Authenticator"}</button><small className="muted">{tr ? "Yeni MFA faktörünü doğrulamak diğer oturumları kapatır." : "Verifying a new MFA factor signs out other sessions."}</small></p> : null}
    {setup ? <div className="flow-stack"><p>{tr ? "Authenticator uygulamanızla QR kodunu tarayın veya manuel anahtarı girin; sonra aşağıdaki kodla kurulumu tamamlayın. Kaydetmeden bu sekmeden ayrılmayın. Kurulum sırrını paylaşmayın." : "Scan the QR or enter the manual key in your authenticator, then enter its code below. Save the setup before leaving this tab. Do not share setup secrets."}</p>{setup.qr ? <Image src={setup.qr} width={220} height={220} unoptimized alt={tr ? "Özel MFA kurulum QR kodu" : "Private MFA enrollment QR"} style={{ maxWidth: "100%", height: "auto" }}/> : <p role="status">{tr ? "QR güvenli biçimde gösterilemedi. Manuel kurulum anahtarını kullanın." : "The QR could not be displayed safely. Use the manual setup key."}</p>}<details open={!setup.qr}><summary style={{ minHeight: 44, lineHeight: "44px" }}>{tr ? "QR tarayamıyorum" : "I cannot scan the QR"}</summary><p>{tr ? "Yalnız kendi authenticator uygulamanıza girin:" : "Enter only in your own authenticator app:"}</p><code style={{ overflowWrap: "anywhere" }}>{setup.secret}</code></details><button type="button" className="text-button" onClick={() => { privacyEpoch.current++; setSetup(null); setCode(""); }} disabled={busy} style={{ minHeight: 44 }}>{tr ? "Kurulum Sırrını Gizle" : "Hide Setup Secret"}</button></div> : null}
    {canRecover && unfinished && !setup && !factors?.length ? <div className="flow-stack">
      <p>{tr ? "Kurulum sekmesi kaybolduysa aynı hesapla son beş dakika içinde yeniden giriş yapın, güvenliği kontrol edin ve aşağıdan açık onay verin. Yalnız doğrulanmamış kayıt kaldırılır; oturum kapatma veya MFA doğrulamasını atlama yapılmaz." : "If the setup tab is lost, sign in again with the same account within five minutes, check security, then explicitly confirm below. Only an unverified enrollment can be removed; recovery does not sign out sessions or bypass MFA."}</p>
      <Link className="secondary-button" href="/login?mfa_recovery=1" style={{ minHeight: 44 }}>{tr ? "Kurtarmayı Yetkilendirmek İçin Yeniden Giriş Yap" : "Sign In Again to Authorize Recovery"}</Link>
      <label><input type="checkbox" checked={recoveryConfirmed} onChange={e => setRecoveryConfirmed(e.target.checked)} disabled={busy}/>{tr ? "Kurulum ekranına artık erişimim yok; bu yarım kurulumu kaldırmayı onaylıyorum." : "I no longer have the setup screen and authorize removal of this unfinished setup."}</label>
      <button type="button" className="secondary-button" onClick={() => { void recover(); }} disabled={busy || !recoveryConfirmed} style={{ minHeight: 44 }}>{tr ? "Yarım Kurulumu Kaldır" : "Remove Unfinished Setup"}</button>
    </div> : null}
    {factors !== null && (factors.length > 0 || pendingFactor) ? <form onSubmit={event => { void verify(event); }} className="flow-stack" autoComplete="off">
      {!pendingFactor && factors.length > 0 ? <label>{tr ? "Kendi authenticator kaydınız" : "Your authenticator"}<select value={factorId} onChange={e => setFactorId(e.target.value)} disabled={busy} style={{ minHeight: 44 }}>{factors.map(f => <option key={f.id} value={f.id}>Authenticator {f.label}</option>)}</select></label> : null}
      <label>{tr ? "Altı haneli doğrulama kodu" : "Six-digit verification code"}<input value={code} onChange={e => setCode(e.target.value.replace(/\D/gu, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy} style={{ minHeight: 44 }} /></label>
      <button type="submit" className="secondary-button" disabled={busy || code.length !== 6 || !factorId} style={{ minHeight: 44 }}>{tr ? "MFA ile Doğrula" : "Verify MFA"}</button>
    </form> : null}
    {error ? <p role="alert">{messages[error][tr ? 0 : 1]}</p> : null}
  </section>;
}
