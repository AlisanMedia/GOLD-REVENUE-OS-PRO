/** Frozen serialized version aliases. Read compatibility does not grant dispatch authority. */
export const IDENTITY_WIRE_V1 = {
  "jeff-claude-canary-v1": "polat-claude-canary-v1",
  "jeff-claude-messages-v1": "polat-claude-messages-v1",
  "jeff-ai-fixture-v2": "polat-ai-fixture-v2",
  "jeff-campaign-v1": "polat-campaign-v1",
  "jeff-private-beta-v1": "polat-private-beta-v1",
  "jeff-fixture-v1": "polat-fixture-v1",
  "jeff-human-rubric-v1": "polat-human-rubric-v1",
  "jeff-multiturn-v2": "polat-multiturn-v2",
  "jeff-private-beta-notice-openai-v1": "polat-private-beta-notice-openai-v1",
  "jeff-private-beta-notice-v1": "polat-private-beta-notice-v1",
  "jeff-test-runtime-v1": "polat-test-runtime-v1"
} as const;
export function currentIdentityTag(value: string): string {
  return Object.entries(IDENTITY_WIRE_V1).find(([, legacy]) => legacy === value)?.[0] ?? value;
}
