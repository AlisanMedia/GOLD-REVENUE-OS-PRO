export const PRIVATE_BETA_VERCEL: Readonly<{ team: string; project: string; name: string; aliases: ReadonlyArray<string> }>;
export function validatePrivateBetaVercelProject(project: unknown, team: unknown): Readonly<{ id: string; name: string; account_id: string; team_slug: string; sso: unknown; git: unknown; prior_deployment: string | null }>;
export function privateBetaBuildEnvironment(env: Record<string, string | undefined>): string;
export function validatePrivateBetaDeployment(deployment: unknown, sha: string): Readonly<{ id: string; url: string; sha: string; state: string; technical_target: string; commercial_production: boolean }>;
