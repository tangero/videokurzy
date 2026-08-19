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

## Magic link a `allowedAttempts` (link scannery)

Better Auth defaultuje `magicLink({ allowedAttempts: 1 })` — **první** GET na
verify URL token spálí. Tím GETem ale často není klik uživatele, nýbrž
automatický prefetch: Microsoft Defender Safe Links, antivirové skenery odkazů
(ESET, Avast, Bitdefender) nebo náhled mailového klienta. Uživatel pak klikne,
dostane `ATTEMPTS_EXCEEDED`, verify nenastaví cookie a on skončí zpátky na
`/login` — bez jakéhokoli vysvětlení. Nahlášeno zákazníkem 2026-08-19,
reprodukováno v `tests/routes/magic-link-verify.test.ts`.

Nastaveno `allowedAttempts: 3` v `src/lib/auth.ts`. Nesnižovat zpět na 1:
proti brute-force chrání entropie tokenu (32 náhodných znaků) a 10min
platnost, ne tenhle counter.

Druhá půlka problému byla viditelnost: verify redirectuje při chybě na
`callbackURL` s `?error=...`, což bylo `/dashboard` → `requireAuth` uviděl
prázdnou session a mlčky přesměroval na `/login`, čímž se `error` zahodil.
`/login/send` proto posílá `errorCallbackURL: "/login"` a GET `/login`
překládá kódy (`EXPIRED_TOKEN`, `ATTEMPTS_EXCEEDED`, `INVALID_TOKEN`) na české
hlášky. Neznámý kód padá na obecnou hlášku — syrový kód se uživateli nikdy
nevypisuje.

### Testování verify: pozor na unhandled rejections

`magicLinkVerify` signalizuje redirect přes `throw ctx.redirect(...)` — a to
i při **úspěchu** (`magic-link/index.mjs:162-163`), ne jen na chybové větvi.
Better Auth výjimku sám zachytí a převede na Response, ale Vitest ji stihne
zahlédnout jako unhandled rejection a shodí běh **exit kódem 1 i při zelených
asercích** (`Tests 7 passed` + `Errors 6 errors`).

Proto v testech verify nevoláme přes `SELF.fetch` na URL s `callbackURL`, ale:

1. `auth.api.magicLinkVerify({ query: { token }, asResponse: true })` **bez
   `callbackURL`** → handler vrací `ctx.json(...)` (řádek 157), žádná výjimka.
2. Chybové větve (vyčerpaný/neplatný token) netestovat voláním Better Auth
   vůbec — `redirectWithError` (řádek 118) vyhazuje vždy a `errorCallbackURL`
   fallbackuje na `callbackURL` a ten na `"/"`, takže se výjimce nedá vyhnout.
   Místo toho ověřit `attempt` counter přímo ve `verification` tabulce; je to
   tatáž hodnota, kterou plugin porovnává s `allowedAttempts` na řádku 129.

Vzor: `tests/routes/magic-link-verify.test.ts`. Nepotlačovat globálně ve
`vitest.config.ts` — maskovalo by to skutečné chyby jinde.

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
