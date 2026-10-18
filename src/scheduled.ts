import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { purchase, siteConfig, lesson, videoStats } from "./db/schema";
import { sendRenewalReminders } from "./lib/renewal-reminders";
import { sendPaymentReminders } from "./lib/payment-reminders";
import { fetchFioTransactions, fioProxyFromEnv, matchPayment } from "./lib/fio";
import { fetchCreditasTransactions, matchCreditasPayment } from "./lib/creditas";
import { sendEmail, purchaseConfirmedHtml, isConsumerPurchase, paymentCancelledHtml } from "./lib/email";
import { sendResendEvent } from "./lib/resend";
import { getPrices } from "./lib/prices";
import { fetchVideoStatistics, syncVideoStats } from "./lib/bunny-stats";
import { detectRecent, defaultFetchers } from "./lib/cc-news/detect";
import { enqueueCcNewsClassify, enqueueCcNewsItem, enqueueToolWeek } from "./queue";
import { maskEmail } from "./lib/errors";
import { expectedPaymentAmount } from "./lib/discount";
import { reportPurchase, bankDateToConversionInstant } from "./lib/conversions";
import { createAndEnqueueInvoiceJob } from "./invoice-queue";
import { shouldInvoice, purchaseToBillingSnapshot, paidOnToTimestamp } from "./lib/invoicing/jobs";
import { reconcileInvoiceJobs } from "./lib/invoicing/reconcile";
import {
  ACCESS_DURATION_DAYS,
  FIO_LOOKBACK_DAYS,
  PRICE_INDIVIDUAL,
  PRICE_ORGANIZATION,
} from "./config/payment";
import type { Env } from "./types";

/**
 * Scheduled handler spouštěný Cloudflare Cron Triggerem.
 * Cron registrován v wrangler.toml: `[triggers] crons = ["0 3 * * *"]` (denně 03:00 UTC).
 *
 * Úkoly:
 * 1. Spárování došlých bankovních plateb (FIO i Creditas) s pending objednávkami.
 * 2. Payment reminders pro nezaplacené pending FIO objednávky (2 a 5 dní po vytvoření).
 * 3. Expirace pending FIO objednávek po splatnosti + storno email.
 * 4. Renewal reminders pro aktivní FIO předplatné (21/14/7/1 den před expirací).
 *
 * Pořadí: scan → reminders → expire — aby se upomínka neposlala objednávce,
 * která byla v témže běhu spárována nebo expirována.
 */
