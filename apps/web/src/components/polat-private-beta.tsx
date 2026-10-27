"use client";

import Link from "next/link";
import { useActionState, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AdminDate, AdminDecimal, AdminNumber, useAdminI18n } from "./admin-i18n";
import { parsePrivateBetaCanaryResult, parsePrivateBetaStarsInvoiceResult, submitPrivateBetaOwnerForm, privateBetaFeedback, privateBetaHref, type PrivateBetaWorkspace, type PrivateBetaNotesPage, type PrivateBetaCanaryResult, type PrivateBetaStarsInvoiceResult, type PrivateBetaBusinessScope, type PrivateBetaBusinessDiscovery } from "../lib/polat/private-beta-read";
import { acceptPrivateBetaOperator, configurePrivateBeta, configurePrivateBetaBusiness, createPrivateBetaInvitation, createPrivateBetaTenant, recordPrivateBetaNote, reverifyPrivateBetaBusiness, selectPrivateBetaOpenAI, type BetaActionState } from "../app/admin/polat-operations/beta-actions";
import type { AdminLocale } from "../lib/i18n/core";
import { PrivateBetaMfa } from "./private-beta-mfa";

const copy = {
  tab: ["Özel beta", "Private beta"],
  boundary: ["Davetli UAT · Ticari satış, gerçek ödeme ve üretim VIP yetkisi yok.", "Invitation-only UAT · Commercial sales, genuine payments and production VIP are disabled."],
  title: ["Polat VIP özel beta", "Polat VIP private beta"],
  basis: ["Bu bölüm yalnız seçili UAT markasının kayıtlı denemelerini gösterir. Sahte test sonuçları gerçek model veya Telegram kanıtı yerine sayılmaz.", "This section shows persisted attempts for the selected UAT tenant only. Fixture results are not real-model or Telegram evidence."],
  denied: ["Bu rol özel beta görüşmelerini okuyamaz.", "This role cannot read private beta conversations."],
  unavailable: ["Beta kanıtları yüklenemedi. Boş sonuç veya başarılı işlem varsayılmadı.", "Beta evidence is unavailable. Neither an empty result nor a successful operation is assumed."],
  invalid: ["Sayfa veya form bilgileri geçersiz. İlk sayfayı açıp yeniden deneyin.", "The page or form is invalid. Open the first page and try again."],
  empty: ["Bu markada özel beta programı oluşturulmadı. Gerçek model ve tester trafiği henüz açılmadı.", "No private beta program exists for this tenant. Real-model and tester traffic have not been enabled."],
  ceiling: ["Kurucu yetki tavanı: 1 canary, 20 kurucu yanıtı, en fazla 10 arkadaş için kişi başına 30 yanıt; başarısız ve belirsiz denemeler dahil toplam 350 çağrı ve 5,00 USD. Bu tavan bir hesap doğrulaması veya otomatik açılış değildir.", "Founder authorization ceiling: 1 canary, 20 founder replies, and 30 replies for each of up to 10 friends; 350 total calls including failed and uncertain attempts, capped at USD 5.00. A ceiling is not account verification or automatic activation."],
  setup: ["Güvenli başlangıç", "Secure setup"],
  setupText: ["Önce ayrı UAT markasını oluşturun, üstteki marka seçicisinden bu markaya geçin ve taslak programı kaydedin. Taslak oluşturmak hesap, model veya gönderim kapılarını açmaz.", "Create an isolated UAT tenant first, select it in the header, then save a draft program. Creating a draft does not enable an account, model or sending gate."],
  bootstrap: ["Ayrı UAT Markası Oluştur", "Create Isolated UAT Tenant"],
  bootstrapDone: ["UAT markası oluşturuldu. Üstteki marka seçicisinden yeni markaya geçin.", "UAT tenant created. Select the new tenant in the header."],
  draft: ["Taslak program", "Draft program"],
  model: ["Programın modeli", "Program model"],
  selectOpenAI: ["OpenAI GPT-6.1 Sol Modelini Seç", "Select OpenAI GPT-6.1 Sol"],
  selectOpenAIText: ["Yalnız davet veya deneme başlamamış taslakta, güncel MFA ile seçilir. Seçim mevcut genel OPENAI_MODEL ayarını değiştirmez; gerçek hesap/harcama kanıtı olmadan çağrı açılmaz. Katılım bildirimi OpenAI olarak sürümlenir.", "Only a draft without invitations or attempts can be selected, using fresh MFA. This does not change the global OPENAI_MODEL setting or enable calls without actual account/spending evidence. The participation notice is versioned for OpenAI."],
  businessTitle: ["Polat hesabı · yalnız kurucu test sohbeti", "Polat account · founder test chat only"],
  businessText: ["Telegram'da Secretary Mode ve Only selected chats seçmek sunucu izni değildir. Bu kayıt, tek hesap bağlantısını ve tek kurucu sohbetini sınırlar; bot kimliği ve hesap bağlantısı ayrıca sağlayıcıdan doğrulanmalıdır. BUSINESS testinde davet kodu Polat hesabıyla seçili özel sohbetten gönderilir. Müşteri listesi, sinyal kanalı okuma veya arkadaş kampanyası açılmaz.", "Telegram Secretary Mode and Only selected chats do not create server authority. This record limits one account connection and one founder chat; bot identity and connection must also be independently verified with the provider. In BUSINESS mode, send the invitation code in the selected private chat with the Polat account. It does not enable customer lists, signal-channel monitoring or friend campaigns."],
  businessRepresentative: ["Doğrulanacak Telegram hesap numarası · Polat", "Telegram account numeric ID to verify · Polat"],
  businessFounder: ["Yalnız izinli kurucu test sohbetinin numarası", "Allowlisted founder test chat numeric ID only"],
  businessConnection: ["Telegram hesap bağlantı kimliği · API tokenı değildir", "Telegram account connection ID · not an API token"],
  businessHint: ["Gerçek kimlikler korunan discover_business gözleminden ve kendi test kimliğinizden alınır; username veya eski kayıt tahmini kullanılmaz. Gizli anahtarları bu forma yapıştırmayın. Kaydetmek yalnız yapılandırmadır; gerçek API isteği veya mesaj göndermez.", "Use actual identities from the protected discover_business observation and your own test identity, not usernames or historical guesses. Do not paste secret keys into this form. Saving records configuration only; it makes no API request or send."],
  businessSave: ["Tek Test Sohbetini Yapılandır", "Configure One Test Chat"],
  businessReverify: ["Bağımsız İzin Doğrulaması Talep Et", "Request Independent Permission Reverification"],
  businessReverifyText: ["Bu işlem güncel MFA ile yeni doğrulama nesli açar. Korunan verify_business adımı gerçek sağlayıcı kanıtını tekrar okumadan kısıt kalkmaz. Belirsiz gönderimler başarılı sayılmaz, otomatik tekrar veya AI'a dönüş yapılmaz.", "Fresh MFA opens a new verification generation. Restrictions remain until protected verify_business rereads actual provider evidence. Unknown sends are not marked successful, retried or automatically returned to AI."],
  businessDiscoveryTitle: ["Özel hesap bağlantısı adayları", "Private account connection candidates"],
  businessDiscoveryHint: ["Yalnız güncel MFA sahibi kurucu görür. Aday kaydı bağlantı veya gönderim yetkisi değildir. Tek aday varsa forma öneri olarak doldurulur; kaydetme ve bağımsız doğrulama yine zorunludur.", "Visible only to the founder with fresh MFA. Candidate evidence is not connection or sending authority. A single candidate is proposed in the form; saving and independent verification are still required."],
  businessDiscoveryMissing: ["Geçerli aday gözlemi yok. Kendi hesabınızdan seçili Polat sohbetine gönüllü bir test mesajı gönderin; korunan discover_business adımı sonrasında bu ekranı yenileyin. Henüz AI yanıtı beklemeyin.", "No current candidate observation. Voluntarily send a test message from your own account in the selected Polat chat, then refresh after the protected discover_business step. Do not expect an AI reply yet."],
  businessDiscoveryUnavailable: ["Özel aday kanıtı okunamadı; güncel MFA ile yenileyin. Kimlik veya bağlantı doğrulanmış sayılmadı.", "Private candidate evidence is unavailable; refresh with fresh MFA. No identity or connection is considered verified."],
  businessDiscoveryExpiry: ["Aday kanıtının geçerlilik sonu", "Candidate evidence valid until"],
  businessStatus: ["Hesap bağlantı durumu", "Account connection state"],
  businessMissing: ["Hesap bağlantısı henüz sunucuda doğrulanmadı.", "The account connection has not yet been verified by the server."],
  businessUnavailable: ["Bağlantı kanıtı okunamadı. Güncel yetkili MFA oturumu ile yenileyin; bağlantı çalışıyor sayılmadı.", "Connection evidence is unavailable. Refresh with an authorized current MFA session; no working connection is inferred."],
  businessConfigured: ["Yapılandırıldı · bağımsız doğrulama eksik", "Configured · independent verification missing"],
  businessFreshRead: ["Kimlik kanıtı kayıtlı · her gönderimde güncel izin okunacak", "Identity evidence recorded · fresh permissions required on every send"],
  businessBlocked: ["Kısıtlı · bağımsız doğrulama ve insan incelemesi gerekli", "Restricted · independent verification and human review required"],
  businessExpired: ["İzin penceresi sona erdi", "Authorization window expired"],
  draftText: ["Yalnız doğrulanmış değerleri girin; bilinmeyen alanları boş bırakabilirsiniz. Boşluklar aktivasyonu kapalı tutar. Kişisel operator bilgileri yalnız bu özel yönetim ekranında kalır.", "Enter verified values only; unknown fields may stay blank and keep activation blocked. Staff details remain within this private administration surface."],
  sha: ["Kabul edilmiş release SHA", "Accepted release SHA"],
  starts: ["Başlangıç · ISO 8601 / UTC", "Starts · ISO 8601 / UTC"],
  expires: ["Bitiş · ISO 8601 / UTC", "Expires · ISO 8601 / UTC"],
  retention: ["UAT saklama süresi · gün (1–30)", "UAT retention · days (1–30)"],
  retentionText: ["Bu alana girilen süre özel beta politikasıdır; üretim saklama süresi değildir. Geçerli silme talepleri ve yasal istisnalar ayrıca uygulanır.", "This value is the private beta policy, not production retention. Applicable deletion requests and legal exceptions still apply."],
  primary: ["Birincil operator · Polat", "Primary operator · Polat"],
  backup: ["Yedek operator · kurucu", "Backup operator · founder"],
  operatorHint: ["Yalnız bu markanın aktif yetkili üyeleri seçilebilir. Hesap kimliği, rol ve MFA aktivasyonda tekrar doğrulanır; iki hesap aynı kişi diye varsayılmaz.", "Only active staff memberships in this tenant can be selected. Identity, role and MFA are verified again at activation; two accounts are not assumed to be independent people."],
  operatorAccept: ["Bu Hesapla Operator Görevini Kabul Et", "Accept Operator Duty with This Account"],
  operatorAcceptText: ["Bu hesap kayıtlı birincil veya yedek operator ile eşleşmeli ve güncel MFA ile doğrulanmalıdır. Kabul, görüşmeyi otomatik devralmaz; vaka ekranındaki mevcut güvenli devralma akışını kullanın. Destek üyeliği tek başına yönetici yetkisi vermez.", "This account must match the configured primary or backup operator and have a current MFA verification. Acceptance does not take over a conversation; use the existing safe takeover flow in Attention. Support membership alone does not grant manager authority."],
  operatorAccepted: ["Bu hesabın operator kabulü kaydedildi. Görüşme devralma ayrı bir işlemdir; finansal veya ticari yetki verilmedi.", "This account's operator acceptance was recorded. Conversation takeover is separate; no financial or commercial authority was granted."],
  select: ["Henüz seçilmedi", "Not selected"],
  current: ["Bu oturum", "This account"],
  operatorUnknown: ["Operator üyeleri yüklenemedi; ad veya hesap uydurulmadı.", "Staff memberships are unavailable; no name or account is assumed."],
  save: ["Taslağı Kaydet", "Save Draft"],
  saved: ["Kayıt tamamlandı. Bu işlem test çalıştırmadı veya mesaj göndermedi.", "Saved. This operation did not run a test or send a message."],
  pending: ["Kaydediliyor…", "Saving…"],
  another: ["Yeni İşlem Hazırla", "Prepare Another Entry"],
  auth: ["İşlem kaydedilmedi. Yetkili hesap, geçerli MFA oturumu ve program kapsamını kontrol edin.", "Not saved. Check the authorized account, current MFA session and program scope."],
  mfa: ["İşlem için güncel MFA doğrulaması gerekiyor. Yeniden doğrulayın.", "A current MFA verification is required. Reauthenticate and try again."],
  limit: ["Bu kapsamın davet veya deneme sınırına ulaşıldı. Yeni kayıt açarak sınırı aşmayın.", "The invitation or attempt limit for this scope has been reached. Do not create another record to bypass it."],
  blocked: ["Program aşaması, çalışma zamanı veya doğrulama koşulları bu işleme izin vermiyor. Güncel kanıtları inceleyin.", "The program stage, operating window or verification gates do not permit this operation. Review the current evidence."],
  stale: ["Kayıt başka bir işlemle değişti. Sayfayı yenileyip güncel durumu inceleyin.", "The record changed during another operation. Refresh and inspect the current state."],
  writeUnknown: ["İşlemin kaydedildiği doğrulanamadı. Yeni işlem oluşturmadan önce kayıtları kontrol edin; aynı form aynı işlem kimliğini korur.", "The write could not be confirmed. Inspect the records before creating another operation; this form preserves its command identity."],
  stage: ["Program aşaması", "Program stage"],
  configuration: ["Yapılandırma", "Configuration"],
  operatorConfigured: ["Hesap seçimi kayıtlı · kimlik/MFA kabulü ayrı", "Account selection recorded · identity/MFA acceptance is separate"],
  operatorMissing: ["Hesap seçilmedi", "No account selected"],
  complete: ["Gerekli alanlar kayıtlı · dış doğrulama ayrı", "Required fields recorded · external verification is separate"],
  incomplete: ["Eksik alanlar var · aktivasyon kapalı", "Required fields missing · activation blocked"],
  account: ["Sağlayıcı hesap kanıtı", "Provider account evidence"],
  canary: ["Tek-request canary muhasebesi", "Single-request canary accounting"],
  canaryRun: ["Gerçek Tek Canary İsteğini Başlat", "Start One Genuine Canary Request"],
  canaryText: ["Bu düğme programda kayıtlı sağlayıcı/model ile gerçek ve ücretlenebilir tek isteği başlatır: Hi, İngilizce/DIRECT, en fazla 512 çıktı tokenı, 10 saniye; tekrar, fallback ve QA yenilemesi yok. Tüm UAT programının 5,00 USD tavanı geçerlidir. Hesap/harcama kontrolü, sealed kayıt ve güncel MFA server tarafından doğrulanmadan istek gönderilmez.", "This button starts one genuine, potentially billable request using the provider/model recorded in the program: Hi, English/DIRECT, up to 512 output tokens, 10 seconds; no retry, fallback or QA regeneration. The USD 5.00 ceiling covers the entire UAT program. Account/spending controls, sealed evidence and current MFA must pass server-side verification before dispatch."],
  canaryBlocked: ["Gerekli hesap ve program kanıtları eksik veya güncel değil. Çalıştırma kapalı.", "Required account/program evidence is missing or stale. Execution is blocked."],
  canaryPending: ["Tek canary isteği işleniyor. Yeniden göndermeyin.", "The single canary request is being processed. Do not resubmit."],
  canaryAccounting: ["Canary yanıtı QA'dan geçti; gerçek fatura henüz bilinmiyor. Bağımsız maliyet uzlaştırılmadan kurucu/arkadaş testi açılmadı. Bu sonuç tam model veya insan kalitesi kabulü değildir.", "The canary response passed QA; actual billing is still unknown. Founder/friend testing remains disabled until independent cost reconciliation. This is not full model or human-quality acceptance."],
  canaryHeld: ["Canary QA tarafından durduruldu. Güvenli başka bir yanıtla değiştirilmedi ve test aşaması ilerletilmedi. Gerçek deneme kaydını inceleyin; otomatik tekrar yok.", "QA held the canary. No substitute safe response was used and the test stage was not advanced. Inspect the actual attempt evidence; there is no automatic retry."],
  canaryReview: ["İstek engellendi veya sonucu doğrulanamadı. Yeni bir istek göndermeden önce kalıcı deneme/muhasebe kayıtlarını inceleyip sayfayı yenileyin. Belirsiz maliyet sıfır sayılmaz.", "The request was blocked or its outcome could not be confirmed. Inspect durable attempt/accounting evidence and refresh before any new request. Unknown cost is not zero."],
  canaryOutput: ["QA'dan geçen gerçek canary yanıtı", "Actual QA-approved canary response"],
  canaryEvidence: ["Canary kaynak kanıtı", "Canary source evidence"],
  providerResponse: ["Sağlayıcı yanıt kimliği", "Provider response ID"],
  starsTitle: ["Telegram Stars · ayrı TEST ortamı", "Telegram Stars · separate TEST environment"],
  starsText: ["Bu işlem yalnız Telegram'ın dedicated TEST ortamında, doğrulanmış ayrı TEST botu ve onaylı TEST XTR teklifi ile çalışır. Normal arkadaş botu ödeme testi yetkisi değildir. Gerçek para, gerçek VIP veya tedarikçi sinyal erişimi sağlanmaz. 69,00 USD taslak hedefi otomatik Stars fiyatına çevrilmez.", "This operation works only in Telegram's dedicated TEST environment with a separately verified TEST bot and approved TEST XTR offer. The ordinary friends bot is not payment-test authority. It grants no genuine money, production VIP or supplier-signal access. The USD 69.00 draft target is not automatically converted into a Stars price."],
  starsOffer: ["Onaylı TEST teklif kaydı", "Approved TEST offer record"],
  starsSend: ["Yalnız TEST Faturasını Gönder", "Send TEST Invoice Only"],
  starsPending: ["TEST faturası işleniyor. Aynı işlemi yeniden oluşturmayın.", "The TEST invoice is being processed. Do not recreate the same operation."],
  starsAck: ["Fatura Telegram TEST API tarafından kabul edildi. Ödeme, receipt, abonelik veya VIP tamamlandı sayılmadı.", "The invoice was acknowledged by the Telegram TEST API. No payment, receipt, subscription or VIP completion is inferred."],
  starsExisting: ["Bu işlem için TEST fatura kaydı zaten var. Yeni fatura gönderilmedi; mevcut kanıtı inceleyin.", "A TEST invoice already exists for this operation. No new invoice was sent; inspect the existing evidence."],
  starsInvoice: ["TEST fatura kaydını aç", "Open TEST invoice record"],
  starsReview: ["TEST işlemi engellendi veya sonucu belirsiz. Aynı işlem kimliğiyle kayıtları inceleyin; otomatik tekrar ve gerçek ödeme yok.", "The TEST operation was blocked or its result is uncertain. Inspect the records under the same command identity; there is no automatic retry or genuine payment."],
  catalog: ["Mevcut teklif ekranını aç", "Open existing offers"],
  requests: ["Başlatılan model denemesi", "Initiated model attempts"],
  reserved: ["Rezerve edilen azami sorumluluk", "Reserved maximum liability"],
  billing: ["Bağımsız doğrulanmış gerçek maliyet", "Independently verified actual cost"],
  unknown: ["Bilinmiyor", "Unknown"],
  restricted: ["Bu rol kapsamında gösterilmez", "Restricted for this role"],
  count: ["Kayıtlı katılımcılar", "Recorded participants"],
  participants: ["Davetli katılımcılar ve sınırlar", "Invited participants and limits"],
  noParticipants: ["Henüz katılmış tester yok. Davet oluşturmak katılım veya izin kanıtı değildir.", "No tester has joined. Creating an invitation is not participation or consent evidence."],
  founder: ["Kurucu", "Founder"],
  friend: ["Davetli arkadaş", "Invited friend"],
  participant: ["Katılımcı", "Participant"],
  status: ["Durum", "Status"],
  used: ["Deneme / kişi sınırı", "Attempts / personal limit"],
  joined: ["Katılım zamanı", "Joined at"],
  conversation: ["Görüşmeyi Aç", "Open Conversation"],
  noConversation: ["Görüşme kaydı bekleniyor", "Awaiting conversation evidence"],
  invites: ["Tek kullanımlık davet", "One-time invitation"],
  inviteText: ["Kod yalnız bir kez gösterilir. Güvenli şekilde ilgili testere iletin; tester doğrulanmış Telegram test sohbetini kendisi açıp /start kodunu gönderir ve beta bildirimini kabul eder. Kod kişiyi tek başına yetkilendirmez; gerçek numeric Telegram kimliğine backend tarafından bağlanır.", "The code is shown once. Share it securely with the intended tester; they voluntarily open the verified Telegram test chat and send the /start code and accept the beta notice. The code alone does not authorize an identity; the backend binds it to the actual numeric Telegram user."],
  kind: ["Davet türü", "Invitation type"],
  inviteCreate: ["Davet Oluştur", "Create Invitation"],
  inviteOnce: ["Davet oluşturuldu. Kod yalnız bu özel ekranda bir kez gösterilir; log veya müşteri geçmişine yazılmaz.", "Invitation created. The code is shown once on this private screen; it is not written to logs or customer history."],
  inviteReplay: ["Bu davet daha önce oluşturuldu. Tek kullanımlık kod yeniden gösterilmez; belirsiz işlemi tekrar oluşturmayın.", "This invitation was already created. Its one-time code is not shown again; do not recreate an uncertain operation."],
  inviteExpires: ["Davetin son kullanımı", "Invitation expiry"],
  attempts: ["Model denemeleri ve QA", "Model attempts and QA"],
  noAttempts: ["Kayıtlı gerçek model denemesi yok. Fixture sonucu buraya taşınmadı.", "No real-model attempt is recorded. Fixture results have not been copied here."],
  scope: ["Kapsam", "Scope"],
  qa: ["QA sonucu", "QA result"],
  tokens: ["Giriş / çıkış tokenı", "Input / output tokens"],
  actual: ["Gerçek fatura", "Actual bill"],
  time: ["Zaman", "Time"],
  notes: ["Test notları ve senaryo sonuçları", "Test notes and scenario outcomes"],
  notesText: ["Notlar değiştirilemez kayıt olarak eklenir; önceki hatalar silinmez. Arkadaş geri bildirimi veya operator notu bağımsız kör insan değerlendirmesi değildir ve QA/ödeme/gönderim yetkisi vermez.", "Notes are appended as immutable evidence; earlier failures are not deleted. Friend feedback or operator notes are not independent blind human review and do not grant QA, payment or sending authority."],
  testerFeedback: ["Katılımcının informal beta geri bildirimi", "Participant's informal beta feedback"],
  testerEvidence: ["Katılımcı kanıtı", "Participant evidence"],
  systemNote: ["Otomatik sistem kaydı", "System observation"],
  operatorNote: ["Operator test notu", "Operator test note"],
  useful: ["Yararlı", "Useful"],
  natural: ["Doğal", "Natural"],
  correct: ["Doğru", "Correct"],
  satisfied: ["Memnuniyet", "Satisfaction"],
  noNotes: ["Henüz operator test notu yok.", "No operator test notes yet."],
  allNotes: ["Tüm not geçmişi", "Complete note history"],
  nextNotes: ["Önceki notlar", "Older notes"],
  notesMore: ["Yalnız sınırlı son notlar gösteriliyor; daha eski kayıtlar silinmedi. Bu görünüm not geçmişinin tamamı değildir.", "Only the bounded latest notes are shown; older records have not been deleted. This view is not the complete note history."],
  scenario: ["Senaryo kodu / kısa adı", "Scenario code / short name"],
  outcome: ["Gözlenen sonuç", "Observed outcome"],
  note: ["İç test notu", "Internal test note"],
  noteHint: ["Gerçekte gözlenen sonucu yazın. Token, sır, gereksiz kişisel veri veya gerçekleşmemiş başarılı işlem eklemeyin.", "Record what was actually observed. Do not include tokens, secrets, unnecessary personal data or an unobserved successful operation."],
  noteSave: ["Kanıt Notunu Kaydet", "Append Evidence Note"],
  wholeProgram: ["Program geneli", "Whole program"],
  more: ["Sonraki denemeler", "Next attempts"],
  first: ["İlk sayfa / yenile", "First page / refresh"],
  pageSize: ["Sayfa büyüklüğü", "Page size"],
  filter: ["Uygula", "Apply"],
  setupFields: ["Dış kurulum alanları", "External setup fields"],
  setupFieldsText: ["Değerleri bu sayfaya veya sohbete yapıştırmayın. Secret alanları staging secret kasasında; kimlik, account/spend-policy kanıtları ve yetkili operatorler doğrulanmış kurulumda kaydedilmelidir.", "Do not paste secret values here or into chat. Configure secrets in staging secret custody and record identities, account/spend-policy evidence and authorized operators through the verified setup process."],
  financial: ["Finansal yetki: NONE · Ticari pilot: NO_GO · UAT gerçek ödeme toplamaz.", "Financial authority: NONE · Commercial pilot: NO_GO · UAT collects no genuine payments."],
} as const;
type BetaText = keyof typeof copy;
export function privateBetaText(locale: AdminLocale, key: BetaText) { return copy[key][locale === "tr-TR" ? 0 : 1]; }
function useCopy() { const { locale } = useAdminI18n(); return { locale, text: (key: BetaText) => privateBetaText(locale, key) }; }
const states = {
  DRAFT: ["Taslak", "Draft"], CANARY: ["Canary aşaması", "Canary stage"], FOUNDER: ["Kurucu testi", "Founder test"], FRIENDS: ["Davetli arkadaş testi", "Invited friends test"], STOPPED: ["Durduruldu", "Stopped"],
  MISSING: ["Eksik", "Missing"], OBSERVED: ["Gözlem kayıtlı · güncellik ayrıca doğrulanır", "Observation recorded · freshness is checked separately"], STALE: ["Güncel değil", "Stale"], BLOCKED: ["Engelli", "Blocked"], NOT_STARTED: ["Başlamadı", "Not started"], PENDING: ["Bekliyor", "Pending"], REVIEW: ["İnceleme gerekiyor", "Review required"], RECONCILED: ["Muhasebe uzlaştırıldı", "Accounting reconciled"],
  PENDING_NOTICE: ["Beta bildirimi bekliyor", "Beta notice pending"], ACTIVE: ["Katılım aktif", "Participation active"], REVOKED: ["Katılımdan çıktı", "Participation revoked"], RESERVED: ["Deneme rezerve edildi", "Attempt reserved"], DISPATCH_STARTED: ["İstek başlatıldı", "Request started"], SUCCEEDED: ["Sağlayıcı yanıtı kayıtlı", "Provider response recorded"], FAILED: ["Başarısız deneme", "Failed attempt"], UNKNOWN: ["Sonuç belirsiz · inceleme", "Unknown result · review"], super_admin: ["Üst yönetici adayı", "Super-admin candidate"], manager: ["Yönetici adayı", "Manager candidate"], support: ["Destek adayı", "Support candidate"], APPROVED: ["QA onayladı", "QA approved"], HELD: ["QA durdurdu", "QA held"], NOT_EVALUATED: ["Değerlendirilmedi", "Not evaluated"], PASS: ["Gözlenen test geçti", "Observed test passed"], FAIL: ["Test başarısız", "Test failed"], NOT_TESTED: ["Test edilmedi", "Not tested"], NOTE: ["Operator notu", "Operator note"], FRIEND: ["Davetli arkadaş", "Invited friend"],
} as const;
function statusLabel(value: string, locale: AdminLocale) { return Object.hasOwn(states, value) ? states[value as keyof typeof states][locale === "tr-TR" ? 0 : 1] : value; }

