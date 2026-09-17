# Phase 2 Import Readiness

This document is the safe runbook for the approximately 1,161-customer historical dataset. The dataset is not in this repository and has not been imported.

## Secure transfer

1. Keep the CSV/XLSX file on an encrypted local drive.
2. Do not attach it to GitHub, a pull request, issue, commit, CI artifact, chat message or public URL.
3. Use the authenticated staging admin import screen at `/admin/imports/new` after staging validation is complete. The browser sends the file over HTTPS to the tenant-scoped import endpoint; the endpoint parses it in memory and does not write the file to repository storage.
4. If the transfer is too large for the browser limit, split it into bounded files and preserve the original offline.

## Dry-run

1. Sign in as a tenant manager or super_admin.
2. Upload the file and record the returned batch ID and SHA-256 fingerprint.
3. The system validates headers, identity formats, row limits and formula cells.
4. It normalizes identities, compares them only to the same tenant, and creates a dry-run batch with row-level classifications.
5. Open the reconciliation report. It must show exact-match, probable-match, ambiguous, new-customer, rejected, validation-error and planned-mutation counts.
6. Inspect every probable and ambiguous row. Use the review endpoint to approve only an exact existing customer or a new customer. Uncertain rows stay unresolved.

### Legacy multi-sheet workbooks

The historical workbook validated in September 2026 is not a canonical import file: it contains multiple sheets, localized headers, a headerless sheet, formula cells and one mixed Telegram username/user-ID/free-text column. Keep the original workbook in encrypted temporary storage and produce a tenant-approved canonical CSV locally before using the admin import screen. The canonical file must have one header row, one source row number, and only explicit supported identity columns. Do not infer phone or external ID values from payment serials or free-text cells. Preserve the original sheet name and row number in the source reference, compare the canonical file hash with the dry-run report, and delete the temporary derivative after reconciliation.

The import engine now links exact duplicates inside the same batch by an opaque batch reference. Probable and ambiguous matches remain review-gated. A dry-run with validation errors must report those rows as rejected; no rejected row may contribute to planned mutation counts.

## Approval gate

Do not call the commit endpoint until the owner has reviewed the report and explicitly approved it outside the import file. The commit endpoint requires the exact confirmation phrase `IMPORT_APPROVED`, a super_admin session, and all probable/ambiguous rows resolved. This phrase is not a substitute for review; it is the final technical guard.

The September 2026 real-data review gate remains open. Its 225 unique records
comprise 46 rejected rows, 39 probable matches, 31 ambiguous matches and 113
mixed Telegram/free-text rows. These are 229 category flags but 225 records
because three rejected rows and one probable row are also in the mixed-field
category. Rejected/probable/ambiguous categories otherwise do not overlap.

The engine currently estimates 1,133 exact identity components and a
no-silent-merge upper bound of 1,152 customers, versus the historical estimate
of approximately 1,161. This difference remains unresolved; the historical
number must not be treated as a database target or used to force merges.

Before a future commit is even eligible for approval, produce
`PHASE_2_FINAL_IMPORT_REVIEW_REPORT.md` from a canonical PII-protected file. It
must resolve every one of the 225 records, reconcile the final unique count,
include the canonical file hash and second dry-run results, and record a new
explicit owner approval. Phase 3 work does not unlock the import.

## Commit and reconciliation

After approval, execute one batch commit. The operation is atomic and records source/provenance references, identities, profiles, memory confidence and state history. Verify imported/created/linked counts against the report and preserve the batch ID. Investigate any identity conflict or rejected row before proceeding.

## Data handling and rollback

Never export raw payloads to logs or CI artifacts. Keep the original dataset offline and access-controlled. If the dry-run is wrong, cancel the batch and upload a corrected file; do not mutate customers. If an approved commit is wrong, stop downstream automation and perform a reviewed data remediation—do not delete tenant data blindly.
