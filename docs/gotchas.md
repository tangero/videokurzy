# Gotchas — videokurzy

## Identity & multi-email

- **`verifiedAt: new Date(0)` sentinel** in `src/lib/user-emails.ts` represents
  "not yet verified" because `user_emails.verifiedAt` is NOT NULL. Future
  refactor: nullable `verifiedAt` or separate `verified: boolean` column.

- **`addUserEmail` error differentiation** (resolved 2026-04-19): duplicate
  email returns "Tento e-mail už na účtu máte" when it belongs to the same
  user, generic "E-mail nelze přidat" otherwise. Do not change to leak
  cross-account existence even for DX debugging.

- **`promotePrimary` / `removeUserEmail` read-then-write race:** application
  reads rows, then writes. Partial unique index
  `user_emails_one_primary_per_user` (migration 0005) prevents dual-primary
  corruption at DB level. No additional safeguard needed for single-user
  self-service flows.

## Better Auth `magicLinkVerify` invalid-token behavior

`auth.api.magicLinkVerify` on invalid/expired tokens throws an internal
`APIError` with `statusCode: 302` (redirect to error page). Even when route
code catches it, Vitest can report it as an unhandled rejection.

Current mitigation: `/internal/auth/verify-token` and
`/internal/auth/verify-add-email` prevalidate the raw magic-link token in the
Better Auth `verification` table before calling `magicLinkVerify`. Missing or
expired tokens return `401 invalid_token` directly; expired rows are deleted.
Valid tokens still go through Better Auth so session creation stays owned by
the library.

Affected endpoints:
- `/internal/auth/verify-token` (Task 7)
- `/internal/auth/verify-add-email` (Task 10)

**Impact:** Avoids test-runner failures for invalid/expired token cases and
keeps production behavior explicit.

**Follow-up:** If Better Auth switches magic-link token storage away from
plain identifiers, update the prevalidation helper in `src/routes/internal.tsx`
to use the same token hashing strategy.

## OIDC provider prototype

The current `better-auth/plugins/oidc-provider` plugin is deprecated and
expects Better Auth OAuth provider tables such as `oauthApplication`,
`oauthAccessToken`, and `oauthConsent`. Our historical `oidc_client` table is
not consumed by that plugin. Discovery metadata works, but external OIDC
client onboarding is not production-ready until the auth module is migrated to
the current Better Auth OAuth provider plugin and matching schema.