function ActionForm({ action, children, repeatable = true }: { action: (previous: BetaActionState, form: FormData) => Promise<BetaActionState>; children: ReactNode; repeatable?: boolean }) {
  const { text } = useCopy();
  const command = useRef<string | null>(null);
  const [state, submit, pending] = useActionState(async (previous: BetaActionState, form: FormData): Promise<BetaActionState> => {
    if (form.get("__new_entry") === "1") { command.current = null; return { kind: "idle", code: "IDLE" }; }
    command.current ??= crypto.randomUUID();
    form.set("command_id", command.current);
    try { return await action(previous, form); } catch { return { kind: "error", code: "UNAVAILABLE" }; }
  }, { kind: "idle", code: "IDLE" });
  const message: Partial<Record<BetaActionState["code"], BetaText>> = { SAVED: "saved", TENANT_CREATED: "bootstrapDone", INVITATION_CREATED: "inviteOnce", INVITATION_ALREADY_CREATED: "inviteReplay", OPERATOR_ACCEPTED: "operatorAccepted", INVALID: "invalid", DENIED: "auth", MFA_REQUIRED: "mfa", LIMIT: "limit", BLOCKED: "blocked", STALE: "stale", UNAVAILABLE: "writeUnknown" };
  return <form action={submit} className="transition-form case-action-form"><fieldset disabled={pending || state.kind === "success"}>{children}</fieldset>
    {pending && <p role="status">{text("pending")}</p>}
    {state.kind !== "idle" && <p className={state.kind === "error" ? "error-banner" : "form-message"} role={state.kind === "error" ? "alert" : "status"}>{text(message[state.code] ?? "unavailable")}</p>}
    {state.invitation && <div className="warning-box"><code style={{ overflowWrap: "anywhere" }}>/start {state.invitation.code}</code><p>{text("inviteExpires")}: <AdminDate value={state.invitation.expiresAt}/></p></div>}
    {state.kind === "success" && repeatable && <button className="secondary-button" type="submit" name="__new_entry" value="1" formNoValidate>{text("another")}</button>}
  </form>;
}

