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
