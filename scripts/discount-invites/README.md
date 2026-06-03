# Osobní slevové odkazy

Postup pro rozeslání 50% slevy lidem z jiného systému (vibecoding.cz).

## 1. Připrav CSV e-mailů

Jeden e-mail na řádek (volitelně hlavička `email`):

```
email
clovek1@example.cz
clovek2@example.cz
```

## 2. Vygeneruj tokeny a odkazy

```bash
node scripts/discount-invites/generate.mjs \
  --csv emaily.csv --percent 50 --batch vibecoding-2026-06 \
  --label "Osobní sleva pro absolventy" --expires 2026-12-31 \
  --base https://kurzy.vibecoding.cz
```

(Pokud by starší Node odmítl import `.ts`, použij `npx tsx scripts/discount-invites/generate.mjs ...`.)

Vytvoří `out/invites.sql` a `out/invites.csv` (negitované).

## 3. Nahraj tokeny do produkční DB

```bash
npx wrangler d1 execute videokurzy-db --remote --file=scripts/discount-invites/out/invites.sql
```

## 4. Rozešli e-maily (s ostrým klíčem)

Nejdřív dry-run a malý limit:

```bash
node scripts/discount-invites/send.mjs --csv scripts/discount-invites/out/invites.csv \
  --from "Videokurzy <andrea@vibecoding.cz>" --dry-run --limit 3
```

Pak ostře:

```bash
RESEND_API_KEY=re_xxx node scripts/discount-invites/send.mjs \
  --csv scripts/discount-invites/out/invites.csv \
  --from "Videokurzy <andrea@vibecoding.cz>" \
  --subject "Sleva 50 % na videokurz Claude Code"
```

Volitelně `--reply-to "andrea@vibecoding.cz"` a `--limit N`.

Pozn.: ostrý `RESEND_API_KEY` žije jen v Cloudflare; sem se dodává za běhu. Tvar
volání Resend API odpovídá `src/lib/email.ts`.

## 5. Reporting — kolik tokenů využito

```bash
npx wrangler d1 execute videokurzy-db --remote \
  --command "SELECT batch, COUNT(*) total, SUM(usedAt IS NOT NULL) used FROM discount_invite GROUP BY batch"
```
