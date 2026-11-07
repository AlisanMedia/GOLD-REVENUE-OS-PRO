/** Public presentation is a constraint, never an authentication credential. */
export const JEFF_PUBLIC_NAME = "Jeff";
export const JEFF_TELEGRAM_USERNAME = "jeffryfx";
export const JEFF_TELEGRAM_HANDLE = "@jeffryfx";
export function matchesJeffBusinessIdentity(user: { id?: number | undefined; is_bot?: boolean | undefined; username?: string | undefined }, sealedNumericId: string): boolean {
  return /^[1-9][0-9]{0,15}$/u.test(sealedNumericId) && Number.isSafeInteger(user.id) && Number(user.id) > 0
    && String(user.id) === sealedNumericId && user.is_bot === false
    && user.username?.toLowerCase() === JEFF_TELEGRAM_USERNAME;
}
