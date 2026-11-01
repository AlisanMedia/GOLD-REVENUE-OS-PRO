export function waitForPrivateBetaFounder(input: {
  env: Record<string, string | undefined>;
  request?: typeof fetch;
  delay?: (milliseconds: number) => Promise<unknown>;
}): Promise<Readonly<{ version: number; ready: boolean; state: string; model_requests: number; telegram_messages: number; financial_authority: string }>>;
