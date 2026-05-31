# Auth master — internal API reference

Videokurzy Worker serves as the Better Auth master for the entire
`*.vibecoding.cz` ecosystem. External consumers (other domains) are a
separate OAuth/OIDC milestone; the current OIDC endpoint only exposes
discovery metadata.

## Env vars

| Name | Purpose | Example |
|---|---|---|
| `BETTER_AUTH_SECRET` | Better Auth session signing key (32+ chars) | `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | Public Worker URL | `https://kurzy.vibecoding.cz` |
| `AUTH_INTERNAL_SECRET` | Shared secret for service-binding callers | `openssl rand -hex 32` |
| `RESEND_API_KEY` | Resend API key for magic link emails | `re_...` |
| `COOKIE_DOMAIN` | Cookie Domain attribute (prod only) | `.vibecoding.cz` |

In dev, leave `COOKIE_DOMAIN` unset — cookies stay host-only.

## Internal API (Service Binding)

All `/internal/*` endpoints require header `X-Internal-Secret: <AUTH_INTERNAL_SECRET>`.
Missing or wrong → 403 `{ "error": "forbidden" }`.

### `POST /internal/auth/magic-link`

Sends a magic link to the given email with callback URL pointing back
into the consumer.

Body:
```json
{
  "email": "user@example.cz",
  "callbackUrl": "https://vibecoding.cz/auth/verify"
}
```

Callback URL must be on `vibecoding.cz`, a subdomain, or `http://localhost:*`.

Responses:
- `200 { "ok": true }` — magic link queued for delivery
- `400 { "error": "..." }` — missing field or disallowed callback
- `401/403/429` — upstream rejection (relayed from Better Auth)
- `502 { "error": "send_failed", "correlationId": "..." }` — unknown upstream failure

### `POST /internal/auth/verify-token`

Verifies the token from the magic link URL and returns user + session.

Body: `{ "token": "<from query string>" }`

Response (200):
```json
{
  "user": { "id": "...", "email": "...", "name": "...", "role": "user" },
  "sessionToken": "...",
  "expiresAt": "2026-07-19T12:00:00.000Z",
  "setCookie": "better-auth.session_token=...; HttpOnly; Secure; SameSite=Lax; Max-Age=..."
}
```

Consumer should forward `setCookie` to the browser via `Set-Cookie` header.

- `400` — token missing
- `401 { "error": "invalid_token", "correlationId": "..." }` — invalid/expired

### `GET /internal/auth/me`

Returns the current session user when the `Cookie` header carries a valid
Better Auth session.

Response: `200 { "user": {...}, "expiresAt": "..." }` or `401 { "error": "unauthenticated" }`.

### `POST /internal/auth/revoke`

Idempotent logout. Returns `{ "ok": true, "setCookie": "..." | null }`.
`setCookie` contains `Max-Age=0` when a session existed.

### `POST /internal/auth/verify-add-email`

**Security contract:** The target account is authorized by a server-signed
add-email intent generated when the logged-in user starts the flow. The raw
`userId` sent by the caller is only a backwards-compatible mismatch check.

Attaches a magic-link-verified email to the intent-bound user account and
revokes the ad-hoc session produced by the verify flow.

Body: `{ "token": "...", "intent": "...", "userId": "..." }`

Response: `200 { "ok": true, "email": "..." }` or `401`.

## Public API (session-protected)

All `/api/profile/*` endpoints require a valid Better Auth session cookie
(shared across subdomains via `Domain=.vibecoding.cz`).

### `GET /api/profile/emails`

List all emails on the current user.

Response: `{ "emails": [{ id, email, isPrimary, verifiedAt, addedVia, ... }] }`.

### `POST /api/profile/emails`

Start the "add secondary email" flow — sends a magic link to the new
address with `?intent=add-email&userId=<current-user-id>&addEmailIntent=<signed-intent>`
in the callback.

Body: `{ "email": "new@private.cz", "callbackUrl": "https://vibecoding.cz/auth/verify" }`

Consumer handles the callback: calls `/internal/auth/verify-add-email`
with `{ token, intent: addEmailIntent, userId }` to complete the attachment.

### `PATCH /api/profile/emails`

Promote to primary. Body: `{ "email": "...", "promote": true }`.

### `DELETE /api/profile/emails`

Remove a secondary email. Body: `{ "email": "..." }`. Rejects if it's the
only email or the primary.

### `POST /api/profile/recovery-banner/dismiss`

Hide the "add a backup email" banner for 30 days.

## Rate limits

Better Auth applies default rate limits via the custom KV-backed storage in
`src/lib/auth.ts`: 10 attempts per 60-second window per identifier (email,
IP). Adjust in `auth.ts` `rateLimit` block.

## OIDC Provider (for external consumers)

Discovery: `https://kurzy.vibecoding.cz/api/auth/.well-known/openid-configuration`

Status: prototype only. The current `better-auth/plugins/oidc-provider`
plugin is deprecated and expects Better Auth OAuth provider tables such as
`oauthApplication`, `oauthAccessToken`, and `oauthConsent`. The local
`oidc_client` table was created during the first auth-master plan, but the
plugin does not read it. Do not onboard external OIDC clients until this is
reworked against the current Better Auth OAuth provider plugin and matching
schema.

## Testing

- `npm test` — full suite (46 tests at end of Plan A)
- `npm run test:watch` — TDD watch mode
- See `tests/setup-db.ts` — migrations auto-apply in test D1

## Deploy

1. Local testing: `npm run dev` + `npm test`
2. Production migration: `npm run db:migrate:prod`
3. Production deploy: `npm run deploy`

**Note:** For `COOKIE_DOMAIN=.vibecoding.cz` to take effect, the deploy
script must use `--env production` (`wrangler deploy --env production`).
See TODO in `wrangler.toml`.

## Related docs

- `docs/gotchas.md` — known quirks (magic-link token prevalidation,
  unverified email sentinel, OIDC prototype status, etc.)
- Plan: `docs/superpowers/plans/2026-04-19-auth-master.md`