function CanaryControl({ program }: { program: NonNullable<PrivateBetaWorkspace["program"]> }) {
  const { text } = useCopy(); const attempted = useRef(false);
  const [phase, setPhase] = useState<"IDLE" | "PENDING" | "REVIEW" | "RESULT">("IDLE");
  const [result, setResult] = useState<PrivateBetaCanaryResult | null>(null);
  const enabled = program.configuration_complete && program.account_state === "OBSERVED" && program.repository_sha !== null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (attempted.current || !enabled || program.repository_sha === null) return;
    attempted.current = true; setPhase("PENDING");
    try {
      const raw = await submitPrivateBetaOwnerForm("/api/v1/admin/private-beta/canary", new URLSearchParams({ program_id: program.id }));
      setResult(parsePrivateBetaCanaryResult(raw, program.id, program.repository_sha)); setPhase("RESULT");
    } catch { setPhase("REVIEW"); }
  }
  return <section className="form-panel" aria-labelledby="private-beta-canary-heading"><h3 id="private-beta-canary-heading">{text("canaryRun")}</h3><p>{text("canaryText")}</p>
    {!enabled && <p className="warning-box">{text("canaryBlocked")}</p>}
    <form action="/api/v1/admin/private-beta/canary" method="post" onSubmit={submit}><input type="hidden" name="program_id" value={program.id}/><button className="primary-button" type="submit" disabled={!enabled || phase !== "IDLE"}>{text("canaryRun")}</button></form>
    {phase === "PENDING" && <p role="status">{text("canaryPending")}</p>}{phase === "REVIEW" && <p className="warning-box" role="alert">{text("canaryReview")}</p>}
    {result && <><p className="warning-box" role="status">{text(result.status === "CANARY_HELD" ? "canaryHeld" : "canaryAccounting")}</p>
      {result.response_preview !== null && <section className="detail-card"><h4>{text("canaryOutput")}</h4><p lang="en">{result.response_preview}</p></section>}
      <dl className="polat-facts"><div><dt>{text("tokens")}</dt><dd>{result.input_tokens === null ? text("unknown") : <AdminNumber value={result.input_tokens}/>} / {result.output_tokens === null ? text("unknown") : <AdminNumber value={result.output_tokens}/>}</dd></div><div><dt>{text("actual")}</dt><dd>{text("unknown")}</dd></div></dl>
      <details className="polat-record"><summary>{text("canaryEvidence")}</summary><dl className="polat-facts"><div><dt>{text("scope")}</dt><dd><code>{result.attempt_id}</code></dd></div><div><dt>{text("time")}</dt><dd>{result.elapsed_ms === null ? text("unknown") : <><AdminDecimal value={result.elapsed_ms}/> ms</>}</dd></div><div><dt>{text("providerResponse")}</dt><dd><code>{result.provider_response_id}</code></dd></div></dl></details>
    </>}
  </section>;
}

