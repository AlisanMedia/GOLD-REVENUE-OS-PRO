# Phase 2 Real-Data Dry-Run Report

Status: **DRY-RUN COMPLETE — REAL IMPORT NOT EXECUTED**

Dataset fingerprint: `sha256:9012096cb3a2a27536fb7d4d0e216b03083bc041b9cb3561dd459908adea3c8c`  
Dataset size: 192,729 bytes  
Execution boundary: encrypted temporary workspace only; no raw row, CSV/XLSX file, customer record or import batch was written to GitHub, Supabase or Vercel.

## Result

| Metric | Count | Interpretation |
|---|---:|---|
| Source sheets | 6 | Five monthly payment sheets and one headerless two-column sheet |
| Total source rows | 1,785 | Non-empty data rows after structural header removal |
| Valid rows | 1,739 | At least one usable identity and no validation error |
| Rejected rows | 46 | No database mutation is planned |
| Exact matches | 587 | Safe exact matches to an earlier row in this upload |
| Probable matches | 39 | Manual review required |
| Ambiguous matches | 31 | Multiple exact/name candidate paths; manual review required |
| New customers | 1,082 | Automatically planned customer inserts before manual decisions |
| Duplicates within upload | 606 | Redundant rows under the complete exact-identity graph |
| Rows with no usable identity | 24 | Rejected |
| Identity conflicts | 31 | Same as ambiguous bridge rows |
| Records requiring any manual review | 225 | Union of rejected, probable, ambiguous and mixed-field review rows |

The conservative no-silent-merge estimate is **1,152 unique customers** (1,082 new plus 70 probable/ambiguous records held separately until review). The complete exact-identity graph has **1,133 connected customer components**. The final unique count therefore remains review-dependent in the **1,133–1,152** range.

There were no pre-existing Customer OS records in the dry-run baseline and staging was deliberately not queried or mutated. “Exact match” in this report means an exact match inside the uploaded dataset, not a match to a persisted customer.

## Source-sheet breakdown

| Source sheet | Source | Valid | Rejected | Exact | Probable | Ambiguous | New | No identity |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| GELEN ÖDEMELER ŞUBAT | 238 | 234 | 4 | 1 | 6 | 0 | 227 | 4 |
| GELEN ÖDEMELER MART | 403 | 399 | 4 | 62 | 8 | 5 | 324 | 1 |
| GELEN ÖDEMELER NİSAN | 295 | 287 | 8 | 69 | 7 | 9 | 202 | 1 |
| GELEN ÖDEMELER MAYIS | 300 | 291 | 9 | 110 | 11 | 6 | 164 | 1 |
| GELEN ÖDEMELER HAZİRAN | 283 | 264 | 19 | 91 | 7 | 10 | 156 | 17 |
| Sayfa1 | 266 | 264 | 2 | 254 | 0 | 1 | 9 | 0 |

`Sayfa1` substantially overlaps the June sheet, explaining most of its exact matches.

## Schema detection

- The monthly sheets expose payment serial, date, display-name-like text, a mixed free-text/Telegram field, amount, email and payment metadata columns.
- `Sayfa1` has no header row. Its two columns were structurally inferred as mixed Telegram identity and email.
- The June first row is a partially overwritten header and was excluded as structure, not customer data.
- Email is the only consistently populated supported identity.
- Telegram usernames and numeric Telegram user IDs coexist in one legacy column. Only syntactically recognizable values were normalized.
- No trustworthy phone or external/customer ID column exists. Payment serial numbers were not promoted to customer IDs, and free text was not guessed as a phone number.
- Payment amounts, dates, account/payment metadata and screenshots are outside the Phase 2 Customer OS identity/profile contract and were not imported.

## Identity normalization

| Identity | Normalized occurrences | Distinct values planned after all reviews |
|---|---:|---:|
| Email | 1,739 | 1,176 |
| Telegram username | 806 | 507 |
| Telegram user ID | 845 | 560 |
| External ID | 0 | 0 |
| Phone | 0 | 0 |
| **Total distinct identities** | — | **2,243** |

