export function privateBetaSequenceToc(toc: string, source: unknown): string;
export function comparePrivateBetaRecovery(before: unknown, after: unknown, restored: unknown, sequenceSql: string): Readonly<{ result: 'PASS' | 'FAIL'; code: string; source_rows_changed: boolean; source_sequence_values_changed: boolean }>;
