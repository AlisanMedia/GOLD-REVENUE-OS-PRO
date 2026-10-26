/** Restriction only: a private-beta deployment cannot dispatch unrelated legacy traffic.
 * This marker grants no model, Telegram, financial or access permission. */
export function privateBetaIsolationActive() { return Boolean(process.env.POLAT_UAT_RELEASE_SHA); }
