# videokurzy — kurz.vibecoding.cz

## Stack
- Cloudflare Workers + Hono (TypeScript) + htmx
- Drizzle ORM + Cloudflare D1 (SQLite)
- Better Auth (magic link plugin, JWT sessions)
- Stripe Checkout + Cloudflare Queues
- Bunny Stream (signed embed URLs)
- Resend (transactional emails)
- Tailwind CSS

## Commands
- `pnpm dev` — Start local dev server (wrangler dev)
- `pnpm deploy` — Deploy to Cloudflare Workers
- `pnpm db:generate` — Generate Drizzle migrations
- `pnpm db:migrate` — Apply migrations locally
- `pnpm db:migrate:prod` — Apply migrations to production D1
- `pnpm typecheck` — TypeScript type checking

## Architecture
- Server-rendered HTML via Hono JSX + htmx for interactivity
- JWT sessions verified on edge (no DB lookup for auth)
- Authorization (purchase/org check) via D1 query
- Stripe webhooks processed async via Cloudflare Queues
- KV cache for landing page and course catalog

## Key Patterns
- Better Auth instance created per-request (D1 binding is request-scoped)
- htmx requests detected via `HX-Request` header; expired session returns `HX-Redirect`
- Integer autoincrement PKs internally, nanoid publicId for URLs
- Stripe webhook idempotence via UNIQUE constraint on stripePaymentId