export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();

  // Fakturační reconcile běží na vlastním 15min cronu — záchranná síť outboxu.
  // Denní (0 3) maintenance se sem NEpouští, aby neběžela 96×/den.
  if (event.cron === "*/15 * * * *") {
    try {
      const r = await reconcileInvoiceJobs(db, env, now);
      console.log(`[cron] invoice reconcile: enqueued=${r.enqueued}, scanned=${r.scanned}`);
    } catch (err) {
      console.error("[cron] reconcileInvoiceJobs failed:", err);
    }
    return;
  }

  try {
    // Jeden scan proti oběma bankám (FIO i Creditas) — viz scanBankPayments.
    const result = await scanBankPayments(db, env);
    console.log(
      `[cron] bank scan: matched=${result.matched}, skipped=${result.skipped}` +
        (result.errors.length ? `, errors=${result.errors.join("; ")}` : ""),
    );
  } catch (err) {
    console.error("[cron] scanBankPayments failed:", err);
  }

  try {
    const { sent, errors, skipped } = await sendPaymentReminders(db, env, now);
    if (skipped === -1) {
      console.log("[cron] payment reminders: KILLED via PAYMENT_REMINDERS_ENABLED=false");
    } else {
      console.log(`[cron] payment reminders: sent=${sent}, errors=${errors}, skipped=${skipped}`);
    }
  } catch (err) {
    console.error("[cron] sendPaymentReminders failed:", err);
  }

  try {
    const expiredCount = await expirePendingFioOrders(db, env, now);
    console.log(`[cron] expired ${expiredCount} pending FIO orders at ${event.scheduledTime}`);
  } catch (err) {
    console.error("[cron] expirePendingFioOrders failed:", err);
  }

  try {
    const { sent, errors } = await sendRenewalReminders(db, env, now);
    console.log(`[cron] renewal reminders: sent=${sent}, errors=${errors}`);
  } catch (err) {
    console.error("[cron] sendRenewalReminders failed:", err);
  }

  try {
    const { synced, errors } = await syncVideoStats(db, env);
    console.log(`[cron] video stats: synced=${synced}, errors=${errors}`);
  } catch (err) {
    console.error("[cron] syncVideoStats failed:", err);
  }

  // Detekce nových whats-new digestů Claude Code (služba „Novinky v CC", W-003).
  // Zpracováváme POSLEDNÍ N týdnů, ne jen nejnovější: feed publikuje týdny po
  // párech (dva <item> sdílejí pubDate), takže `detectLatest` (jen první položka)
  // tiše zahodil starší z dvojice — vznikla mezera (chyběl např. Week 25).
  // `detectRecent` je idempotentní (nezměněné týdny = no-op), takže okno N zacelí
  // i dohnané týdny, aniž by cokoli duplikovalo. Při new/changed zařadí každý
  // dotčený týden do fronty pro redakční zpracování (W-004). Nic se zde neodesílá
  // ani nepublikuje — fronta jen předá řízení dál.
  try {
    const outcomes = await detectRecent(db, defaultFetchers(), now, CC_NEWS_DETECT_WEEKS);
    for (const outcome of outcomes) {
      console.log(`[cron] cc-news detect: ${outcome.kind}` +
        (outcome.kind === "empty" ? "" : ` sourceId=${outcome.sourceId}`));
      if (outcome.kind === "new" || outcome.kind === "changed") {
        await enqueueCcNewsItem(env, outcome.itemId, outcome.sourceId);
      }
    }
  } catch (err) {
    console.error("[cron] cc-news detect failed:", err);
  }

  // Interní sledování dalších nástrojů (Grok Build): vlastní kroky, výpadek
  // nesmí zastavit Novinky v CC.
  try {
    await toolsMaintenance(db, env, now);
  } catch (err) {
    console.error("[cron] tools maintenance failed:", err);
  }

  // Novinky v CC ze changelogu (od W38/2026): synchronizace changelogu, snímek
  // dokumentace, v pondělí zmrazení týdne a založení vydání za minulý týden.
  try {
    await ccNewsChangelogMaintenance(db, env, now);
  } catch (err) {
    console.error("[cron] cc-news changelog failed:", err);
  }
}

/**
 * Denní údržba dalších nástrojů: changelog Grok Build (CDN x.ai + první naplnění
 * z GitHubu), snímek docs.x.ai/build, zmrazení uzavřeného týdne a zařazení
 * interního týdenního přehledu. Mezera v řadě verzí = alert (žádný zdroj se neztratil).
 * Pak Codex CLI z GitHub releases (bez snímků dokumentace).
 */
