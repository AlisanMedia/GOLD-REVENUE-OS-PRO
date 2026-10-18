# Phase 15 — Revenue Intelligence (authorized, OPEN)

Owner scope: analytics implementation, required CI/merge and one isolated synthetic staging acceptance. Baseline `54ada98b65854e86ac5e1fb0c825b13bac86c4fb`, formal Phase 14 closeout #99; both mandatory baseline CI jobs verified. Phases 1–14 remain CLOSED. Phase 16+, live payments, production VIP, actual outreach/imports and commercial activation remain unauthorized.

## Financial truth checkpoint

Read-only staging inspection on 2026-10-17 independently confirmed: 16 TEST invoices; 2 TEST subscriptions; zero LIVE invoices/subscriptions/access; zero verified receipt records; 562 model invocations; zero invocations with both recorded billing fields. This is a dated observation, not a permanent count.

Existing verified receipts establish event/signature/independent verification but **contain no actual received amount/currency**. Offer and plan prices cannot fill that gap. No financial writer, provider window or ledger is added. LIVE collected revenue/MRR/ARR stay UNAVAILABLE until separately approved authoritative amount provenance exists. TEST confirmed observations can demonstrate numeric calculations only as SANDBOX. Refund status is not a refund cash receipt. No currency/network mixing or FX conversion.

The executable [typed dictionary](../../packages/domain/src/analytics.ts) defines each metric's meaning/formula, sources, verification, numerator/denominator, UTC basis, currency, classification, null behavior, RBAC, duplicate policy and caveats. SQL owns exact numeric arithmetic; decimal strings reach the UI intact. No JS floating-point financial aggregation.

## Read architecture and boundaries

PostgreSQL-first stable request snapshot; strict date interval `[start,end)` UTC, 7/30/90 presets and custom maximum 366 days, bounded history. Equal-length preceding interval comparison applies only to period measures; current backlog is separately labeled. Tenant active membership: super_admin/manager/analyst read; manager/super_admin economic-evidence review. Support/readonly denied. No browser tenant authority, secret, raw message, customer identity or provider reference is projected.

LIVE financial sources require explicit live-mode independent receipts and trusted payment verifier events. Operational records without environment provenance are UNCLASSIFIED; read workload remains useful but is never silently labeled production or used as a live funnel. Known isolated sandbox tenant cohorts provide synthetic funnel proof. No new live classification/activation API.

Cohort uses first observed inbound contact, exact/manual reviewed customer mapping, conservative unmatched contact keys. Multiple contacts for one verified customer deduplicate; repeated offers do not add people. Historical stages use persisted timestamps, event/offer/period authority and time order. Stage counts may skip steps; conditional conversion uses overlap with the preceding stage, not an assumed linear funnel. Missing denominator is null. Historical eligibility and mutable access/cancellation states are not reconstructed from current state.

Subscription periods remain immutable; receipt/invoice/event joins avoid fan-out. Renewal means an additional evidenced period; observed due continuation rate discloses maturation and late-verification limits. Opening customer coverage lapse deduplicates customers across plans and is provisional, not causal churn. Recurring calendar month/year normalize exactly; fixed-day MRR stays unavailable without an approved policy. Actual subscriptions and observed VIP membership remain separate.

Model_invocations is the sole usage/cost source; agent_runs costs are never added. Known token/latency sample coverage is explicit. Complete billed fields with a unique provider request ID are recorded telemetry, not independent provider billing verification. Duplicates and partial runs block per-operation economics. Extensible economic evidence stores owner-reviewable assumptions or documented costs with provenance/hash, periods, exact amounts and audit/revision controls. Review is not financial authority or completeness certification; margins/CAC/LTV/ROI remain unavailable.

Survey summaries reuse Phase 14 fixed closed-month aggregation and k>=5/full-cell suppression; no anonymous response IDs, text, timestamps or contact joins. Named drilldowns are not added. All drilldowns contain bounded source IDs/status/time only and revalidate tenant, filters and source fingerprint; changed snapshots return conflict.

## UX and acceptance

Seven integrated TR-default/EN-per-account areas: overview, funnel, revenue/subscriptions, customers/churn, AI/operations, costs, data quality. Shared premium dark/gold design, obvious next actions, explicit SANDBOX/LIVE financial scope and unknown operational provenance, source formula details, accessible lightweight charts with numerical alternatives. No fake numbers, promotional claims or model calls. Customer language remains independent English default.

Acceptance: deterministic numeric/asset/precision and calendar fixtures; no unverified revenue; duplicate receipts/periods/provider-cost controls; no denominator/unknown-cost inventions; cancellation vs expiry; cohort duplicate offers and multiple plans; tenant/RBAC; source drift and concurrent review; privacy; authenticated HTTP/TR/EN; 320/390/768/1440px actual-component/keyboard screenshots; lint/typecheck/build/audit; all existing regressions, pgTAP and concurrency. Exact PR head and merged main Application+Database must PASS. First push includes exact-branch Git Preview suppression, retaining main=false/other policies/cron. One isolated staging run, fake/no provider, then fixture disable/cleanup and unchanged financial/VIP/outbound/import/manager-alert/control read-back.

## Remaining owner decisions

No Phase 15 closure without explicit owner acceptance. Live source amount/refund/tax/accounting, fixed-day MRR, recognized revenue vs cash, FX, attribution and economic coverage definitions require separate review. Signal/supplier/commission arrangements are not assumed. Phase 16/pilot, commercial activation, real payments/access/outbound/import and paid services remain separate gates.
