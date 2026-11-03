/** Customer conversation identity. Historical fixture/canary policies are kept
 * separately so accepted evidence is never relabelled as this policy. */
export const POLAT_SUPPORT_IDENTITY_POLICY = "polat-support-identity-v1";
export const polatSupportIdentity = {
  en: { brand: "Polat VIP support.", automation: "This is Polat VIP's automated support.", denial: "I'm not Polat." },
  tr: { brand: "Polat VIP destek.", automation: "Bu, Polat VIP’nin otomatik destek sistemidir.", denial: "Polat’ın kendisi değilim." },
  ar: { brand: "دعم Polat VIP.", automation: "هذا نظام الدعم الآلي لـ Polat VIP.", denial: "أنا لست بولات." },
  ru: { brand: "Поддержка Polat VIP.", automation: "Это автоматическая поддержка Polat VIP.", denial: "Я не Полат." },
} as const;

const normalize = (text: string) => text.normalize("NFKC").replace(/[’‘`]/gu, "'").replaceAll("İ", "i").toLowerCase();
const automation = /\bautomated support\b|\bautomatic support\b|\b(?:i'm|i am|this is) (?:an? )?(?:ai|chatbot|bot)\b|otomatik (?:destek|sistem)|(?:ben|bu).{0,15}yapay zek[aâ]|(?:الدعم|دعم|نظام).{0,15}(?:الآلي|آلي)|автоматическ\p{L}* (?:поддержк|систем)/iu;
const prohibitedIntroduction = /polat['\s]*s.{0,12}(?:ai|artificial intelligence)[-\s]*(?:powered[-\s]*)?assistant|(?:ai|artificial intelligence).{0,15}assistant.{0,15}(?:for|of) polat|polat.{0,12}(?:ai|yapay zek[aâ]).{0,15}asistan|(?:مساعد|مساعدة).{0,20}بولات.{0,25}(?:ذكاء|آلي)|(?:مساعد|مساعدة).{0,20}(?:ذكاء|آلي).{0,25}بولات|(?:ии|искусственн).{0,20}(?:помощник|ассистент).{0,20}полат|(?:помощник|ассистент).{0,20}полат.{0,20}(?:ии|искусственн)/iu;
const falseHumanClaim = /\b(?:i'm|i am) (?:a |an |a real )?(?:human|real person)\b|\b(?:i'm|i am) not (?:an? )?(?:ai|bot|automated)\b|\b(?:ben )?(?:gerçek bir insanım|insanım|bot değilim|yapay zek[aâ] değilim)\b|أنا (?:إنسان|بشر)|я (?:настоящий человек|человек|не бот)/iu;

export function isPolatSupportIdentityQuestion(text: string): boolean {
  return /(?:are you|is this) (?:really |actually |the real )?(?:polat|a human|an? ai|a bot|automated)|who are you|who am i (?:speaking|talking) to|sen (?:polat|kimsin|insan|yapay)|(?:polat|bot|insan|yapay zek[aâ]|otomatik).{0,12}m[ıiuü]s[ıiuü]n|kimle (?:konuş|görüş)|من أنت|هل أنت.{0,20}(?:بولات|إنسان|روبوت|ذكاء|آلي)|кто (?:ты|вы)|(?:ты|вы).{0,12}(?:полат|бот|человек)/iu.test(normalize(text));
}

export function polatSupportIdentityInstructions(identityAsked: boolean): string {
  return `Identity policy ${POLAT_SUPPORT_IDENTITY_POLICY}. Represent the brand as Polat VIP support. Do not use the introduction "I'm Polat's AI assistant" or its translations, even when identity is asked. Do not volunteer an AI, bot or automated-system introduction in ordinary conversation. ${identityAsked ? "The customer directly asked about identity: truthfully explain that this is automated support, not Polat personally, using the scoped identity facts." : "Answer the customer's request without a personal introduction."} Never claim to be Polat personally or a human. If identity or automation is directly asked, answer truthfully; never deny automation or evade that question.`;
}

export function assessPolatSupportIdentity(text: string, identityAsked: boolean): string[] {
  const value = normalize(text), reasons: string[] = [];
  if (prohibitedIntroduction.test(value)) reasons.push("POLAT_AI_INTRODUCTION_FORBIDDEN");
  if (falseHumanClaim.test(value)) reasons.push("POLAT_FALSE_HUMAN_IDENTITY");
  if (/(?:^|[.!?]\s)(?:i'm|i am|this is) polat(?=$|[.!?,\s])(?! vip(?:'s)? (?:automated )?(?:customer )?support)|(?:^|[.!?]\s)ben polat(?:'?[ıi]m)?(?=$|[.!?,\s])(?! vip destek)|أنا بولات|(?:^|[.!?]\s)я полат(?=$|[.!?,\s])(?! vip)/iu.test(value)) reasons.push("POLAT_IMPERSONATION_OR_FAMILIARITY");
  if (identityAsked && !automation.test(value)) reasons.push("POLAT_IDENTITY_TRUTH_REQUIRED");
  if (!identityAsked && automation.test(value)) reasons.push("POLAT_UNSOLICITED_IDENTITY");
  return reasons;
}