async function toolsMaintenance(db: ReturnType<typeof drizzle>, env: Env, now: Date): Promise<void> {
  const { syncGrokBuild, GROK_BUILD, GROK_BUILD_DOCS } = await import("./lib/tools/grok-build");
  const { snapshotDocs, freezeWeek, docsWeekKey } = await import("./lib/cc-news/docs-snapshot");
  const { lastClosedWeek } = await import("./lib/cc-news/changelog-source");
  const { countUnclassified } = await import("./lib/cc-news/classify");
  const { toolWeekKvKey } = await import("./lib/tools/weekly-tool");

  let caughtUp = false;
  try {
    const r = await syncGrokBuild(db);
    caughtUp = r.caughtUp;
    console.log(`[cron] grok-build: stable ${r.stable}, uloženo do ${r.latest}, nových položek ${r.added}` +
      (r.fetchedVersions.length ? ` (${r.fetchedVersions.join(", ")})` : "") + (r.backfilled ? ", historie z GitHubu" : ""));
    if (r.gap) console.error(`[cron] grok-build: mezera v řadě verzí (stable ${r.stable}, uloženo do ${r.latest}), doplněno ze souboru stable verze`);
    if ((await countUnclassified(db)) > 0) await enqueueCcNewsClassify(env);
  } catch (err) {
    console.error("[cron] grok-build changelog failed:", err);
  }

  const week = lastClosedWeek(now);
  let pending = -1;
  let frozen = false;
  try {
    frozen = !!(await env.KV.get(docsWeekKey(week, GROK_BUILD_DOCS)));
    const snap = await snapshotDocs(env.KV, now, GROK_BUILD_DOCS, 30);
    pending = snap.pending;
    if (snap.fetched) console.log(`[cron] grok-build docs: staženo ${snap.fetched}, změněno ${snap.changed}, odloženo ${snap.pending}`);
    if (!frozen && pending === 0 && (await freezeWeek(env.KV, week, pending, GROK_BUILD_DOCS))) {
      frozen = true;
      console.log(`[cron] grok-build docs: zmrazen týden ${week.year}-w${week.week}`);
    }
  } catch (err) {
    console.error("[cron] grok-build docs failed:", err);
  }

  // Interní přehled uzavřeného týdne jednou (zařadí se, dokud v KV není); bez
  // zmrazené dokumentace se čeká do čtvrtka, pak vznikne jen ze changelogu.
  const { isoWeekBounds } = await import("./lib/cc-news/changelog-source");
  const daysAfter = (now.getTime() - isoWeekBounds(week.year, week.week).end.getTime()) / 86_400_000;
  // Jen po úspěšné synchronizaci, která dohnala stable: jinak by se uložil neúplný týden.
  if (caughtUp && (frozen || daysAfter >= 3) && !(await env.KV.get(toolWeekKvKey(GROK_BUILD, week)))) {
    await enqueueToolWeek(env, GROK_BUILD, week);
  }

  // Codex CLI (GitHub releases openai/codex). Dokumentaci zatím nesnímkujeme,
  // týden se proto zařadí hned po úspěšné synchronizaci v pondělí a dál.
  try {
    const { syncCodex, CODEX } = await import("./lib/tools/codex");
    const r = await syncCodex(db, { token: env.VIBECODING_SITE_GITHUB_TOKEN });
    console.log(`[cron] codex: nejnovější ${r.newest}, uloženo do ${r.latest}, nových položek ${r.added}, stran ${r.pages}` +
      (r.backfilled ? ", první naplnění" : ""));
    if (r.added > 0 && (await countUnclassified(db)) > 0) await enqueueCcNewsClassify(env);
    if (r.caughtUp && !(await env.KV.get(toolWeekKvKey(CODEX, week)))) await enqueueToolWeek(env, CODEX, week);
  } catch (err) {
    console.error("[cron] codex changelog failed:", err);
  }
}

/**
 * Denní údržba zdroje „Novinky v CC" ze changelogu. Kroky jsou na sobě nezávislé
 * (výpadek dokumentace nesmí zastavit synchronizaci changelogu a naopak).
 * Článek se nestaví tady (LLM trvá minuty) — jen se založí vydání a zařadí do fronty.
 */