function StarsInvoiceControl({ programId, commandId }: { programId: string; commandId: string }) {
  const { text } = useCopy(); const attempted = useRef(false);
  const [phase, setPhase] = useState<"IDLE" | "PENDING" | "REVIEW" | "RESULT">("IDLE");
  const [result, setResult] = useState<PrivateBetaStarsInvoiceResult | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (attempted.current) return;
    const form = new FormData(event.currentTarget), offer = form.get("approved_offer_id"); if (typeof offer !== "string" || !offer.trim()) return;
    attempted.current = true; setPhase("PENDING");
    try { const raw = await submitPrivateBetaOwnerForm("/api/v1/admin/private-beta/stars-test-invoice", new URLSearchParams({ program_id: programId, approved_offer_id: offer.trim(), command_id: commandId })); setResult(parsePrivateBetaStarsInvoiceResult(raw)); setPhase("RESULT"); } catch { setPhase("REVIEW"); }
  }
  return <section className="form-panel" aria-labelledby="private-beta-stars-heading"><h3 id="private-beta-stars-heading">{text("starsTitle")}</h3><p>{text("starsText")}</p><Link className="text-button" href="/admin/offers">{text("catalog")}</Link>
    <form action="/api/v1/admin/private-beta/stars-test-invoice" method="post" onSubmit={submit} className="transition-form case-action-form"><fieldset disabled={phase !== "IDLE"}><input type="hidden" name="program_id" value={programId}/><input type="hidden" name="command_id" value={commandId}/><label>{text("starsOffer")}<input name="approved_offer_id" required minLength={36} maxLength={36} pattern="[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}" autoComplete="off"/></label><button className="secondary-button" type="submit">{text("starsSend")}</button></fieldset></form>
    {phase === "PENDING" && <p role="status">{text("starsPending")}</p>}{phase === "REVIEW" && <p className="warning-box" role="alert">{text("starsReview")}</p>}
    {result && <><p className="warning-box" role="status">{text(result.status === "TEST_INVOICE_ACKNOWLEDGED" ? "starsAck" : "starsExisting")}</p>{result.invoice_id && <p><Link href={`/admin/payments/${result.invoice_id}`}>{text("starsInvoice")}</Link></p>}</>}
  </section>;
}

