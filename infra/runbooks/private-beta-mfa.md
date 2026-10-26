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

Bir faktör zaten kayıtlıysa otomatik yenisi oluşturulmaz. Yarım kalmış kayıt
silinmez. Aynı açık sekmede secret gizlense de faktörün kod doğrulaması devam
edebilir. Sekme kaybolduysa yetkili hesap kurtarma süreci gerekir; bu ekran
mevcut faktörleri kaldırmaz ve MFA'yı geçersiz kılmaz.

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
- Auth hataları genel durumlara çevrilir; raw provider mesajı, token, kod veya
  secret loglanmaz. Otomatik challenge/verify retry yoktur.

Kaynaklar (26 Ekim 2026):
[Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa),
[TOTP enrollment](https://supabase.com/docs/reference/javascript/auth-mfa-enroll).
UI/offline kontrat testleri gerçek MFA veya gerçek staff kimliği kabulü değildir.