async function ccNewsChangelogMaintenance(db: ReturnType<typeof drizzle>, env: Env, now: Date): Promise<void> {
  const { fetchChangelog, isoWeekBounds, lastClosedWeek } = await import("./lib/cc-news/changelog-source");
  const { syncChangelogEntries, countUnclassified, syncFloorVersion } = await import("./lib/cc-news/classify");
  const { snapshotDocs, freezeWeek, docsWeekKey } = await import("./lib/cc-news/docs-snapshot");
  const { createChangelogWeekItem } = await import("./lib/cc-news/changelog-week");

  let synced = false;
  try {
    // Od verze vydané před 14 dny výš: verze, ke které dokumentace uvedla datum
    // až později, se tak ještě načte (sync je idempotentní).
    const fromVersion = (await syncFloorVersion(db, now)) ?? "0.0.0";
    const added = await syncChangelogEntries(db, await fetchChangelog(fromVersion));
    console.log(`[cron] cc-news changelog: nových položek ${added} (od ${fromVersion})`);
    if ((await countUnclassified(db)) > 0) await enqueueCcNewsClassify(env);
    synced = true;
  } catch (err) {
    console.error("[cron] cc-news changelog sync failed:", err);
  }

  // Uzavřený týden se zmrazí a založí v pondělí; když to nevyjde (výpadek zdroje,
  // neúplný snímek), zkouší se to další dny, aby týden tiše nevypadl.
  const week = lastClosedWeek(now);
  const weekName = `${week.year}-w${week.week}`;
  let frozen = false;
  let pending = -1;
  try {
    frozen = !!(await env.KV.get(docsWeekKey(week)));
    // Dokud týden není zmrazený, dober snímek celý (až 3 průchody po MAX_PAGES_PER_RUN).
    for (let pass = 0; pass < (frozen ? 1 : 3); pass++) {
      const snap = await snapshotDocs(env.KV, now);
      pending = snap.pending;
      console.log(`[cron] cc-news docs: staženo ${snap.fetched}, změněno ${snap.changed}, odloženo ${snap.pending}`);
      if (pending === 0) break;
    }
  } catch (err) {
    console.error("[cron] cc-news docs snapshot failed:", err);
  }

  try {
    if (!frozen) {
      if (pending !== 0) console.error(`[cron] cc-news docs: snímek neúplný (odloženo ${pending}), týden ${weekName} nezmrazuji`);
      else if (await freezeWeek(env.KV, week, pending)) {
        frozen = true;
        console.log(`[cron] cc-news docs: zmrazen týden ${weekName}${now.getUTCDay() === 1 ? "" : " (opožděně)"}`);
      }
    }
    // Bez zmrazené dokumentace se čeká do čtvrtka, pak vydání vznikne jen ze changelogu.
    const daysAfter = (now.getTime() - isoWeekBounds(week.year, week.week).end.getTime()) / 86_400_000;
    if (!synced) {
      console.error(`[cron] cc-news týden ${weekName}: changelog se nesynchronizoval, vydání nezakládám`);
    } else if (frozen || daysAfter >= 3) {
      if (!frozen) console.error(`[cron] cc-news týden ${weekName}: dokumentace nezmrazena ani po ${Math.floor(daysAfter)} dnech, zakládám jen ze changelogu`);
      const outcome = await createChangelogWeekItem(db, week, now);
      if (outcome.kind !== "exists") console.log(`[cron] cc-news týden ${weekName}: ${outcome.kind}`);
      if (outcome.kind === "created") await enqueueCcNewsItem(env, outcome.itemId, outcome.sourceId);
    }
  } catch (err) {
    console.error("[cron] cc-news weekly item failed:", err);
  }
}

// Kolik posledních týdnů whats-new cron prověřuje na každý běh. Okno > 1 zacelí
// mezery z dvojic týdnů sdílejících pubDate; idempotence zajistí, že už viděné
// týdny jsou no-op. 3 je bezpečná rezerva (typicky se publikují dva najednou).
const CC_NEWS_DETECT_WEEKS = 3;

/**
 * Spáruje došlé bankovní platby s pending převodovými objednávkami — proti
 * OBĚMA bankám zároveň (FIO i Creditas).
 *
 * Historicky se každá objednávka párovala jen proti bance ze svého
 * `paymentMethod` (FIO objednávka jen proti FIO, Creditas jen proti Creditas).
 * Jenže lidé reálně platí, kam mají uložený účet — typicky pošlou Creditas
 * objednávku na starý FIO účet podle dřívější faktury. Taková platba pak
 * uvízla jako nespárovaná napořád. Teď zkoušíme každou objednávku proti oběma
 * sadám transakcí; transakce se zapíše do sloupce podle banky, kde se reálně
 * našla, ne podle `paymentMethod`.
 *
 * Selhání načtení jedné banky (např. FIO 525 z Workers) nezablokuje druhou —
 * objednávky se spárují proti tomu, co se načíst povedlo.
 *
 * Vrací { matched, skipped, errors } agregovaně za obě banky.
 */