export type BetaOperator = { id: string; role: string; current: boolean };
function Configuration({ program, operators }: { program: PrivateBetaWorkspace["program"]; operators: BetaOperator[] | null }) {
  const { text, locale } = useCopy();
  return <section className="form-panel"><h3>{text("draft")}</h3><p>{text("draftText")}</p><ActionForm action={configurePrivateBeta}>
    {program && <input type="hidden" name="program_id" value={program.id}/>}
    {program?.model_provider === "openai" && <><input type="hidden" name="model_provider" value="openai"/><input type="hidden" name="model_name" value="gpt-6.1-sol"/></>}
    <label>{text("sha")}<input name="repository_sha" defaultValue={program?.repository_sha ?? ""} minLength={40} maxLength={40} pattern="[a-f0-9]{40}" autoComplete="off" placeholder="40-character protected main SHA"/></label>
    <div className="polat-columns"><label>{text("starts")}<input name="starts_at" defaultValue={program?.starts_at ?? ""} maxLength={40} placeholder="2026-10-26T12:00:00Z"/></label><label>{text("expires")}<input name="expires_at" defaultValue={program?.expires_at ?? ""} maxLength={40} placeholder="2026-10-27T12:00:00Z"/></label></div>
    <label>{text("retention")}<input name="retention_days" type="number" min={1} max={30} step={1} defaultValue={program?.retention_days ?? ""}/></label><p className="muted">{text("retentionText")}</p>
    <div className="polat-columns">{([['primary_operator', 'primary'], ['backup_operator', 'backup']] as const).map(([name, label]) => <label key={name}>{text(label)}<select name={name} defaultValue="" required={name === "primary_operator" ? program?.primary_operator_configured : program?.backup_operator_configured}><option value="">{text("select")}</option>{operators?.map(operator => <option key={operator.id} value={operator.id}>{operator.current ? text("current") : `${statusLabel(operator.role, locale)} · ${operator.id.slice(0, 8)}`}</option>)}</select></label>)}</div>
    {operators === null && <p className="warning-box">{text("operatorUnknown")}</p>}<p className="muted">{text("operatorHint")}</p><button className="primary-button" type="submit">{text("save")}</button>
  </ActionForm>{program && <><p><strong>{text("model")}:</strong> {program.model_provider === "openai" ? "OpenAI · gpt-6.1-sol" : "Anthropic · claude-haiku-5-5"}</p>{program.model_provider !== "openai" && <ActionForm action={selectPrivateBetaOpenAI} repeatable={false}><input type="hidden" name="program_id" value={program.id}/><input type="hidden" name="expected_generation" value={program.generation}/><p>{text("selectOpenAIText")}</p><button className="secondary-button" type="submit" disabled={program.global_requests !== 0}>{text("selectOpenAI")}</button></ActionForm>}</>}</section>;
}

