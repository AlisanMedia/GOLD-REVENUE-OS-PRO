export const SPEECH_ACTS = ["ACKNOWLEDGEMENT", "PREFERENCE_CONFIRMATION", "CAPABILITY_OFFER", "PROSPECTIVE_ACTION", "COMMITMENT", "COMPLETED_ACTION", "BACKEND_FACT", "CUSTOMER_REPORTED_FACT", "BUSINESS_FACT", "UNKNOWN_ASSERTION", "QUESTION", "KNOWLEDGE_LIMITATION", "QUALIFIED_INFERENCE", "IDENTITY_RESPONSE"] as const;
export type SpeechAct = (typeof SPEECH_ACTS)[number];
export const CONVERSATION_CAPABILITIES = ["conversation.reply", "conversation.explain_known", "conversation.prepare_review", "preference.reply_language"] as const;
export type ConversationCapability = (typeof CONVERSATION_CAPABILITIES)[number];

const preference = /(?:reply|respond|speak|answer).*(?:English|Turkish|Arabic|Russian)|(?:İngilizce|Türkçe|Arapça|Rusça).*(?:yanıt|cevap|konuş|yaz)|(?:بالإنجليزية|بالعربية|بالتركية|بالروسية)|(?:отвечать|отвечу|говорить).*(?:английск|русск|турецк|арабск)/iu;
const future = /\b(?:I['’]ll|will|we['’]ll)\b|(?:göndereceğim|ileteceğim|yapacağım|olacaktır|gönderilecek)|سوف|سأ(?:رسل|راجع|حدث)|я (?:отправлю|проверю|обновлю)/iu;
const offer = /\b(?:can|could)\b|olabilirim|(?:açıklayabilirim|inceletebilirim)|(?:يمكنني|أستطيع)|(?:могу|можем)/iu;
const operational = /(?:check|verify|confirm|activate|save|send|forward|update).*(?:account|payment|access|preference|support)|(?:hesap|ödeme|erişim).*(?:kontrol|doğrula|aç)|(?:تحقق|تفعيل|أرسل|حفظ).*(?:حساب|دفع|وصول)|(?:провер|активир|отправ|сохрани).*(?:аккаунт|оплат|доступ)/iu;
// Whole conversational offers describe clarification, not catalog knowledge.
// In particular, "what the membership includes" is an embedded question,
// not the affirmative business assertion "the membership includes X".
export function isConversationalClarificationOffer(text: string): boolean {
  const whole = text.normalize("NFKC").trim().replace(/[.!]$/u, "");
  const list = /^(?:I can help(?: you)? (?:clarify|explain|with)|You can ask about)\s+(.+)$/iu.exec(whole)?.[1];
  if (list) {
    // An illustrative introduction still names topics, never catalog values.
    // Remove only the bounded noun introduction before validating every item.
    const topicList = list.replace(/^(?:the )?(?:monthly )?(?:membership|subscription) (?:details|questions),?\s+(?:like|such as|including)\s+/iu, "")
      .replace(/^questions about\s+/iu, "");
    const topics = topicList.replace(/,\s*(?:and|or)\s+/giu, ",").split(/,\s*|\s+(?:and|or)\s+/iu);
    const topic = /^(?:(?:the )?(?:monthly )?(?:membership |subscription )?(?:(?:price|pricing|cost)(?: details| questions)?|details|cancellation terms)|what['’]s included|what (?:the )?(?:membership|subscription) includes|how it works|access after payment|(?:general )?access(?: questions)?|any general questions you have)$/iu;
    if (topics.length >= 1 && topics.length <= 4 && topics.every((item) => topic.test(item.trim()))) return true;
  }
  return [
    // Whole topic-only help offer. No asserted option, catalog value or action;
    // the caller still requires the real reply capability and valid references.
    /^(?:Yes\s*[—–-]\s*)?I can help explain membership options[.!]?$/iu,
    /^İstersen (?:başka bir )?üyelik sorusunu netleştirmeye çalışabilirim[.!]?$/iu,
    /^I can help clarify what the membership includes, how it works, and any general questions you have[.!]?$/iu,
    /^I can help(?: you)? clarify the (?:monthly )?price, what['’]s included, and (?:the )?cancellation terms[.!]?$/iu,
  ].some((pattern) => pattern.test(text.normalize("NFKC").trim()));
}
export function isRepresentativePurpose(text: string): boolean {
  return /^Amacım sorularınızı yanıtlamak ve neye ihtiyacınız olduğunu netleştirmeye yardımcı olmak[.!]?$/iu.test(text.normalize("NFKC").trim());
}
export function isBoundedTurkishKnowledgeLimitation(text: string): boolean {
  const whole = text.normalize("NFKC").trim();
  return /^(?:(?:üyeliğin|aboneliğin) (?:fiyatı|içeriği|fiyatı ve içeriği|(?:fiyat ve içerik |fiyat |içerik )?detayları)|(?:üyelik|abonelik) detayları) (?:şu an(?:da)? |henüz |şimdilik )?(?:net|kesin|belirli) değil[.!]?$/iu.test(whole)
    || /^Üyelik bedava mı, şu an net değil[.!]?$/iu.test(whole)
    || /^(?:üyeliğin|aboneliğin) (?:ücretsiz|bedava) olup olmadığı (?:şu an(?:da)? |henüz |şimdilik )?(?:net|kesin|belirli) değil[.!]?$/iu.test(whole);
}
export function isDraftedReviewQuestion(text: string): boolean {
  const whole = text.normalize("NFKC").trim();
  if (/^Here['’]s a short review question: What does the monthly membership cost, and what is included\?$/iu.test(whole)) return true;
  // Parse the visibly drafted question, including paired presentation quotes.
  // The entire body is a finite topic question; appended values/actions fail.
  const body = /^(?:Sure\s*[—–-]\s*)?Here(?: is|['’]s) (?:a |the )?(?:short )?(?:review question|question (?:to|for) review):\s*(.+)$/iu.exec(whole)?.[1];
  if (!body) return false;
  const paired = /^“(.+)”$/u.exec(body)?.[1] ?? /^"(.+)"$/u.exec(body)?.[1] ?? body;
  return /^(?:What is included in the monthly membership, and what is the price|What does the monthly membership (?:cost, and what is included|include, and what is the price))\?$/iu.test(paired);
}
export function isDraftedReviewIntroduction(text: string): boolean {
  return /^Here(?: is|['’]s) (?:a |the )?(?:short )?(?:review question|question (?:to|for) review):$/iu.test(text.normalize("NFKC").trim());
}
export function isProspectiveReviewNoteOffer(text: string): boolean {
  return /^(?:İstersen )?(?:bunun için )?(?:kısa bir |bir )?inceleme notu hazırlayabilirim[.!]?$/iu.test(text.normalize("NFKC").trim());
}
export function isMembershipClarificationQuestion(text: string): boolean {
  return /^Which (?:membership|subscription|plan) (?:are you asking about|do you mean)\?$/iu.test(text.normalize("NFKC").trim());
}
export function isConventionalCompoundGreeting(text: string): boolean {
  // Exact whole-utterance grammar: greeting + conversational help question.
  // No business clause, operational offer, promise or appended sentence is accepted.
  return [
    /^(?:hi|hello|hey)\s*[,!.\u2013\u2014-]?\s+(?:how can i help(?: you)?(?: today)?|what can i help(?: you)? with)\?$/iu,
    /^(?:merhaba|selam)\s*[,!.\u2013\u2014-]?\s+(?:nasıl|size nasıl|sana nasıl) yardımcı olabilirim\?$/iu,
    /^(?:مرحبا|مرحباً)\s*[,!،.\u2013\u2014-]?\s+(?:كيف يمكنني مساعدتك|كيف أساعدك|بماذا يمكنني مساعدتك)[?؟]$/iu,
    /^(?:привет|здравствуйте)\s*[,!.\u2013\u2014-]?\s+(?:чем могу помочь|чем я могу вам помочь|как я могу вам помочь)\?$/iu,
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
  // A whole reply-style confirmation remains conversational even when the
  // model labels the acknowledgement rather than the future preference.
  const styleConfirmation = /^(?:(?:understood|got it)\s*[,!.\u2013\u2014-]\s*)?I['’]ll (?:reply|respond|answer) (?:only )?in (English|Turkish|Arabic|Russian)(?: and (?:I )?(?:won['’]t|will not) use emojis| without emojis)?[.!]?$/iu.exec(input.text.normalize("NFKC").trim());
  if (["ACKNOWLEDGEMENT", "PREFERENCE_CONFIRMATION", "COMMITMENT"].includes(input.act) && styleConfirmation) {
    const languages: Record<string, string> = { English: "en", Turkish: "tr", Arabic: "ar", Russian: "ru" };
    const declaredLanguage = Object.entries(languages).find(([name]) => name.toLowerCase() === styleConfirmation[1]?.toLowerCase())?.[1];
    return declaredLanguage === input.language && input.availableCapabilities.includes("conversation.reply")
      && (input.capability == null || ((input.capability === "conversation.reply" || input.capability === "preference.reply_language")
        && input.availableCapabilities.includes(input.capability)));
  }
  // A bounded reply-length acknowledgement is not an operational guarantee,
  // even when the model uses COMMITMENT instead of PREFERENCE_CONFIRMATION.
  if (["PREFERENCE_CONFIRMATION", "COMMITMENT"].includes(input.act)
    && /^I['’]ll keep (?:it|my replies) (?:brief|short|concise)[.!]?$/iu.test(input.text.normalize("NFKC").trim())) {
    return input.availableCapabilities.includes("conversation.reply")
      && (input.capability == null || input.capability === "conversation.reply");
  }
  // A whole greeting + help question can legitimately be labelled QUESTION
  // within a social claim. The exact grammar and capability boundary govern it.
  if (["ACKNOWLEDGEMENT", "QUESTION"].includes(input.act) && isConventionalCompoundGreeting(input.text)) {
    return input.availableCapabilities.includes("conversation.reply")
      && (input.capability == null || input.capability === "conversation.reply");
  }
  if (input.act === "ACKNOWLEDGEMENT") {
    // Structured acknowledgements may contain empathy/greetings, never an
    // operational predicate or a future promise. Facts are checked separately.
    return !operational.test(input.text) && !future.test(input.text) && !offer.test(input.text);
  }
  if (input.act === "PREFERENCE_CONFIRMATION") {
    const languageTerms: Record<string, RegExp> = { en: /English|İngilizce|الإنجليزية|английск/iu, tr: /Turkish|Türkçe|التركية|турецк/iu, ar: /Arabic|Arapça|العربية|арабск/iu, ru: /Russian|Rusça|الروسية|русск/iu };
    return Boolean(input.language && languageTerms[input.language]?.test(input.text))
      && !operational.test(input.text)
      && !/sav(?:e|ed)|permanent|kalıcı|kaydet|حفظ|сохран|\b(?:contact|escalate|forward|send)\b|ilet|gönder|أرسل|отправ|переда/iu.test(input.text);
  }
  if (["CAPABILITY_OFFER", "PROSPECTIVE_ACTION", "COMMITMENT"].includes(input.act)) {
    if (operational.test(input.text)) return false; // No operational capability/commitment is enabled in Phase 7.
    if (input.act !== "COMMITMENT" && (isConversationalClarificationOffer(input.text) || isRepresentativePurpose(input.text))) {
      if (/^You can ask about\s/iu.test(input.text.trim())) {
        return input.availableCapabilities.includes("conversation.reply")
          && (input.capability === "conversation.reply" || input.capability === "conversation.prepare_review")
          && input.availableCapabilities.includes(input.capability);
      }
      return input.capability === "conversation.reply" && input.availableCapabilities.includes("conversation.reply");
    }
    if (input.act !== "COMMITMENT" && isDraftedReviewQuestion(input.text)) {
      return input.capability === "conversation.prepare_review" && input.availableCapabilities.includes("conversation.prepare_review");
    }
    if (input.act !== "COMMITMENT" && isDraftedReviewIntroduction(input.text)) {
      // Grounding additionally requires the actual question in the next claim.
      return input.availableCapabilities.includes("conversation.prepare_review")
        && (input.capability === "conversation.prepare_review" || input.capability === "conversation.reply")
        && input.availableCapabilities.includes(input.capability);
    }
    // Whole, prospective drafting offer only: neither a completed review nor
    // sending/contacting anyone. A model label cannot append business clauses.
    if (input.act !== "COMMITMENT" && isProspectiveReviewNoteOffer(input.text)) {
      return input.availableCapabilities.includes("conversation.prepare_review")
        && (input.capability === "conversation.prepare_review" || input.capability === "conversation.reply")
        && input.availableCapabilities.includes(input.capability);
    }
    if (/(?:explain|açıkla|شرح|объясн).*(?:membership|subscription|plan|üyelik|abonelik|عضوية|اشتراك|подписк)/iu.test(input.text)
      && !input.availableCapabilities.includes("conversation.explain_known")) return false;
    const capability = input.capability ?? (input.act === "PROSPECTIVE_ACTION" ? "conversation.prepare_review" : "conversation.reply");
    return (input.act === "COMMITMENT" ? input.guaranteedCommitments : input.availableCapabilities).includes(capability)
      && (input.act === "COMMITMENT" ? future.test(input.text) : offer.test(input.text));
  }
  return false;
}