Frequency safeguards found no identity attached to more than six source rows. There are 401 repeated emails, 198 repeated Telegram usernames and 197 repeated Telegram IDs. The largest exact-identity customer component contains six source rows.

## Normalization and validation issues

| Issue | Count | Handling |
|---|---:|---|
| Invalid email | 25 errors | Row rejected even if another identity is present |
| Missing usable identity | 24 errors | Row rejected |
| Total validation errors | 49 errors across 46 rows | No planned mutation |
| Unrecognized values in mixed Telegram/free-text field | 113 rows | Not guessed; manual source review |

Three rejected rows contain more than one validation error, which is why error count exceeds rejected-row count.

## Planned mutations

No mutation was executed. If an import were approved after reconciliation:

- **1,082 customer inserts** are automatically planned.
- **587 rows** link to another row in the same batch through an opaque batch customer reference.
- **70 rows** remain blocked on probable/ambiguous review; they may raise the customer-insert total to at most 1,152.
- **2,167 distinct identity inserts** are automatically planned: 1,138 emails, 489 Telegram usernames and 540 Telegram user IDs.
- Up to **2,243 identity inserts** may be planned after all manual decisions.
- The source contains **zero meaningful structured profile/memory values**.
- The current commit path would perform **1,669 automatic profile upserts**, although those rows carry no meaningful profile fields.
- Initial `NEW` state-history writes equal created customers: **1,082 automatically**, up to **1,152** after review.

## Manual review records

No PII is reproduced here. References are source sheet and physical row number.

The **225** figure is a union, not a sum of four independent buckets. There are
**229 review flags** across **225 unique source records**:

| Review reason | Flag count | Overlap inside this category |
|---|---:|---:|
| Rejected/validation failed | 46 | 3 are also mixed Telegram/free-text rows |
| Probable match | 39 | 1 is also a mixed Telegram/free-text row |
| Ambiguous identity graph | 31 | 0 mixed-field overlaps |
| Unrecognized mixed Telegram/free-text | 113 | 4 already counted above |
| **Unique records requiring review** | **225** | **4 duplicated flags removed** |

Rejected, probable and ambiguous buckets do not overlap with each other. The
only overlaps are the three rejected rows and one probable row that also carry
an unrecognized mixed-field value. This breakdown explains the complete
composition without publishing customer data.

### Rejected

- GELEN ÖDEMELER ŞUBAT: 129, 168, 182, 239
- GELEN ÖDEMELER MART: 28, 237, 263, 404
- GELEN ÖDEMELER NİSAN: 42, 101, 120, 161, 188–189, 194, 296
- GELEN ÖDEMELER MAYIS: 8, 24, 31, 49, 79, 167, 171, 175, 301
- GELEN ÖDEMELER HAZİRAN: 74–75, 268–284
- Sayfa1: 73–74

### Probable matches

- GELEN ÖDEMELER ŞUBAT: 58, 140, 159, 175, 177, 228
- GELEN ÖDEMELER MART: 95, 114, 127, 261, 332, 339, 366, 372
- GELEN ÖDEMELER NİSAN: 9, 137, 159, 172, 211, 213, 240
- GELEN ÖDEMELER MAYIS: 39, 53, 75, 82, 129, 176, 217, 220, 253, 256, 284
- GELEN ÖDEMELER HAZİRAN: 14, 123, 147, 174, 186, 222, 227

### Ambiguous matches

- GELEN ÖDEMELER MART: 21, 143, 170, 317, 383
- GELEN ÖDEMELER NİSAN: 85, 98, 201, 242, 245, 259, 264, 271–272
- GELEN ÖDEMELER MAYIS: 72, 85, 95, 194, 218, 278
- GELEN ÖDEMELER HAZİRAN: 114, 151, 155, 160, 179, 188, 193, 196, 223, 255
- Sayfa1: 154

