# Polat AI Sales Operations — Package D

## Authorized boundary and operator workflow

Fourth repository-only synthetic package, based on accepted main `c3047196f24ce21a8f2404038943222d0c580179`. Packages A/B/C: PR121/122/123. The overall Phase16C-1 remains OPEN; commercial pilot remains NO-GO. No hosted schema, runtime activation, deployment, genuine provider/model call, Telegram/customer message, financial receipt, subscription/VIP change or import.

The existing Admin now links to `/admin/polat-operations` from AI Operations and conversations. The responsive, account-localized TR/EN page has two read-only areas:

1. **Responses & ownership**: persisted-source tracking gaps, eligible captured messages, AI queue, unacknowledged human handoffs, acknowledged human ownership, uncertain effects, overdue work, fake-ACK response timing and the bounded historical queue. Existing conversation/case links are shown only with actual role capabilities. There is no send/retry/force-success or production configuration control. Unassigned human work is not hidden as completed ownership.
2. **CRM & source evidence**: authorized roles reuse accepted Phase15 analytics for qualification/approved-offer/evidenced subscription stages, support/renewal/cancellation, invocation usage and billing coverage. Financial mode and unclassified operational provenance remain distinct. Offer creation is not presentation; missing opt-out provenance and genuine customer satisfaction remain explicitly unavailable. LIVE purchase conversion is withheld without complete financial-source evidence. Monetary currency-group details remain in existing Analytics; no currency-free amount is invented or merged.

The page explicitly states that only configured synthetic conversations are covered; it cannot measure Telegram updates never received by the system. The summary uses its selected [start,end) UTC period; the keyset queue covers all time and has its own state filter. Missing/incomplete/error states differ from empty results. Customer communication language is independent of the Admin preference.

## Read and evidence model

One additive migration, `20261024094000_polat_operations_read_summary.sql`, adds a read-only SECURITY DEFINER RPC with qualified objects, controlled search path and active tenant-member role checks. Authenticated support/analyst/manager/super-admin can read safe aggregates; readonly/anonymous and cross-tenant requests fail closed. No raw private read or writer grants are added. The existing read cursor remains 25 default/100 max, generation-fenced and user/role/filter-bound.

Work, source messages and control scopes each have 1,000-row budgets plus bounded lookahead. Larger populations disclose incompleteness; full-period rates/latencies become null. Ownership context is loaded once per distinct conversation. One measured period index supports deterministic bounded chronological selection. Original message bodies, source/body/receipt hashes, owner identities, invite references, credentials and lease tokens are excluded from the new response DTOs. Existing private immutable history and Phase14 anonymity remain unchanged.

## Offline evaluation and corrected findings

The paired DIRECT/ONE_QUESTION evaluation retains the same 15 invented EN/TR scenarios and catalog facts per variant. It checks question relevance, next step, full existing QA, truthfulness, human boundaries, opt-out, pressure and length; no live experiment or model call occurs. Real conversion, CSAT, billing cost and ROI remain null/unmeasured.

Stronger full-QA coverage initially found **26/30** passing paired cases: four outputs exceeded the accepted sentence budget. No security/grounding bypass or false delivery occurred: the response pipeline held those drafts. The renderer now omits unrequested first-turn detail and unnecessary follow-up questions while retaining AI disclosure, exact requested price/inclusions and existing QA thresholds. Final **30/30** paired guards pass. Mean generated character counts are **96.27 DIRECT / 101.07 ONE_QUESTION**; these are corpus descriptors, not human-rated naturalness or conversion uplift. Manager review is required before any style policy activation.

## Actual local acceptance before publication

- 42 PostgreSQL assertions: source coverage, deliberately missing-capture detection in a rollback-only negative fixture, role/tenant denial, exact denominators, fake-ACK evidence, historical retention, boundedness, incompleteness and equivalence with the existing row projection.
- 1,005-message synthetic workload: initial summary **1646.131 ms**, intermediate join-only result **1676.916 ms** (no improvement), final per-conversation context read **66.798 ms**, response **692 bytes**, sample **1,000**, complete=false. Full final inline EXPLAIN execution **66.395 ms**; bounded work selection uses `polat_work_period`. These are individual disposable PG17 measurements with retained plans, not p95/production capacity claims.
- Full unit/integration: **1782 PASS, 0 FAIL, 17 explicit DB-context skips**. Separate actual PG bridges and independent connection/crash evidence are preserved in B/C and rerun by mandatory Database CI.
- Actual UI/server/route integration: **26 PASS**. Source/schema failures cannot serialize raw evidence. Role guards precede loading; financial analytics is not invoked for support.
- Offline evaluation domain checks: **8 PASS**, plus the existing sales/response regressions. Final actual-component visual/keyboard acceptance: **16/16** across responses/business, TR/EN and 320/390/768/1440px, with external HTTP/HTTPS blocked. Synthetic screenshots contain no real customer data.
- Workspace lint, strict TypeScript and diff checks passed. Local default Next build remains subject to the previously retained sandbox Turbopack EPERM limit; mandatory exact-head and post-merge CI builds provide actual build evidence.

Original failed attempts remain outside Git: initial JSX/typed-key/unused-import findings; a missing test alias; an overly broad redaction test that matched the safe human_ownership_rate key; a SQL string-boundary typo; a pgTAP bigint/numeric comparison; the stronger 26/30 QA result; and the unimproved intermediate read measurement. These were corrected without removing failures or weakening an assertion/security control. Initial screenshot scroll state was preserved before regenerating clean top-of-page captures; the application was not altered to hide an issue.

## Required protected publication

CI adds only disposable local authenticated HTTP/RPC acceptance plus the new pgTAP registration/artifacts. The HTTP harness creates isolated local Auth users and invented inbound records, tests locale persistence, RBAC, tenant/cursor fencing and unchanged financial/access/outbound/import counts, then disables its fixtures. Exact-head Application and Database, normal protected merge and both post-merge checks remain mandatory. Actual run/job IDs and HTTP results are recorded in the consolidated owner report after they occur; this prepublication record does not claim those future results.

The first pushed commit must contain only `codex/polat-crm-operations=false` as its new Vercel branch rule; main, existing entries and cron remain intact. Historical unauthorized Preview creation remains HISTORICAL FAIL — RESOLVED WITH DOCUMENTED DEVIATION, never rewritten as zero historic deployments.

## Remaining live gates

A real model/provider profile, genuine authenticated inbound/delivery observation, reviewed opt-out/consent event capture, real operator and EN/TR usability acceptance, complete billing evidence and C01–C10 commercial/infrastructure authorization remain separate work. No real Polat session, supplier permission, merchant eligibility, wallet, payment rail or deployment has been established by this batch. Historical imports remain locked. No next package is automatically started after this four-package owner batch.
