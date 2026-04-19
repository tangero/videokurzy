# Gotchas — videokurzy

## Identity & multi-email

- **`verifiedAt: new Date(0)` sentinel** in `src/lib/user-emails.ts` represents
  "not yet verified" because `user_emails.verifiedAt` is NOT NULL. Future
  refactor: nullable `verifiedAt` or separate `verified: boolean` column.

- **`addUserEmail` error message for duplicate** currently says "already
  registered" regardless of whether it's on the same user or different. Before
  this flows to a user-facing API, distinguish: "you already have this email"
  vs. generic "cannot add" (do not leak cross-account existence).

- **`promotePrimary` / `removeUserEmail` read-then-write race:** application
  reads rows, then writes. Partial unique index
  `user_emails_one_primary_per_user` (migration 0005) prevents dual-primary
  corruption at DB level. No additional safeguard needed for single-user
  self-service flows.

## Better Auth `magicLinkVerify` unhandled rejection

`auth.api.magicLinkVerify` on invalid/expired tokens throws an internal
`APIError` with `statusCode: 302` (redirect to error page). Even with
`asResponse: true` this surfaces in vitest as an "Unhandled Rejection" log
line — the error is still correctly caught by our try/catch and returns 401
to the caller. Tests pass.

Affected endpoints:
- `/internal/auth/verify-token` (Task 7)
- `/internal/auth/verify-add-email` (Task 10)

**Impact:** Log noise in tests; no functional impact. Production traffic
works correctly.

**Follow-up:** If this becomes noisy in production logs, consider detecting
the redirect status before it throws by parsing `result.status === 302`
before reading `result.headers`. Or file upstream issue with better-auth.
