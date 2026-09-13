import pino, { type LoggerOptions } from "pino";

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.password",
  "*.token",
  "*.secret",
  "*.serviceRoleKey",
] as const;

export function createLogger(options: LoggerOptions = {}) {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
    ...options,
  });
}

export function requestId(headerValue?: string | null): string {
  if (headerValue && /^[a-zA-Z0-9_-]{8,100}$/.test(headerValue)) return headerValue;
  return crypto.randomUUID();
}