export async function scanBankPayments(
  db: ReturnType<typeof drizzle>,
  env: Env,
): Promise<{ matched: number; skipped: number; errors: string[] }> {
  const pending = await db
    .select()
    .from(purchase)
    .where(
      and(
        eq(purchase.status, "pending"),
        inArray(purchase.paymentMethod, ["fio", "creditas"]),
      ),
    );

  if (pending.length === 0) {
    return { matched: 0, skipped: 0, errors: [] };
  }

  const errors: string[] = [];

  // Pojistka proti tiché misconfiguraci: pokud máme pending objednávky pro danou
  // banku, ale chybí její produkční secret, fetch by spadl do dev fallbacku a
  // vrátil prázdno BEZ chyby — platby by uvízly napořád a scan by mlčel.
  // (Creditas secret se historicky jmenoval špatně `CREDITAS_API_KEY` místo
  // `CREDITAS_API_TOKEN`, což přesně tohle způsobilo — viz CLAUDE.md.)
  const creToken = env.CREDITAS_API_TOKEN ?? "dev";
  const hasCrePending = pending.some((p) => p.paymentMethod === "creditas");
  const hasFioPending = pending.some((p) => p.paymentMethod === "fio");
  if (hasCrePending && (creToken === "dev" || !env.CREDITAS_IDENTIFIKATOR)) {
    errors.push(
      "Creditas token/identifikátor nenastaven (env CREDITAS_API_TOKEN / CREDITAS_IDENTIFIKATOR) — Creditas platby se NEPÁRUJÍ!",
    );
  }
  if (hasFioPending && (!env.FIO_API_TOKEN || env.FIO_API_TOKEN === "dev")) {
    errors.push("FIO token nenastaven (env FIO_API_TOKEN) — FIO platby se NEPÁRUJÍ!");
  }

  // Načti obě banky nezávisle — chyba jedné nesmí shodit druhou.
  const fio = await fetchFioTransactions(
    env.FIO_API_TOKEN,
    FIO_LOOKBACK_DAYS,
    fioProxyFromEnv(env),
  );
  if (!fio.ok) errors.push(`FIO fetch failed: ${fio.status} ${fio.error}`);

  const cre = await fetchCreditasTransactions(
    creToken,
    env.CREDITAS_IDENTIFIKATOR ?? "",
    FIO_LOOKBACK_DAYS,
  );
  if (!cre.ok) errors.push(`Creditas fetch failed: ${cre.status} ${cre.error}`);

  const fioTxs = fio.ok ? fio.transactions : [];
  const creTxs = cre.ok ? cre.transactions : [];

  // Obě banky selhaly — nemáme co párovat, vše skip.
  if (!fio.ok && !cre.ok) {
    return { matched: 0, skipped: pending.length, errors };
  }

  // Načti aktuální ceny z site_config.
  const cfgRows = await db.select().from(siteConfig);
  const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
  const priceIndividual = parseInt(cfg.price_individual ?? String(PRICE_INDIVIDUAL), 10);
  const priceOrganization = parseInt(cfg.price_organization ?? String(PRICE_ORGANIZATION), 10);

  // Dedup per banka — jeden převod nesmí spárovat dvě objednávky. FIO ID je
  // číslo, Creditas string, proto dva oddělené sety.
  const usedFio = new Set<number>();
  const usedCre = new Set<string>();
  let matched = 0;

  // Napárované páry posbírané ve fázi matchingu; aktivují se až potom.
  const pendingMatches: Array<{
    p: typeof purchase.$inferSelect;
    bank: "fio" | "creditas";
    transactionId: string;
    amountPaid: number;
    transactionDate: string | null; // datum bankovní transakce — čas konverze (R6)
    // Datum bankovní transakce (připsání) — účetní datum faktury, ne čas cronu.
    // null = banka datum neuvedla → fakturace půjde do estimated/manual review.
    paidOnIso: string | null;
  }> = [];

  for (const p of pending) {
    if (!p.variableSymbol) continue;
    const fullExpected = p.type === "organization" ? priceOrganization : priceIndividual;
    const expectedAmount = expectedPaymentAmount(p.amountPaid, fullExpected, p.discountPercent ?? 0);

    // Pořadí: nejdřív zkus „vlastní" banku objednávky (nejčastější případ),
    // pak druhou. U Creditas objednávky tedy nejdřív Creditas, pak FIO fallback.
    const tryFio = (): boolean => {
      const r = matchPayment(fioTxs, p.variableSymbol!, expectedAmount, usedFio);
      if (!r.found || !r.transaction) return false;
      usedFio.add(r.transaction.id);
      pendingMatches.push({
        p,
        bank: "fio",
        transactionId: String(r.transaction.id),
        amountPaid: r.transaction.amount,
        transactionDate: r.transaction.date,
        paidOnIso: r.transaction.date,
      });
      return true;
    };
    const tryCre = (): boolean => {
      const r = matchCreditasPayment(creTxs, p.variableSymbol!, expectedAmount, usedCre);
      if (!r.found || !r.transaction) return false;
      usedCre.add(r.transaction.id);
      pendingMatches.push({
        p,
        bank: "creditas",
        transactionId: r.transaction.id,
        amountPaid: r.transaction.amount,
        transactionDate: r.transaction.date,
        paidOnIso: r.transaction.date,
      });
      return true;
    };

    if (p.paymentMethod === "creditas") {
      if (!tryCre()) tryFio();
    } else {
      if (!tryFio()) tryCre();
    }
  }

  // Aktivace až po napárování všech — držíme dedup sety konzistentní a
  // neblokujeme matching pomalými side-effecty (Fakturoid, email).
  for (const m of pendingMatches) {
    try {
      await activateMatchedPurchase(db, env, m.p, {
        bank: m.bank,
        transactionId: m.transactionId,
        amountPaid: m.amountPaid,
        transactionDate: m.transactionDate,
        paidOnIso: m.paidOnIso,
      });
      matched++;
    } catch (err) {
      errors.push(`update purchase ${m.p.id} failed: ${(err as Error).message}`);
    }
  }

  return { matched, skipped: pending.length - matched, errors };
}

