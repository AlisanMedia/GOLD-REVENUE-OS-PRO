# Özel beta: operatör hesabında gerçek MFA

Bu ekran mevcut Polat Operations → Özel beta bölümündedir; yeni bir Admin veya
yetkilendirme sistemi değildir. TOTP işlemleri yalnız ilgili kullanıcı açıkça
butona bastığında kendi Supabase Auth oturumuyla çalışır. Bu geliştirmede gerçek
hesap/faktör oluşturulmadı veya doğrulanmadı.

## Kullanım

1. Supabase staging projesinde Auth → MFA altında TOTP enrollment ve verification
   açık olmalıdır. Kapalıysa UI kapıyı aşmaz; hata verir.
2. Founder ve Polat kendi ayrı Admin hesaplarıyla giriş yapar. Tenant üyeliği ve
   rol ayrı koşullardır; authenticator kurmak operatör rolü vermez.
3. Özel beta ekranında **Hesap Güvenliğini Kontrol Et** seçilir. Ekran açıldığında
   otomatik enrollment, challenge veya QR üretimi yapılmaz.
4. Doğrulanmış TOTP varsa seçilir ve authenticator'daki altı haneli kod girilir.
   Yoksa **Authenticator Kurulumunu Başlat** ile yalnız bu hesap için yeni,
   unverified faktör hazırlanır. QR veya alternatif secret yalnız bu özel
   oturumda gösterilir; chat, log, audit, not, URL veya ekran görüntüsüne konmaz.
   Sekme arka plana alındığında veya sayfadan ayrılırken ekrandaki secret ve kod
   temizlenir. Açık sekmede kod doğrulaması yine tamamlanabilir.
5. Kod doğrulanınca Supabase'ın güncel `aal2` oturumu ve zaman damgalı `totp` AMR
   gözlenir. Kod/QR/secret component state'inden kaldırılır ve sayfa yenilenir.
   Yeni faktörün doğrulanması diğer oturumları kapatır.
6. Program/operatör işlemlerinde sunucu tekrar gerçek üyelik, rol ve doğrulanmış
   JWT koşullarını denetler. UI'daki başarı göstergesi bir yürütme izni değildir.

Bir faktör zaten kayıtlıysa otomatik yenisi oluşturulmaz veya silinmez. Aynı açık
sekmede secret gizlense de faktörün kod doğrulaması devam edebilir. Sekme kaybolduysa
aşağıdaki açık, kullanıcıya ait doğrulanmamış enrollment kurtarması kullanılabilir.
Doğrulanmış faktör reseti bu kapsamda yoktur.

## Abandoned first-time enrollment recovery — English UI

1. Open **Polat Operations → Private Beta** and select **Check Account Security**.
2. If the setup tab is gone and the account has only one unverified TOTP factor,
   select **Sign In Again to Authorize Recovery**. Sign in with the **same existing
   account** using the normal **Email / Password → Sign in** form. Do not sign out,
   create an account, or send a password/code/QR to support.
3. On return to the MFA panel, select **Check Account Security** again.
4. Tick **I no longer have the setup screen and authorize removal of this unfinished
   setup.** Then select **Remove Unfinished Setup** within five minutes of sign-in.
5. Only after confirmed removal, select **Set Up Authenticator**. Scan the new QR
   in your authenticator. If it cannot be displayed/scanned, use **I cannot scan
   the QR** and enter the manual key privately in the authenticator.
6. Enter **Six-digit verification code**, then select **Verify MFA**. Wait for
   the real Supabase verification and refreshed session. UI inspection/recovery
   alone does not verify MFA or grant any execution authority.

Only the authenticated founder (`super_admin` in the server-selected active tenant)
can use this recovery endpoint. Current ownership is independently verified through
Auth `getUser` and verified `getClaims` on the same captured token, with `aal1` and
a timestamped password AMR no older than five minutes. JWT `iat`, form flags and
client IDs do not establish ownership. Verified factors of **any** type, multiple
unfinished factors, a changed expected factor, role/tenant/session mismatch or
missing proof block removal. A verified-factor issue needs the separate authorized
account-support procedure; it never triggers automatic cleanup.

`POST /api/v1/admin/private-beta/mfa-recovery` accepts only the expected factor UUID
and explicit confirmation, checks same origin, and uses the documented **user** Auth
unenroll endpoint with the captured AAL1 token. No Auth admin deletion, SQL factor
mutation or fabricated session is used. This handler uses the existing service
credential only to append redacted intent/outcome records to `audit_logs`;
it is not sent to Auth for unenrollment. Intent must commit before
dispatch, then a fresh Auth read and committed outcome must confirm removal.
Unknown results are not automatically retried or followed by enrollment.

Recovery never calls signOut or revokes sessions. Normal password reauthentication
replaces this browser's current login without invalidating other existing sessions.
Supabase's documented verification of a **new** MFA factor subsequently signs out
other sessions; that provider security behavior is preserved.

## Doğrulanan kontrat

- Pinned `@supabase/supabase-js` / `auth-js` **2.116.0**.
- SDK AAL yanıt alanı `currentAuthenticationMethods`'tur. RFC8176 string dizisi
  zaman damgası vermiyorsa güncel step-up varsayılmaz.
- Tazelik, `aal2` + gerçek `amr` içindeki `method: "totp"` ve son beş dakika
  zaman damgasına dayanır. Token yenilemesinin `iat` değeri MFA zamanı değildir.
- Browser client yalnız publishable key kullanır; URL'den oturum alma kapalıdır.
  Server/service key, bot veya model credential'ı client'a girmez.
- QR yalnız bounded, pasif SVG vektörleri olarak `data:` image içinde gösterilir;
  `innerHTML`, remote image, script, event handler ve foreignObject reddedilir.
- Supabase'ın SVGo/goqrsvg üreticisindeki tam XML declaration, generated comment,
  kullanılmayan xlink namespace ve yalnız sabit black/white stilleri güvenli SVG'ye
  projekte edilir. Diğer XML/CSS/link'ler reddedilir. Yoğun QR512KiB /32768 tag ile
  sınırlıdır. Desteklenmeyen QR, geçerli factor ID/manual key'i kaybettirmez;
  yalnız private manuel kurulum yolu gösterilir. Gizlendikten sonra geç dönen
  enrollment yanıtı secret'ı yeniden ekrana koyamaz.
- Auth hataları genel durumlara çevrilir; raw provider mesajı, token, kod veya
  secret loglanmaz. Otomatik challenge/verify retry yoktur.

Kaynaklar (1 Kasım 2026'da tekrar kontrol edildi):
[Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa),
[TOTP enrollment](https://supabase.com/docs/reference/javascript/auth-mfa-enroll),
[User unenroll](https://supabase.com/docs/reference/javascript/auth-mfa-unenroll),
[Auth TOTP/SVG and unenroll implementation](https://github.com/supabase/auth/blob/master/internal/api/mfa.go),
[SVGo envelope](https://github.com/ajstarks/svgo/blob/master/svg.go),
[goqrsvg fixed rectangle styles](https://github.com/aaronarduino/goqrsvg/blob/master/goqrsvg.go).
UI/offline kontrat testleri gerçek MFA veya gerçek staff kimliği kabulü değildir.
