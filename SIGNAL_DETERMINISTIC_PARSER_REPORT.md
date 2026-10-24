# Deterministic signal parsing — Package B

Owner-authorized repository-only package2/4, based on accepted main `91523c43cfbee5f5b2a91294cbf0ba01ec84529b` / [PR117](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/pull/117). Both exact-head and post-merge Application/Database passed before this branch. No real provider content or account is used.

## Delivered

Strict tenant/source/provider-scoped, versioned profiles select the explicit `LABELLED_EN_V1` grammar, allowed instruments, optional exact provider prefix and attachment-metadata capability. This is a deterministic allowlist, not arbitrary administrator regex execution, LLM inference or proof of supplier permission.

The parser returns `VALID_SIGNAL`, `SIGNAL_UPDATE`, `NON_SIGNAL`, `AMBIGUOUS`, `UNSUPPORTED` or `SOURCE_RESTRICTED`, with bounded reasons and separately hashed original source, profile and interpretation. Original text, whitespace, source revision, publication-time unknowns and metadata remain unchanged. Prices remain exact decimal strings; BigInt is used only for comparison. No rounding, direction substitution, inferred entry/SL/TP or trading execution.

Supported synthetic examples include XAUUSD BUY/SELL, MARKET/LIMIT/STOP, explicit entry/range, SL, ordered TP1–TP12, break-even, partial close, close, cancel, explicit SL/TP updates and reply-linked commentary. Unknown formats, contradictory directions/instruments, malformed prices, missing parents, stale edits and unsupported media remain reviewable. Source DELETE is **not** interpreted as a trade cancellation. Images have metadata only; no image/OCR interpretation or content-protection bypass.

`prepareParsedSignalFixture` explicitly produces an optional **derived** normalization candidate before first durable fixture capture. It does not write, enqueue or replace stored evidence. The original assessment/source hash remains separate from the derived candidate hash. An already-recorded source revision cannot be silently reinterpreted or rewritten; existing immutable identity/replay/conflict gates remain authoritative. Grammar revision changes alter annotation identity, never invent a source edit.

Example invented fixture (not advice or supplier content):

```text
XAUUSD BUY LIMIT
ENTRY 2700.010-2701.000
SL 2690.000
TP1 2720.10
TP2 2730.001
```

## Actual local acceptance

- 50 new deterministic tests, including26-case fixture corpus, all PASS;82 PASS with the existing source-normalization tests.
- Full unit/integration run: **1475 PASS,0 FAIL,14 DB-context SKIP**. These skips are not PostgreSQL/provider acceptance; mandatory Database CI runs the existing database bridge/security suites separately.
- Lint, strict TypeScript and production build PASS. No new dependency, SQL migration, adapter, receipt/event writer, consumer, metric definition, UI, worker or cron change.
- All results retain `financial_authority=NONE` and `live_operations_authorized=false`. Strict schemas reject injected authority/session/configuration fields. There were no failed local test runs in this package.

Files: [contracts](packages/contracts/src/signal-parser.ts), [parser/normalization bridge](packages/domain/src/signal-parser.ts), [synthetic corpus](packages/domain/src/signal-parser.fixtures.ts), [tests](packages/domain/src/signal-parser.test.ts). The only Vercel change is `codex/signal-deterministic-parser=false`, preserving main=false, every existing entry and cron. Exact PR/head/merge/CI evidence is recorded in the final consolidated owner artifact after publication.

Real supplier format validation, source rights, permitted Telegram integration, hosted release and genuine end-to-end delivery remain separately gated. The accepted delayed-ACK benchmark failure is not changed or relabelled by this parser. Commercial pilot remains NO-GO; overall16C-1 remains OPEN.