/**
 * Zpětně kompatibilní wrapper. Dřív pároval jen FIO objednávky proti FIO;
 * teď deleguje na cross-bank `scanBankPayments`. Ponechán kvůli ručnímu scanu
 * v adminu (`/admin/api/fio/scan`) a partner/internal callsite.
 */
export async function scanFioPayments(
  db: ReturnType<typeof drizzle>,
  env: Env,
): Promise<{ matched: number; skipped: number; errors: string[] }> {
  return scanBankPayments(db, env);
}

/**
 * Společná aktivace spárované převodové objednávky (FIO i Creditas):
 * status=active + roční expirace, uložení transakce do správného sloupce,
 * Resend onboarding event, magic-link email a vystavení faktury ve Fakturoidu.
 *
 * Voláno z obou bankovních scanů — drží jednotnou post-payment logiku na jednom
 * místě. Hází jen na selhání hlavního UPDATU purchase; vedlejší kroky (resend,
 * email, Fakturoid) si chyby logují samy, ať jedna porucha nezablokuje pár.
 */
async function activateMatchedPurchase(
  db: ReturnType<typeof drizzle>,
  env: Env,
  p: typeof purchase.$inferSelect,
  match: {
    bank: "fio" | "creditas";
    transactionId: string;
    amountPaid: number;
    transactionDate: string | null; // datum bankovní transakce — čas konverze (R6)
    paidOnIso?: string | null; // datum připsání — účetní datum faktury
  },
): Promise<void> {
  const newExpiresAt = new Date(Date.now() + ACCESS_DURATION_DAYS * 86400 * 1000);
  const txColumn =
    match.bank === "creditas"
      ? { creditasTransactionId: match.transactionId }
      : { fioTransactionId: match.transactionId };

  // Čas konverze = den bankovní transakce (začátek dne v Europe/Prague). Uložíme
  // ho PŘED reportem konverze, ať reportPurchase čte autoritativní hodnotu z row.
  const conversionOccurredAt = bankDateToConversionInstant(match.transactionDate);

  await db
    .update(purchase)
    .set({
      status: "active",
      expiresAt: newExpiresAt,
      amountPaid: match.amountPaid,
      conversionOccurredAt,
      ...txColumn,
    })
    .where(eq(purchase.id, p.id));

  // Resend automation event — onboarding sekvence. Bez tohohle by převodoví
  // kupující do automatu vůbec nevstoupili (Stripe ho fíruje v queue.ts).
  sendResendEvent(env.RESEND_API_KEY, "purchase.completed", p.email.toLowerCase(), {
    type: p.type,
    paymentMethod: match.bank,
  }).catch((err) => console.error(`[cron] resend event failed for purchase ${p.id} (${maskEmail(p.email)}):`, err));

  // Email s magic linkem ke kurzu — nečekáme na něj, ať jeden výpadek
  // Resendu nezablokuje další pářování.
  sendEmail(env, {
    to: p.email,
    subject: "Platba přijata — přihlaste se do kurzu",
    html: await purchaseConfirmedHtml(
      `${env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(p.email)}`,
      p.type as "individual" | "organization",
      isConsumerPurchase(p),
      await getPrices(drizzle(env.DB)),
    ),
  }).catch((err) => console.error(`[cron] email send failed for purchase ${p.id} (${maskEmail(p.email)}):`, err));

  // Fakturace přes outbox — založ invoice_job + zařaď. I při výpadku enqueue
  // řádek v DB zůstane a reconcile cron ho doručí (žádná osiřelá faktura).
  // Fakturuj skutečně přijatou bankovní částku (match.amountPaid), ne očekávání.
  if (shouldInvoice({ kind: p.kind, amountPaid: match.amountPaid })) {
    // Účetní datum = datum bankovní transakce (připsání), NE čas běhu cronu.
    // FIO vrací "YYYY-MM-DD+TZ", Creditas ISO — vytáhneme jen datum a kotvíme na
    // poledne UTC (po převodu do TZ Praha zůstává stejný den). Když datum chybí /
    // je nečitelné → fallback na teď s confidence='estimated' (job pak nepošle
    // fakturu automaticky, ale jde do needs_manual_review).
    const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(match.paidOnIso ?? "");
    const paidAt = dateMatch ? paidOnToTimestamp(dateMatch[1]) : new Date();
    await createAndEnqueueInvoiceJob(db, env, {
      purchaseId: p.id,
      jobKind: "initial_purchase",
      paymentSource: match.bank, // 'fio' | 'creditas'
      sourceEventId: match.transactionId,
      amount: match.amountPaid,
      paidAt,
      paidAtSource: "bank_api",
      paidAtConfidence: dateMatch ? "exact" : "estimated",
      billing: purchaseToBillingSnapshot(p),
    });
  }

  // Report konverze do reklamních platforem. Idempotentní (per-provider claim),
  // best-effort — reportPurchase nikdy nehází, takže aktivaci/fakturaci neohrozí.
  // Hodnotu i čas konverze už máme uložené na row; předáme je explicitně.
  await reportPurchase(db, env, p.id, {
    valueOverride: match.amountPaid,
    conversionOccurredAt,
  });
}

