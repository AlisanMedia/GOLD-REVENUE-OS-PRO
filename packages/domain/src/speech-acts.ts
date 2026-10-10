export const SPEECH_ACTS = ["ACKNOWLEDGEMENT", "PREFERENCE_CONFIRMATION", "CAPABILITY_OFFER", "PROSPECTIVE_ACTION", "COMMITMENT", "COMPLETED_ACTION", "BACKEND_FACT", "CUSTOMER_REPORTED_FACT", "BUSINESS_FACT", "UNKNOWN_ASSERTION", "QUESTION", "KNOWLEDGE_LIMITATION", "QUALIFIED_INFERENCE", "IDENTITY_RESPONSE"] as const;
export type SpeechAct = (typeof SPEECH_ACTS)[number];
export const CONVERSATION_CAPABILITIES = ["conversation.reply", "conversation.explain_known", "conversation.prepare_review", "preference.reply_language"] as const;
export type ConversationCapability = (typeof CONVERSATION_CAPABILITIES)[number];

const preference = /(?:reply|respond|speak|answer).*(?:English|Turkish|Arabic|Russian)|(?:İngilizce|Türkçe|Arapça|Rusça).*(?:yanıt|cevap|konuş|yaz)|(?:بالإنجليزية|بالعربية|بالتركية|بالروسية)|(?:отвечать|отвечу|говорить).*(?:английск|русск|турецк|арабск)/iu;
const future = /\b(?:I['’]ll|will|we['’]ll)\b|(?:göndereceğim|ileteceğim|yapacağım|olacaktır|gönderilecek)|سوف|سأ(?:رسل|راجع|حدث)|я (?:отправлю|проверю|обновлю)/iu;
const offer = /\b(?:can|could)\b|olabilirim|(?:açıklayabilirim|inceletebilirim)|(?:يمكنني|أستطيع)|(?:могу|можем)/iu;
const operational = /(?:check|verify|confirm|activate|save|send|forward|update).*(?:account|payment|access|preference|support)|(?:hesap|ödeme|erişim).*(?:kontrol|doğrula|aç)|(?:تحقق|تفعيل|أرسل|حفظ).*(?:حساب|دفع|وصول)|(?:провер|активир|отправ|сохрани).*(?:аккаунт|оплат|доступ)/iu;
export function isConventionalCompoundGreeting(text: string): boolean {
  // Exact whole-utterance grammar: greeting + conversational help question.
  // No business clause, operational offer, promise or appended sentence is accepted.
  return [
    /^(?:hi|hello|hey)[,!.-]?\s+(?:how can i help(?: you)?(?: today)?|what can i help(?: you)? with)\?$/iu,
    /^(?:merhaba|selam)[,!.-]?\s+(?:nasıl|size nasıl|sana nasıl) yardımcı olabilirim\?$/iu,
    /^(?:مرحبا|مرحباً)[,!،.-]?\s+(?:كيف يمكنني مساعدتك|كيف أساعدك|بماذا يمكنني مساعدتك)[?؟]$/iu,
    /^(?:привет|здравствуйте)[,!.-]?\s+(?:чем могу помочь|чем я могу вам помочь|как я могу вам помочь)\?$/iu,
  ].some((pattern) => pattern.test(text.normalize("NFKC").trim()));
}
export function inferredSpeechAct(claim: { kind: string; grounding: string; text: string }): SpeechAct {
  if (claim.kind === "completed_action") return "COMPLETED_ACTION";
  if (claim.kind === "question") return "QUESTION";
  if (claim.kind === "uncertainty") return "KNOWLEDGE_LIMITATION";
  if (claim.kind === "fact") return claim.grounding === "CUSTOMER_REPORTED" ? "CUSTOMER_REPORTED_FACT" : claim.grounding === "INFERRED" ? "QUALIFIED_INFERENCE" : "BUSINESS_FACT";
  if (preference.test(claim.text)) return "PREFERENCE_CONFIRMATION";
  if (future.test(claim.text)) return "COMMITMENT";
  if (offer.test(claim.text)) return /review|incele|مراجعة|рассмотр/iu.test(claim.text) ? "PROSPECTIVE_ACTION" : "CAPABILITY_OFFER";
  if (/\b(?:AI|automated)\b|yapay|اصطناعي|искусственн/iu.test(claim.text)) return "IDENTITY_RESPONSE";
  return claim.kind === "social" ? "ACKNOWLEDGEMENT" : "UNKNOWN_ASSERTION";
}

export function validateServiceSpeechAct(input: {
  act: SpeechAct; text: string; language?: string | undefined;
  capability?: ConversationCapability | null | undefined;
  availableCapabilities: readonly ConversationCapability[];
  guaranteedCommitments: readonly ConversationCapability[];
}) {
  if (input.act === "UNKNOWN_ASSERTION") return false;
  if (input.act === "ACKNOWLEDGEMENT") {
    if (isConventionalCompoundGreeting(input.text)) return input.availableCapabilities.includes("conversation.reply")
      && (input.capability == null || input.capability === "conversation.reply");
    // Structured acknowledgements may contain empathy/greetings, never an
    // operational predicate or a future promise. Facts are checked separately.
    return !operational.test(input.text) && !future.test(input.text) && !offer.test(input.text);
  }
  if (input.act === "PREFERENCE_CONFIRMATION") {
    const languageTerms: Record<string, RegExp> = { en: /English|İngilizce|الإنجليزية|английск/iu, tr: /Turkish|Türkçe|التركية|турецк/iu, ar: /Arabic|Arapça|العربية|арабск/iu, ru: /Russian|Rusça|الروسية|русск/iu };
    return Boolean(input.language && languageTerms[input.language]?.test(input.text)) && !/sav(?:e|ed)|permanent|kalıcı|kaydet|حفظ|сохран/iu.test(input.text);
  }
  if (["CAPABILITY_OFFER", "PROSPECTIVE_ACTION", "COMMITMENT"].includes(input.act)) {
    if (operational.test(input.text)) return false; // No operational capability/commitment is enabled in Phase 7.
    // Whole, prospective drafting offer only: neither a completed review nor
    // sending/contacting anyone. A model label cannot append business clauses.
    if (input.act !== "COMMITMENT" && /^(?:İstersen )?(?:bunun için )?(?:kısa bir |bir )?inceleme notu hazırlayabilirim[.!]?$/iu.test(input.text.normalize("NFKC").trim())) {
      return input.capability === "conversation.prepare_review"
        && input.availableCapabilities.includes("conversation.prepare_review");
    }
    if (/(?:explain|açıkla|شرح|объясн).*(?:membership|subscription|plan|üyelik|abonelik|عضوية|اشتراك|подписк)/iu.test(input.text)
      && !input.availableCapabilities.includes("conversation.explain_known")) return false;
    const capability = input.capability ?? (input.act === "PROSPECTIVE_ACTION" ? "conversation.prepare_review" : "conversation.reply");
    return (input.act === "COMMITMENT" ? input.guaranteedCommitments : input.availableCapabilities).includes(capability)
      && (input.act === "COMMITMENT" ? future.test(input.text) : offer.test(input.text));
  }
  return false;
}
