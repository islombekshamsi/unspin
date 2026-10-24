# Data handling: identity, storage, deletion, retention, sharing, exports

## Identity and ownership

- **Guests** receive a 256-bit random capability token in the `unspin_guest` cookie (HttpOnly,
  SameSite=Lax, Secure in production, 30-day max age). The owner id is
  `guest_` + the first 48 hex characters of sha256(token); the token itself is never stored or logged.
  Losing the cookie loses access to that guest workspace — there is no recovery path.
- **Accounts** (when Auth0 is integrated) map to `acct_` + sha256(issuer + "\n" + subject). Today
  `accountOwner()` returns null; no login is simulated.
- **Claiming**: at login, `claimGuestWorkspace(guest, account)` moves every guest-owned row
  (sources, selections, datasets, versions, provenance, history, jobs, shares) to the account in one
  transaction, records the claim in `workspace_claims`, is idempotent for the same account, and refuses
  a second account. History entries keep their original actor label ("Guest session").
- Owner ids are never taken from requests. A resource owned by someone else is reported exactly like
  a missing one (404), so ids cannot be probed.

## Source files

- Stored under server-generated keys `sources/<ownerId>/<sourceId>`; the uploaded filename is display
  metadata only and never part of a path or object key.
- Filesystem mode: files are mode 0600 in 0700 directories under `UNSPIN_STORAGE_ROOT`, written
  atomically, and every key is validated against a strict pattern and checked to resolve inside the root.
- S3 mode: private bucket, path-style SigV4 requests, no ACL headers; provider error bodies are never
  returned to users.

## Deletion (`DELETE /api/v1/sources/:id`)

Removes, for the owning caller only:

| Removed | How |
| --- | --- |
| Source row | `sources` |
| Source file (blob) | `BlobStore.delete(blobKey)` after the rows |
| Selections of the source | FK cascade |
| Datasets from those selections, every version and row chunk, provenance, history | `deleteBySource` + FK cascade |
| Jobs for those selections (any status) | FK cascade |
| Share links for those datasets | FK cascade (links stop resolving immediately) |

Memory mode performs the same cascade. A job already running when its source is deleted fails
(`not_found`) instead of recreating a dataset.

Not removed: exports the user already downloaded, and copies inside database/blob backups until those
backups rotate out (14 days for the provided script, plus the managed provider's backup window).
Server logs contain only request ids, routes, timings, and error codes — no source contents.

## Retention

- No automatic expiry of guest workspaces is implemented yet. Recommended policy before public launch:
  delete guest workspaces untouched for 30 days (matching the cookie lifetime), since an expired cookie
  makes them unreachable anyway. This needs a scheduled job and a `last_seen_at` column (future migration).
- Jobs are kept with their bounded error metadata for history; they are deleted with their source.

## Sharing

- Read-only links to one dataset version, expiring after 1 hour to 30 days (default 7 days),
  revocable at any time. The token (256-bit, base64url) is returned once; only sha256(token) is stored.
- Every access re-checks revocation and expiry and that the dataset/version still exist.
- Shares never include the source file unless `includeSource` was chosen at creation; even then only
  the file and its metadata are exposed, never other datasets or the owner's identity.

## Exports

- **CSV**: the selected committed version; `full` scope = all rows in source order and all columns,
  `view` scope = exactly the listed rows/columns in the given order. UTF-8 **with BOM**, RFC 4180
  quoting, CRLF line endings (including after the last record). Header = column label plus
  `(CURRENCY unit)` suffix (or `(%)`/`(fraction)` for percent columns without a unit); duplicate headers
  become `Label [2]`, `Label [3]`… deterministically. Missing values are empty fields. Decimal values
  are written exactly as stored. Header and non-decimal text starting with `= + - @ TAB CR` is prefixed
  with `'` to prevent spreadsheet formula execution; valid decimals (e.g. `-12.5`) are never altered.
- **data.json**: exact values with type, missing reason, raw text, origin, review status, and
  provenance ids — no spreadsheet escaping.
- **manifest.json**: validated against `ExportManifestSchema`; contains source hash/kind/filename/
  disclosure (no storage keys or contents), the full selection and crop transform, extraction info,
  initial/exported/current version ids, the history entries that produced the exported version,
  provenance referenced by exported cells only, a scoped review summary, coverage and its
  acknowledgement, and a statement that review markers are user review, not scientific validation.
  Export stops with an error rather than emitting a manifest with missing lineage or provenance.