/**
 * Přepne všechny pending FIO objednávky s expiresAt < now na status `expired`
 * a každému uživateli pošle storno email s odkazem na novou objednávku.
 * Email se posílá jen reálným objednávkám (`kind='paid'`) — granty by sem
 * stejně neměly přijít, ale filtr je explicitní pro jistotu.
 */
async function expirePendingFioOrders(
  db: ReturnType<typeof drizzle>,
  env: Env,
  now: Date
): Promise<number> {
  // Načti řádky před UPDATEm, abychom měli email + VS pro storno mail.
  const expiring = await db
    .select({
      id: purchase.id,
      email: purchase.email,
      type: purchase.type,
      variableSymbol: purchase.variableSymbol,
    })
    .from(purchase)
    .where(
      and(
        eq(purchase.status, "pending"),
        inArray(purchase.paymentMethod, ["fio", "creditas"]),
        eq(purchase.kind, "paid"),
        lt(purchase.expiresAt, now)
      )
    );

  if (expiring.length === 0) return 0;

  const ids = expiring.map((r) => r.id);
  await db
    .update(purchase)
    .set({ status: "expired" })
    .where(inArray(purchase.id, ids));

  // Storno emaily — kill switch sdílíme s payment reminders, ať lze obojí vypnout jedním přepínačem.
  const killed = (env as { PAYMENT_REMINDERS_ENABLED?: string }).PAYMENT_REMINDERS_ENABLED === "false";
  if (!killed) {
    for (const r of expiring) {
      if (!r.variableSymbol) continue;
      const reorderUrl = `${env.BETTER_AUTH_URL}/checkout/${r.type === "organization" ? "organization" : "individual"}`;
      sendEmail(env, {
        to: r.email,
        subject: "Vaše objednávka kurzu byla stornována",
        html: paymentCancelledHtml({ reorderUrl, vs: r.variableSymbol }),
      }).catch((err) => console.error(`[cron] cancel email for purchase ${r.id} failed:`, err));
    }
  }

  return expiring.length;
}