### Mixed Telegram/free-text review

- GELEN ÖDEMELER ŞUBAT: 111 rows
- GELEN ÖDEMELER MART: 2 rows

These values were deliberately excluded from identity matching. They must not be reclassified without reviewing their original source context.

## Weaknesses exposed and Phase 2 fixes

The real workbook exposed the following weaknesses:

1. The original batch classifier compared rows only with persisted customers, so all rows in an empty Customer OS appeared new.
2. The original reconciliation SQL counted validation-failed rows under their classification instead of `rejected_count`.
3. The legacy workbook is multi-sheet, has localized and malformed/headerless structures, contains formula cells and mixes two Telegram identity types with free text in one column.
4. The current XLSX parser accepts a canonical single-sheet workbook only; it is intentionally not being made to guess this legacy workbook’s ambiguous structure.
5. Empty profile upserts are redundant for this dataset.

The smallest correctness fix adds deterministic batch-level customer references, detects exact/probable/ambiguous relationships inside the upload, makes duplicate rows reuse the first accepted batch customer, and corrects rejected-row reconciliation. Regression coverage verifies an exact two-row batch creates one customer and imports both rows. The legacy workbook still requires a secure local canonicalization step before any future approved import.

## Verification

Local application verification after the fix:

- Lint: PASS
- Typecheck: PASS
- Unit tests: PASS — 13 tests
- Integration tests: PASS — 5 tests
- Production build: PASS
- Domain regression tests: PASS — 10 tests

Cloud verification for commit `c6bdc255571810d299b3e8e95dee6058aad36b00`:

- GitHub Actions CI: PASS — [run 35100441748](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/35100441748)
- Application job: PASS — install, lint, typecheck, unit/integration tests, production build, high-severity dependency audit and bundle smoke test
- Database job: PASS — Supabase start, full migration rebuild, migration-history verification and database lint
- Foundation pgTAP: PASS
- Tenant-isolation tests: PASS
- Customer OS pgTAP: PASS
- Authentication smoke test: PASS
- Supabase staging: PASS — migration apply/history, database lint and authentication smoke test
- Vercel staging: PASS — prebuilt deployment and live/ready health checks at `https://gold-revenue-os-staging.vercel.app`
- Staging validation: PASS — [run 35101105812, attempt 2](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/35101105812)

The first Vercel attempt was blocked by the account billing state; after the Pro account was reactivated, attempt 2 completed successfully. No real-data row was required or permitted in CI, and no customer data was persisted during cloud validation.

## Import gate

**BLOCKED.** Do not execute the real import. Before an import can be considered:

1. review all 46 rejected rows;
2. decide all 39 probable and 31 ambiguous matches;
3. inspect the 113 mixed-field rows without guessing identities;
4. generate a canonical, PII-protected CSV locally;
5. run a second dry-run on that canonical file;
6. obtain explicit owner approval.

The historical expectation of approximately **1,161** unique customers is not
yet reconciled to the engine's **1,133–1,152** range. The historical estimate is
9 above the current conservative upper bound and 28 above the exact-identity
component count. The current engine deliberately excludes 46 rejected rows,
does not invent identities for 113 mixed-field rows, collapses the June/`Sayfa1`
overlap and leaves 70 probable/ambiguous decisions unresolved. Those different
counting rules can explain the direction of the variance, but they do not prove
which nine records account for the remaining upper-bound difference.

Before any future real import, a final manual-review resolution report must:

1. resolve each of the 225 unique review records by source reference;
2. document the canonical identity/component decision without exposing PII;
3. reconcile the final unique count against 1,161 and explain every exclusion;
4. attach the canonical-file hash and second dry-run totals; and
5. receive a new, explicit owner approval before the commit endpoint is used.

Phase 3 may proceed, but it must not weaken or bypass this import gate.
