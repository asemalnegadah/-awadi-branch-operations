# Cash Custody, Handover, and Daily Closing

## Scope

This vertical slice governs representative cash custody, partial cash handovers, and daily closing for the single Aden branch.

## Invariants

1. Every amount is an integer minor-unit amount and belongs to exactly one currency: `SR` or `RG`.
2. A representative's custody balance is derived only from append-only custody events.
3. Approved cash collections enter the representative's custody once.
4. A handover may be partial, but it may never exceed the locked available balance for the same representative and currency.
5. A daily closing is unique per representative, business date, and currency while active.
6. Daily boundaries use `Asia/Aden`; device dates are not authoritative.
7. On each submission, the server creates a new immutable snapshot revision from custody events.
8. Expected cash equals opening custody plus same-day inflows minus same-day outflows.
9. Variance equals declared cash minus expected cash. A non-zero variance requires an explicit reason.
10. Draft and returned closings may be corrected. Submitted, reviewed, pending-approval, approved, and rejected snapshots are immutable.
11. In `MULTI_USER` mode, creator, reviewer, and approver must be independent users. Existing governed single-manager rules apply only in `SINGLE_MANAGER` mode.
12. An approved closing cannot be edited, deleted, or superseded silently.
13. No backdated custody event may be inserted into a date that is under review or already approved.
14. Lifecycle events, snapshot items, handovers, and command records are append-only.
15. Identical replay returns the original result. Reusing an idempotency key with a different canonical payload is rejected.
16. Every command runs in one PostgreSQL transaction; a late failure rolls back all state, snapshot, command, event, and audit writes.

## Lifecycle

`DRAFT -> PENDING_REVIEW -> REVIEWED -> PENDING_APPROVAL -> APPROVED`

Return and rejection paths:

- `PENDING_REVIEW -> RETURNED | REJECTED`
- `PENDING_APPROVAL -> RETURNED | REJECTED`
- `RETURNED -> PENDING_REVIEW` after correction and a new snapshot revision

## Permissions

- `cash_custody.read`
- `cash_custody.handover`
- `cash_closings.read`
- `cash_closings.create`
- `cash_closings.review`
- `cash_closings.approve`
- `cash_closings.view_history`

## Production safety

This slice introduces additive tables, indexes, triggers, and permissions. It does not alter or delete historical custody events. Production migration remains blocked until backup, restore verification, rehearsal, lock-duration measurement, and deployment checks are completed.