function BusinessConfiguration({ program, scope, unavailable, discovery, discoveryUnavailable }: { program: NonNullable<PrivateBetaWorkspace["program"]>; scope: PrivateBetaBusinessScope | null; unavailable: boolean; discovery: PrivateBetaBusinessDiscovery | null; discoveryUnavailable: boolean }) {
  const { text } = useCopy();
  const proposed = discovery?.candidates.length === 1 ? discovery.candidates[0] : null;
  const proposedFounder = proposed?.founder_chat_ids.length === 1 ? proposed.founder_chat_ids[0] : "";
  return <section className="form-panel"><h3>{text("businessTitle")}</h3><p>{text("businessText")}</p>
    <p role="status"><strong>{text("businessStatus")}:</strong> {unavailable ? text("businessUnavailable") : scope ? text(scope.state === "READY_FOR_FRESH_PROVIDER_READ" ? "businessFreshRead" : scope.state === "CONFIGURED_UNVERIFIED" ? "businessConfigured" : scope.state === "EXPIRED" ? "businessExpired" : "businessBlocked") : text("businessMissing")}</p>
    {program.stage === "DRAFT" && <div className="polat-record"><h4>{text("businessDiscoveryTitle")}</h4><p>{text("businessDiscoveryHint")}</p>
      {discoveryUnavailable ? <p className="warning-box" role="status">{text("businessDiscoveryUnavailable")}</p> : discovery?.candidates.length ? <><p>{text("businessDiscoveryExpiry")}: <AdminDate value={discovery.expires_at}/></p>{discovery.candidates.map(candidate => <dl className="polat-facts" key={candidate.business_connection_id}><div><dt>{text("businessRepresentative")}</dt><dd style={{ overflowWrap: "anywhere" }}>{candidate.representative_user_id}</dd></div><div><dt>{text("businessConnection")}</dt><dd style={{ overflowWrap: "anywhere" }}>{candidate.business_connection_id}</dd></div><div><dt>{text("businessFounder")}</dt><dd style={{ overflowWrap: "anywhere" }}>{candidate.founder_chat_ids.join(", ") || text("unknown")}</dd></div></dl>)}</> : <p role="status">{text("businessDiscoveryMissing")}</p>}
    </div>}
    {program.stage === "DRAFT" && <ActionForm action={configurePrivateBetaBusiness}><input type="hidden" name="program_id" value={program.id}/><input type="hidden" name="expected_generation" value={program.generation}/>
      <div className="polat-columns"><label>{text("businessRepresentative")}<input name="representative_user_id" inputMode="numeric" pattern="[1-9][0-9]{0,18}" minLength={1} maxLength={19} defaultValue={scope?.representative_user_id ?? proposed?.representative_user_id ?? ""} required autoComplete="off"/></label><label>{text("businessFounder")}<input name="founder_chat_id" inputMode="numeric" pattern="[1-9][0-9]{0,18}" minLength={1} maxLength={19} defaultValue={scope?.founder_chat_id ?? proposedFounder} required autoComplete="off"/></label></div>
      <label>{text("businessConnection")}<input name="business_connection_id" defaultValue={proposed?.business_connection_id ?? ""} minLength={1} maxLength={160} required autoComplete="off" aria-describedby="beta-business-hint"/></label><p className="muted" id="beta-business-hint">{text("businessHint")}</p><button className="secondary-button" type="submit">{text("businessSave")}</button>
    </ActionForm>}
    {scope && ["BLOCKED", "CONFIGURED_UNVERIFIED"].includes(scope.state) && program.stage !== "STOPPED" && <ActionForm action={reverifyPrivateBetaBusiness} repeatable={false}><input type="hidden" name="program_id" value={program.id}/><input type="hidden" name="business_generation" value={scope.business_generation}/><p>{text("businessReverifyText")}</p><button className="secondary-button" type="submit">{text("businessReverify")}</button></ActionForm>}
  </section>;
}

