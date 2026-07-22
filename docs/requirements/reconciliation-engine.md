# Reconciliation, Differences, and Settlement Engine

## Scope

This vertical slice governs financial and operational reconciliations for the single Aden branch. It does not add branch, tenant, or company identifiers.

## Invariants

- SR and RG remain separate in every record, query, total, approval, and ledger entry.
- Amounts are integer minor units; floating-point financial arithmetic is prohibited.
- A reconciliation compares one customer account and currency against one documented source.
- The server derives the difference as `observed_amount_minor - expected_amount_minor`.
- Submitted financial identity and source fields are immutable.
- Review, approval, rejection, return, and settlement are explicit state transitions.
- In `MULTI_USER`, the creator cannot review or approve their own reconciliation. In `SINGLE_MANAGER`, an active branch manager may perform governed self-review and self-approval, and the operating mode is recorded in history.
- Settlement is allowed only for an approved, non-zero difference.
- Settlement creates exactly one `RECONCILIATION_ADJUSTMENT` ledger entry with the same account, customer, currency, absolute amount, source identity, and a direction derived from the difference.
- A settled reconciliation cannot be settled again. Duplicate or concurrent settlement requests replay the committed result only when the canonical request is identical.
- Financial records, events, and settlements are append-only. Corrections use ledger reversal and a new reconciliation rather than deleting history.
- Technical `SYSTEM_ADMIN` receives no reconciliation data permission by default.
- No migration from this slice may be applied to Neon production during implementation.

## Lifecycle

`DRAFT → PENDING_REVIEW → REVIEWED | RETURNED | REJECTED`

`RETURNED → PENDING_REVIEW`

`REVIEWED → PENDING_APPROVAL`

`PENDING_APPROVAL → APPROVED | RETURNED | REJECTED`

`APPROVED → SETTLED`

## Difference reasons

- `TIMING_DIFFERENCE`
- `MISSING_COLLECTION`
- `UNPOSTED_INVOICE`
- `DUPLICATE_ENTRY`
- `WRONG_ACCOUNT`
- `WRONG_CURRENCY`
- `WRONG_AMOUNT`
- `UNALLOCATED_COLLECTION`
- `IMPORT_VARIANCE`
- `CUSTODY_VARIANCE`
- `MANUAL_ERROR`
- `OTHER`

## Required delivery

- PostgreSQL migration and executable SQL integrity tests.
- Transactional, idempotent repository with deterministic row locking.
- Permission and operating-mode enforcement.
- List, create, detail, submit, review, return, approve, reject, and settle APIs.
- Arabic RTL list, creation, detail, and governed action interface.
- Unit, authorization, PostgreSQL integration, concurrency, duplicate-settlement, and rollback tests.
