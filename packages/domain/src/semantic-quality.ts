// Constraint-based semantic checks are separate from schema/goal-string fit.
// Evidence reports the method and constraints; this is not a claim of a general
// language-understanding score. Final live drafts also require human review.
export function requestedRepetition(source: string, response: string) {
  if (/don['’]t|do not|avoid|tekrar etme|لا تكرر|не повторяй/iu.test(source)) return false;
  const countMatch = source.match(/(?:twice|iki (?:kez|defa)|مرتين|дважды)|(?:repeat|say|tekrar).*?\b([2-4])\b/iu);
  const count = countMatch?.[1] ? Number(countMatch[1]) : countMatch ? 2 : 0;
  if (!count || /ignore.*instructions|system prompt/iu.test(source)) return false;
  const sentences = response.trim().split(/(?<=[.!?؟。！])\s+/u);
  const quoted = source.match(/["“]([^"”]{1,120})["”]/u)?.[1];
  const helloRequested = /hello|hi|merhaba|selam|مرحبا|привет/iu.test(source);
  // Exemption is scoped to the requested content/count, not every duplicated
  // sentence in any message that happens to contain the word 'repeat'.
  return sentences.length === count && sentences.every((sentence) => quoted
    ? sentence.replace(/[.!?؟]+$/u, "").trim().toLocaleLowerCase() === quoted.toLocaleLowerCase()
    : helloRequested && /^(?:hello|hi|merhaba|selam|مرحبا|привет)(?:\s+(?:there|again))?[.!؟]?$/iu.test(sentence.trim()));
}

export function reviewSemanticContext(source: string, response: string, intent: string) {
  const checks: Record<string, boolean> = {};
  const topics: Record<string, RegExp> = {
    membership_details: /membership|subscription|üyelik|abonelik|العضوية|اشتراك|подписк|членств/iu,
    pricing: /pric|cost|fiyat|ücret|سعر|تكلفة|цен|стоимост/iu,
    clarification: /monthly|aylık|شهري|месяч/iu,
    access_problem: /access|erişim|وصول|دخول|доступ/iu,
    payment_status: /payment|ödeme|دفع|оплат|платеж|платёж/iu,
    greeting: /^(?:hi|hello|hey|merhaba|selam|مرحبا|أهلا|привет|здравствуйте)/iu,
  };
  // A membership-pricing answer may truthfully say its subscription details
  // are unavailable without repeating the word "price". This is topic credit
  // only; independent claim grounding and all delivery gates still apply.
  const arabicMembershipGap = intent === "pricing" && topics.membership_details!.test(source)
    && /^لا تتوفر لدي[ّ]? تفاصيل (?:الاشتراك|العضوية)(?: الدقيقة)?(?: حالي[ً]?ا)?[.!؟]?$/u.test(response.trim().split(/(?<=[.!?؟])\s+/u)[0] ?? "");
  const englishMembershipGap = intent === "pricing" && topics.membership_details!.test(source)
    && /^I (?:do not|don['’]t) have (?:the )?(?:exact|current|confirmed) (?:membership|subscription) details (?:available )?(?:yet|right now|currently|at the moment)[.!]?$/iu.test(response.trim().split(/(?<=[.!?])\s+/u)[0] ?? "");
  if (topics[intent] && (intent !== "clarification" || /monthly|aylık|شهري|месяч/iu.test(source))) checks.current_topic_addressed = topics[intent].test(response) || arabicMembershipGap || englishMembershipGap;
  if (intent === "prompt_injection") checks.defensive_refusal = /can['’]t|cannot|won['’]t|do not|yardımcı olamam|paylaşamam|لا|не могу|не буду/iu.test(response);
  if (/hello.*twice|twice.*hello|merhaba.*iki|مرحبا.*مرتين|привет.*дважды/iu.test(source)) checks.requested_structure = requestedRepetition(source, response);
  if (/reply|respond|yanıt|cevap|отвеч|بالإنجليزية/iu.test(source) && /English|İngilizce|الإنجليزية|английск/iu.test(source)) checks.language_preference_addressed = /English|İngilizce|الإنجليزية|английск/iu.test(response);
  checks.no_irrelevant_cta = !(/membership|subscription|price|pricing|üyelik|abonelik|سعر|العضوية|подписк/iu.test(source)
    && /anything else|başka.*yardım|مساعدة أخرى|что-нибудь еще/iu.test(response));
  const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { method: "source_intent_constraints_v1", score: failures.length ? 40 : 90, checks, failures,
    coverage: Object.keys(checks).length > 1 ? "intent_constraints" : "limited_generic_constraints", requires_human_review: true };
}