export function PrivateBetaFilters({ size, collection = "attempts" }: { size: string; collection?: "attempts" | "notes" }) { const { text } = useCopy(); return <form method="get" className="filter-panel"><input type="hidden" name="view" value="beta"/>{collection === "notes" && <input type="hidden" name="beta_collection" value="notes"/>}<label>{text("pageSize")}<select name="size" defaultValue={size}>{["25", "50", "100"].map(value => <option key={value} value={value}>{value}</option>)}</select></label><button className="secondary-button" type="submit">{text("filter")}</button></form>; }

function BetaNote({ note, canConversation }: { note: PrivateBetaWorkspace["notes"][number]; canConversation: boolean }) {
  const { text, locale } = useCopy(); const feedback = privateBetaFeedback(note);
  return <article className="polat-record"><strong>{text(feedback ? "testerFeedback" : note.author === "TESTER" ? "testerEvidence" : note.author === "SYSTEM" ? "systemNote" : "operatorNote")} · {note.scenario} · {statusLabel(note.outcome, locale)}</strong>
    {feedback ? <dl className="polat-facts">{(["useful", "natural", "correct", "satisfied"] as const).map(key => <div key={key}><dt>{text(key)}</dt><dd><AdminNumber value={feedback[key]}/> / 5</dd></div>)}</dl> : <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{note.note}</p>}
    <small><AdminDate value={note.created_at}/></small>{note.conversation_id && canConversation && <p><Link href={`/admin/conversations/${note.conversation_id}`}>{text("conversation")}</Link></p>}
  </article>;
}

export function PolatPrivateBeta({ workspace, invalid, denied, size, canConfigure, canNote, canConversation, operators, collection = "attempts", notesPage = null, canAcceptOperator = false, starsCommandId = null, businessScope = null, businessUnavailable = false, businessDiscovery = null, businessDiscoveryUnavailable = false }: { workspace: PrivateBetaWorkspace | null; invalid: boolean; denied: boolean; size: string; canConfigure: boolean; canNote: boolean; canConversation: boolean; operators: BetaOperator[] | null; collection?: "attempts" | "notes"; notesPage?: PrivateBetaNotesPage | null; canAcceptOperator?: boolean; starsCommandId?: string | null; businessScope?: PrivateBetaBusinessScope | null; businessUnavailable?: boolean; businessDiscovery?: PrivateBetaBusinessDiscovery | null; businessDiscoveryUnavailable?: boolean }) {
  const { text, locale } = useCopy();
  if (denied) return <p className="warning-box" role="status">{text("denied")}</p>;
  if (!workspace) return <p className="warning-box" role="status">{text(invalid ? "invalid" : "unavailable")}</p>;
  const program = workspace.program;
  return <section aria-labelledby="private-beta-heading"><h2 id="private-beta-heading">{text("title")}</h2><p className="muted">{text("basis")}</p><p className="warning-box">{text("ceiling")}</p>
    {(canConfigure || canAcceptOperator) && <PrivateBetaMfa/>}
    {!program ? <><p className="empty-state">{text("empty")}</p>{canConfigure && <section className="form-panel"><h3>{text("setup")}</h3><p>{text("setupText")}</p><ActionForm action={createPrivateBetaTenant} repeatable={false}><button className="secondary-button" type="submit">{text("bootstrap")}</button></ActionForm></section>}</> : <>
      {canConfigure && program.stage === "CANARY" && program.canary_state === "NOT_STARTED" && <CanaryControl program={program}/>}
      {canConfigure && program.stage !== "STOPPED" && starsCommandId && <StarsInvoiceControl programId={program.id} commandId={starsCommandId}/>}
      <div className="polat-columns"><section className="table-card"><h3>{text("stage")}</h3><dl className="polat-facts"><div><dt>{text("stage")}</dt><dd>{statusLabel(program.stage, locale)}</dd></div><div><dt>{text("configuration")}</dt><dd>{text(program.configuration_complete ? "complete" : "incomplete")}</dd></div><div><dt>{text("account")}</dt><dd>{statusLabel(program.account_state, locale)}</dd></div><div><dt>{text("canary")}</dt><dd>{statusLabel(program.canary_state, locale)}</dd></div><div><dt>{text("starts")}</dt><dd><AdminDate value={program.starts_at}/></dd></div><div><dt>{text("expires")}</dt><dd><AdminDate value={program.expires_at}/></dd></div><div><dt>{text("retention")}</dt><dd>{program.retention_days === null ? text("unknown") : <AdminNumber value={program.retention_days}/>}</dd></div><div><dt>{text("primary")}</dt><dd>{text(program.primary_operator_configured ? "operatorConfigured" : "operatorMissing")}</dd></div><div><dt>{text("backup")}</dt><dd>{text(program.backup_operator_configured ? "operatorConfigured" : "operatorMissing")}</dd></div></dl></section><section className="table-card"><h3>{text("requests")}</h3><dl className="polat-facts"><div><dt>{text("requests")}</dt><dd><AdminNumber value={program.global_requests}/> / <AdminNumber value={program.maximum_requests}/></dd></div><div><dt>{text("reserved")}</dt><dd>{program.reserved_liability === null ? text("restricted") : <><AdminDecimal value={program.reserved_liability}/> {program.currency}</>}</dd></div><div><dt>{text("billing")}</dt><dd>{program.actual_billed_amount === null ? text(program.billing_status === "ROLE_RESTRICTED" ? "restricted" : "unknown") : <><AdminDecimal value={program.actual_billed_amount}/> {program.currency}</>}</dd></div><div><dt>{text("count")}</dt><dd><AdminNumber value={workspace.participants.length}/></dd></div></dl></section></div>
      {canAcceptOperator && <section className="form-panel"><h3>{text("operatorAccept")}</h3><p>{text("operatorAcceptText")}</p><ActionForm action={acceptPrivateBetaOperator} repeatable={false}><input type="hidden" name="program_id" value={program.id}/><button className="secondary-button" type="submit">{text("operatorAccept")}</button></ActionForm></section>}
      {canConfigure && <BusinessConfiguration program={program} scope={businessScope} unavailable={businessUnavailable} discovery={businessDiscovery} discoveryUnavailable={businessDiscoveryUnavailable}/>}
      <section className="table-card"><h3>{text("participants")}</h3>{!workspace.participants.length ? <p className="empty-state">{text("noParticipants")}</p> : <div className="polat-work-list">{workspace.participants.map((participant, index) => <article className="polat-record" key={participant.id}><h4>{text(participant.kind === "FOUNDER" ? "founder" : "friend")} {index + 1}</h4><p className="state-pill">{statusLabel(participant.status, locale)}</p><dl className="polat-facts"><div><dt>{text("used")}</dt><dd><AdminNumber value={participant.model_requests}/> / <AdminNumber value={participant.maximum_requests}/></dd></div><div><dt>{text("joined")}</dt><dd><AdminDate value={participant.joined_at}/></dd></div></dl>{participant.conversation_id && canConversation ? <Link className="secondary-button" href={`/admin/conversations/${participant.conversation_id}`}>{text("conversation")}</Link> : <p>{text("noConversation")}</p>}</article>)}</div>}</section>
      {canConfigure && program.stage !== "STOPPED" && <section className="form-panel"><h3>{text("invites")}</h3><p>{text("inviteText")}</p><ActionForm action={createPrivateBetaInvitation}><input type="hidden" name="program_id" value={program.id}/><label>{text("kind")}<select name="kind" defaultValue={businessScope || !workspace.participants.some(participant => participant.kind === "FOUNDER") ? "FOUNDER" : "FRIEND"}><option value="FOUNDER">{text("founder")}</option><option value="FRIEND" disabled={businessScope !== null}>{text("friend")}</option></select></label><button className="secondary-button" type="submit">{text("inviteCreate")}</button></ActionForm></section>}
      {collection === "attempts" && <section className="table-card"><h3>{text("attempts")}</h3>{!workspace.attempts.length ? <p className="empty-state">{text("noAttempts")}</p> : <div className="table-scroll"><table><thead><tr><th>{text("scope")}</th><th>{text("status")}</th><th>{text("qa")}</th><th>{text("tokens")}</th><th>{text("actual")}</th><th>{text("time")}</th></tr></thead><tbody>{workspace.attempts.map(attempt => <tr key={attempt.id}><td>{statusLabel(attempt.scope, locale)}</td><td>{statusLabel(attempt.status, locale)}</td><td>{statusLabel(attempt.qa, locale)}</td><td>{attempt.input_tokens === null ? text("unknown") : <AdminNumber value={attempt.input_tokens}/>} / {attempt.output_tokens === null ? text("unknown") : <AdminNumber value={attempt.output_tokens}/>}</td><td>{attempt.actual_billed_amount === null ? text(attempt.billing_status === "ROLE_RESTRICTED" ? "restricted" : "unknown") : <><AdminDecimal value={attempt.actual_billed_amount}/> {program.currency}</>}</td><td><AdminDate value={attempt.created_at}/></td></tr>)}</tbody></table></div>}<nav className="pagination" aria-label={text("attempts")}><Link href={privateBetaHref(size)}>{text("first")}</Link>{workspace.next_cursor && <Link href={privateBetaHref(size, workspace.next_cursor)}>{text("more")}</Link>}</nav></section>}
      <section className="table-card"><h3>{text(collection === "notes" ? "allNotes" : "notes")}</h3><p className="muted">{text("notesText")}</p><nav className="polat-actions" aria-label={text("notes")}><Link className="secondary-button" aria-current={collection === "attempts" ? "page" : undefined} href={privateBetaHref(size)}>{text("attempts")}</Link><Link className="secondary-button" aria-current={collection === "notes" ? "page" : undefined} href={privateBetaHref(size, null, "notes")}>{text("allNotes")}</Link></nav>
      {collection === "notes" && !notesPage ? <p className="warning-box" role="status">{text(invalid ? "invalid" : "unavailable")}</p> : <>{!(collection === "notes" ? notesPage?.items.length : workspace.notes.length) && <p className="empty-state">{text("noNotes")}</p>}{(collection === "notes" ? notesPage?.items ?? [] : workspace.notes).map(note => <BetaNote key={note.id} note={note} canConversation={canConversation}/>)}</>}
      {collection === "attempts" && workspace.notes_has_more && <p className="warning-box">{text("notesMore")} <Link href={privateBetaHref(size, null, "notes")}>{text("allNotes")}</Link></p>}
      {collection === "notes" && notesPage && <nav className="pagination" aria-label={text("allNotes")}><Link href={privateBetaHref(size, null, "notes")}>{text("first")}</Link>{notesPage.next_cursor && <Link href={privateBetaHref(size, notesPage.next_cursor, "notes")}>{text("nextNotes")}</Link>}</nav>}</section>
      {canNote && <section className="form-panel"><h3>{text("noteSave")}</h3><ActionForm action={recordPrivateBetaNote}><input type="hidden" name="program_id" value={program.id}/><label>{text("conversation")}<select name="conversation_id" defaultValue=""><option value="">{text("wholeProgram")}</option>{workspace.participants.filter(participant => participant.conversation_id).map((participant, index) => <option value={participant.conversation_id!} key={participant.id}>{text(participant.kind === "FOUNDER" ? "founder" : "friend")} {index + 1}</option>)}</select></label><label>{text("scenario")}<input name="scenario" maxLength={80} required/></label><label>{text("outcome")}<select name="outcome" defaultValue="NOTE">{["NOTE", "PASS", "FAIL", "NOT_TESTED", "BLOCKED"].map(outcome => <option key={outcome} value={outcome}>{statusLabel(outcome, locale)}</option>)}</select></label><label>{text("note")}<textarea name="note" rows={3} maxLength={1000} required aria-describedby="beta-note-hint"/></label><p className="muted" id="beta-note-hint">{text("noteHint")}</p><button className="secondary-button" type="submit">{text("noteSave")}</button></ActionForm></section>}
    </>}
    {canConfigure && (!program || program.stage === "DRAFT") && <Configuration program={program} operators={operators}/>}
    <details className="table-card polat-record"><summary>{text("setupFields")}</summary><p>{text("setupFieldsText")}</p><ul>{["OPENAI_API_KEY", "POLAT_UAT_ANTHROPIC_API_KEY", "POLAT_UAT_TELEGRAM_BOT_TOKEN", "POLAT_UAT_TELEGRAM_WEBHOOK_SECRET", "POLAT_UAT_TENANT_ID", "POLAT_UAT_PROGRAM_ID", "POLAT_UAT_RELEASE_SHA", "POLAT_UAT_RELAY_SECRET", "POLAT_UAT_STARS_TEST_BOT_TOKEN"].map(name => <li key={name}><code>{name}</code></li>)}</ul></details><p className="muted">{text("financial")}</p>
  </section>;
}
