import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { and, desc, eq, asc, inArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { Env, Variables } from "../types";
import { requireAdmin } from "../middleware/auth";
import { course, module, lesson, organization, purchase, user, siteConfig } from "../db/schema";
import { Layout } from "../views/layout";
import { sendEmail, organizationApprovedHtml, adminWelcomeUserHtml } from "../lib/email";
import {
  createAdminUsers,
  defaultAdminGrantExpiresOn,
  parseAdminGrantExpiresAt,
  listAdminUsers,
  getAdminUserDetail,
  updateAdminUser,
  deleteAdminUser,
  grantAdminAccess,
  revokeAdminPurchase,
  extendAdminPurchase,
} from "../lib/admin-users";
import { AdminUsersList, AdminUserDetailView } from "../views/admin-users";
import { AdminStatsPage } from "../views/admin-stats";
import {
  triggerTranscribe,
  fetchBunnyVideo,
  fetchCaptionVtt,
  findCzechCaption,
  vttToPlainText,
} from "../lib/transcribe";
import { countDiscountedActivePurchases } from "../lib/discount";
import { scanFioPayments } from "../scheduled";
import {
  exportPurchaseInvoice,
  fetchInvoice,
  findSubjectByEmail,
  listSubjectInvoices,
  markInvoicePaid,
} from "../lib/fakturoid";
import Stripe from "stripe";
import {
  AdminNav,
  AdminCoursesList,
  AdminCourseForm,
  AdminCourseDetail,
  AdminModuleForm,
  AdminLessonForm,
  AdminSettingsForm,
} from "../views/admin-courses";

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_WELCOME_MESSAGE = `Ahoj či Dobrý den,
zřídil jsem Ti účet do mojí vzdělávací AI platformy kurzy.vibecoding.cz. Budu rád, když mi dáš zpětnou vazbu na to, co jsi se tu naučil! Patrick`;

const AdminUserForm: FC<{
  error?: string;
  values?: {
    emails?: string;
    name?: string;
    role?: string;
    access?: string;
    accessExpiresOn?: string;
    sendWelcomeEmail?: boolean;
    welcomeMessage?: string;
  };
}> = ({ error, values }) => (
  <div class="max-w-2xl mx-auto px-4 py-8">
    <h1 class="text-2xl font-bold mb-6">Admin</h1>
    <AdminNav active="/admin/users/new" />
    <h2 class="text-xl font-bold mb-2">Nový uživatel</h2>
    <p class="text-sm text-gray-600 mb-6">
      Uživatel se zakládá bez hesla. Přístup získá přes magic link na přihlašovací stránce.
    </p>
    {error && (
      <div class="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    )}
    <form method="post" action="/admin/users/new" class="bg-white border rounded-lg p-5 space-y-4">
      <label class="block">
        <span class="block text-sm font-medium text-gray-700 mb-1">E-maily</span>
        <textarea
          name="emails"
          required
          rows={6}
          class="w-full rounded border px-3 py-2"
          placeholder={"jmeno@example.com\njine.jmeno@example.com"}
        >
          {values?.emails ?? ""}
        </textarea>
        <span class="mt-1 block text-xs text-gray-500">
          Vlož jeden nebo více e-mailů. Oddělení může být nový řádek, mezera, čárka nebo středník.
        </span>
      </label>
      <label class="block">
        <span class="block text-sm font-medium text-gray-700 mb-1">Jméno</span>
        <input
          name="name"
          value={values?.name ?? ""}
          class="w-full rounded border px-3 py-2"
          placeholder="Volitelné"
        />
        <span class="mt-1 block text-xs text-gray-500">
          Jméno se použije jen při založení jednoho uživatele.
        </span>
      </label>
      <label class="block">
        <span class="block text-sm font-medium text-gray-700 mb-1">Role</span>
        <select name="role" class="w-full rounded border px-3 py-2">
          <option value="user" selected={(values?.role ?? "user") === "user"}>
            user
          </option>
          <option value="admin" selected={values?.role === "admin"}>
            admin
          </option>
        </select>
      </label>
      <fieldset class="rounded border px-3 py-3">
        <legend class="px-1 text-sm font-medium text-gray-700">Přístup</legend>
        <div class="space-y-2 text-sm">
          <label class="flex items-start gap-2">
            <input
              type="radio"
              name="access"
              value="free"
              checked={(values?.access ?? "individual") === "free"}
              class="mt-1"
            />
            <span>
              <span class="font-medium">Zdarma</span>
              <span class="block text-gray-500">Bez placené licence, uvidí jen bezplatné lekce.</span>
            </span>
          </label>
          <label class="flex items-start gap-2">
            <input
              type="radio"
              name="access"
              value="individual"
              checked={(values?.access ?? "individual") === "individual"}
              class="mt-1"
            />
            <span>
              <span class="font-medium">Soukromá licence</span>
              <span class="block text-gray-500">Plný přístup do zvoleného data.</span>
            </span>
          </label>
          <label class="flex items-start gap-2">
            <input
              type="radio"
              name="access"
              value="organization"
              checked={values?.access === "organization"}
              class="mt-1"
            />
            <span>
              <span class="font-medium">Firemní licence</span>
              <span class="block text-gray-500">Plný přístup pro tyto uživatele do zvoleného data.</span>
            </span>
          </label>
        </div>
      </fieldset>
      <label class="block">
        <span class="block text-sm font-medium text-gray-700 mb-1">Platnost přístupu do</span>
        <input
          name="accessExpiresOn"
          type="date"
          value={values?.accessExpiresOn ?? defaultAdminGrantExpiresOn()}
          class="w-full rounded border px-3 py-2"
        />
        <span class="mt-1 block text-xs text-gray-500">
          Výchozí hodnota je 90 dní od dnešního dne. U volby Zdarma se placená licence nevytváří.
        </span>
      </label>
      <fieldset class="rounded border px-3 py-3">
        <legend class="px-1 text-sm font-medium text-gray-700">Uvítací e-mail</legend>
        <label class="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="sendWelcomeEmail"
            value="on"
            checked={values?.sendWelcomeEmail ?? true}
            class="mt-1"
          />
          <span>
            <span class="font-medium">Odeslat uvítací e-mail z patrick@vibecoding.cz</span>
            <span class="block text-gray-500">
              Pod tvůj text se automaticky připojí technické informace o účtu, typu přístupu a platnosti.
            </span>
          </span>
        </label>
        <label class="block mt-3">
          <span class="block text-sm font-medium text-gray-700 mb-1">Text e-mailu</span>
          <textarea
            name="welcomeMessage"
            rows={6}
            class="w-full rounded border px-3 py-2 text-sm"
          >
            {values?.welcomeMessage ?? DEFAULT_WELCOME_MESSAGE}
          </textarea>
        </label>
      </fieldset>
      <div class="flex items-center gap-3 pt-2">
        <button type="submit" class="bg-gray-900 text-white px-4 py-2 rounded hover:bg-gray-700">
          Založit uživatele
        </button>
        <a href="/admin" class="text-sm text-gray-600 hover:underline">
          zrušit
        </a>
      </div>
    </form>
  </div>
);

// All admin routes require admin role
admin.use("/admin/*", requireAdmin);

// Admin dashboard
admin.get("/admin", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);

  const [userCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(user);
  const [purchaseCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(purchase);
  // Rozpad pro karty: zaplacené = active a kind='paid', granty = kind='comp',
  // pending = čekající na FIO/Stripe. Staff řádky (kind='staff') jsou audit
  // přístupu administrátorů a do business statistik nepatří.
  const [purchasePaidCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(purchase)
    .where(and(eq(purchase.status, "active"), eq(purchase.kind, "paid")));
  const [purchaseGrantCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(purchase)
    .where(and(eq(purchase.status, "active"), eq(purchase.kind, "comp")));
  const [purchasePendingCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(purchase)
    .where(eq(purchase.status, "pending"));

  // Skutečně zaplacené peníze: součet purchase.amountPaid přes kind='paid'
  // a status IN (active, expired). Pending a refunded vynecháváme.
  // amountPaid se plní při Stripe webhooku (amount_total / 100) a FIO match
  // (tx.amount). Historická data jsou backfillnuta na 1500 Kč (mig. 0014).
  const [revenueTotalRow] = await db
    .select({ sum: sql<number>`coalesce(sum(${purchase.amountPaid}), 0)` })
    .from(purchase)
    .where(
      and(
        eq(purchase.kind, "paid"),
        or(eq(purchase.status, "active"), eq(purchase.status, "expired")),
      ),
    );
  const [revenueActiveRow] = await db
    .select({ sum: sql<number>`coalesce(sum(${purchase.amountPaid}), 0)` })
    .from(purchase)
    .where(and(eq(purchase.kind, "paid"), eq(purchase.status, "active")));
  const totalRevenueCzk = Number(revenueTotalRow?.sum ?? 0);
  const revenueActiveCzk = Number(revenueActiveRow?.sum ?? 0);
  const formatCzk = (v: number) => `${v.toLocaleString("cs-CZ")} Kč`;
  const recentUsers = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt))
    .limit(10);

  // Pro každého recent usera dotáhni jeho nejnovější purchase (active i pending),
  // ať admin hned vidí "zaplatil / čeká / jen registrace zdarma".
  const recentUserEmails = recentUsers.map((u) => u.email.toLowerCase());
  const recentUserPurchases = recentUserEmails.length > 0
    ? await db
        .select({
          email: purchase.email,
          type: purchase.type,
          paymentMethod: purchase.paymentMethod,
          status: purchase.status,
          variableSymbol: purchase.variableSymbol,
          createdAt: purchase.createdAt,
          expiresAt: purchase.expiresAt,
          stripePaymentId: purchase.stripePaymentId,
          kind: purchase.kind,
        })
        .from(purchase)
        .where(inArray(purchase.email, recentUserEmails))
        .orderBy(desc(purchase.createdAt))
    : [];

  // Pro každý email vyber nejrelevantnější purchase — preferuj active > pending > expired.
  const purchaseByEmail = new Map<string, typeof recentUserPurchases[number]>();
  for (const p of recentUserPurchases) {
    const e = p.email.toLowerCase();
    const prev = purchaseByEmail.get(e);
    if (!prev) {
      purchaseByEmail.set(e, p);
      continue;
    }
    const rank = (s: string) => (s === "active" ? 3 : s === "pending" ? 2 : 1);
    if (rank(p.status) > rank(prev.status)) purchaseByEmail.set(e, p);
  }
  const orgs = await db.select().from(organization).orderBy(asc(organization.createdAt));
  const userCreated = c.req.query("userCreated");

  const lastFioScan = await readLastFioScan(c.env);
  const nowMs = Date.now();
  const fioCooldownRemainingMs = lastFioScan
    ? Math.max(0, FIO_SCAN_COOLDOWN_MS - (nowMs - lastFioScan.at))
    : 0;

  // I3: načíst emaily kupujících pro detekci domain mismatch
  const orgPurchases = await db
    .select({ email: purchase.email, createdAt: purchase.createdAt })
    .from(purchase)
    .where(
      and(
        eq(purchase.type, "organization"),
        or(eq(purchase.status, "pending"), eq(purchase.status, "active"))
      )
    )
    .orderBy(desc(purchase.createdAt));

  const buyerFor = (orgDomain: string, orgCreatedAt: Date): string | null => {
    const hit = orgPurchases.find((p) =>
      p.email.toLowerCase().endsWith(`@${orgDomain.toLowerCase()}`)
    );
    if (hit) return hit.email;
    const t = orgCreatedAt.getTime();
    return (
      orgPurchases
        .filter((p) => Math.abs(p.createdAt.getTime() - t) < 5 * 60 * 1000)
        .sort((a, b) => Math.abs(a.createdAt.getTime() - t) - Math.abs(b.createdAt.getTime() - t))[0]
        ?.email ?? null
    );
  };

  return c.html(
    <Layout title="Admin" user={currentUser}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold mb-6">Admin</h1>
        <AdminNav active="/admin" />
        {userCreated && (
          <div class="mb-6 rounded-lg border-2 border-green-300 bg-green-50 px-5 py-4 text-sm text-green-900 shadow">
            <div class="font-semibold mb-1">✓ Uživatel založen</div>
            {userCreated}. Přihlášení probíhá přes magic link na /login.
          </div>
        )}
        {c.req.query("invoiceFill") && (() => {
          const msg = c.req.query("invoiceFill") ?? "";
          const isError = /chyba|error/i.test(msg);
          return (
            <div
              class={`mb-6 rounded-lg border-2 px-5 py-4 text-sm shadow ${
                isError
                  ? "border-red-300 bg-red-50 text-red-900"
                  : "border-emerald-300 bg-emerald-50 text-emerald-900"
              }`}
            >
              <div class="font-semibold mb-1">
                {isError ? "✕ Dovystavení faktur" : "✓ Dovystavení faktur dokončeno"}
              </div>
              <code class="block whitespace-pre-wrap break-all text-xs font-mono">{msg}</code>
            </div>
          );
        })()}
        {c.req.query("fioScan") && (() => {
          const msg = c.req.query("fioScan") ?? "";
          const isError = /chyba|error|failed/i.test(msg);
          return (
            <div
              class={`mb-6 rounded-lg border-2 px-5 py-4 text-sm shadow ${
                isError
                  ? "border-red-300 bg-red-50 text-red-900"
                  : "border-blue-300 bg-blue-50 text-blue-900"
              }`}
            >
              <div class="font-semibold mb-1">
                {isError ? "✕ FIO scan selhal" : "↻ FIO scan dokončen"}
              </div>
              <code class="block whitespace-pre-wrap break-all text-xs font-mono">{msg}</code>
            </div>
          );
        })()}

        {/* Stats */}
        <div class="grid grid-cols-3 gap-4 mb-4">
          <div
            class="bg-white p-4 rounded-lg border"
            title="Všichni řádky v tabulce user — magic link signupy, admin granty i zaplacení uživatelé."
          >
            <p class="text-sm text-gray-500">Uživatelé</p>
            <p class="text-2xl font-bold">{userCount.count}</p>
            <p class="text-xs text-gray-500 mt-1">vč. registrací bez nákupu</p>
          </div>
          <div
            class="bg-white p-4 rounded-lg border"
            title="Součet purchase.amountPaid přes kind='paid' (Stripe amount_total/100, FIO tx.amount) ve stavu active+expired. Pending a refunded se nepočítají. Historická data před 19.5.2026 backfillnuta na 1500 Kč."
          >
            <p class="text-sm text-gray-500">Zaplaceno celkem</p>
            <p class="text-2xl font-bold text-emerald-700">{formatCzk(totalRevenueCzk)}</p>
            <p class="text-xs text-gray-500 mt-1">
              z toho aktivní <strong>{formatCzk(revenueActiveCzk)}</strong>
            </p>
            <p class="text-xs text-gray-400 mt-0.5">
              {purchasePaidCount.count + " "}
              aktivních ·{" "}
              <span title="Komplimentární přístupy (kind='comp') — nepočítají se do peněz">
                <strong class="text-indigo-700">{purchaseGrantCount.count}</strong> grant
              </span>
              {purchasePendingCount.count > 0 && (
                <> · <strong class="text-yellow-700">{purchasePendingCount.count}</strong> čeká</>
              )}
            </p>
          </div>
          <div class="bg-white p-4 rounded-lg border">
            <p class="text-sm text-gray-500">Organizace</p>
            <p class="text-2xl font-bold">{orgs.length}</p>
          </div>
        </div>

        {/* FIO manual scan — hx-boost="false" obchází htmx interceptor, jinak
           form submit projde jako AJAX a 303 redirect neproběhne čistě. */}
        <div class="mb-8 bg-white border rounded-lg p-4">
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 class="text-sm font-semibold text-gray-900">FIO sync plateb</h3>
              {lastFioScan ? (
                <p class="text-xs text-gray-500 mt-1">
                  Naposled {formatRelativeTime(lastFioScan.at, nowMs)} ·
                  <strong class="text-gray-700"> spárováno {lastFioScan.matched}</strong>,
                  nezískáno {lastFioScan.skipped}
                  {lastFioScan.errors.length > 0 && (
                    <span class="text-red-600"> · chyba: {lastFioScan.errors[0]}</span>
                  )}
                </p>
              ) : (
                <p class="text-xs text-gray-500 mt-1">
                  Nikdy nespuštěno ručně. Denně běží v 3:00 UTC.
                </p>
              )}
            </div>
            <form method="post" action="/admin/api/fio/scan" hx-boost="false">
              <button
                type="submit"
                id="fio-scan-btn"
                data-cooldown-ms={String(fioCooldownRemainingMs)}
                disabled={fioCooldownRemainingMs > 0}
                class="text-sm bg-gray-900 text-white px-4 py-2 rounded hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                title="Stáhne aktuální FIO transakce a spáruje s pending objednávkami. FIO rate limit 30 s, držíme 60 s cooldown."
              >
                {fioCooldownRemainingMs > 0 ? (
                  <>
                    Další scan za <span id="fio-cooldown">{Math.ceil(fioCooldownRemainingMs / 1000)}</span> s
                  </>
                ) : (
                  <>Spustit FIO scan</>
                )}
              </button>
            </form>
          </div>
          {/*
            Opravné akce nad Fakturoid fakturami jsou skryté — endpointy jsou
            stále funkční (popis v docs/fakturoid-integration.md), ale tlačítka
            už nepotřebujeme: nový flow vystavuje faktury přímo jako Zaplacené.
            Kdyby v budoucnu bylo třeba ad-hoc opravy, lze je zde dočasně
            zobrazit nebo zavolat curlem z terminálu admina.

            POST /admin/api/purchases/issue-missing-invoices
            POST /admin/api/purchases/mark-invoices-paid
            POST /admin/api/purchases/link-orphan-invoices
          */}
          {fioCooldownRemainingMs > 0 && (
            <script dangerouslySetInnerHTML={{ __html: `
              (function () {
                var btn = document.getElementById('fio-scan-btn');
                var counter = document.getElementById('fio-cooldown');
                if (!btn || !counter) return;
                var remaining = parseInt(btn.dataset.cooldownMs, 10);
                var endAt = Date.now() + remaining;
                var tick = function () {
                  var left = Math.max(0, endAt - Date.now());
                  if (left <= 0) {
                    btn.disabled = false;
                    btn.innerHTML = 'Spustit FIO scan';
                    return;
                  }
                  counter.textContent = String(Math.ceil(left / 1000));
                  setTimeout(tick, 500);
                };
                tick();
              })();
            `}} />
          )}
        </div>

        {/* Users */}
        <div id="users" class="flex items-center justify-between gap-4 mb-4">
          <h2 class="text-xl font-bold">Uživatelé</h2>
          <div class="flex items-center gap-2">
            <a href="/admin/users" class="text-sm text-indigo-600 hover:underline">
              všichni uživatelé →
            </a>
            <a href="/admin/users/new" class="text-sm bg-gray-900 text-white px-3 py-2 rounded hover:bg-gray-700">
              Přidat uživatele
            </a>
          </div>
        </div>
        <div class="bg-white rounded-lg border overflow-hidden mb-8">
          <table class="w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left">E-mail</th>
                <th class="px-4 py-2 text-left">Role</th>
                <th class="px-4 py-2 text-left">Stav objednávky</th>
                <th class="px-4 py-2 text-left">Detail</th>
                <th class="px-4 py-2 text-left">Vytvořen</th>
              </tr>
            </thead>
            <tbody>
              {recentUsers.map((u) => {
                const p = purchaseByEmail.get(u.email.toLowerCase());
                let statusBadge: { label: string; cls: string; detail: string };
                if (!p) {
                  statusBadge = {
                    label: "zdarma",
                    cls: "bg-gray-100 text-gray-700",
                    detail: "bez licence (magic link nebo grant zdarma)",
                  };
                } else if (p.status === "pending" && p.paymentMethod === "fio") {
                  statusBadge = {
                    label: "čekáme na FIO",
                    cls: "bg-yellow-100 text-yellow-800",
                    detail: `VS ${p.variableSymbol ?? "—"} · ${p.type === "organization" ? "firemní" : "soukromá"}`,
                  };
                } else if (p.status === "active") {
                  const isTestStripe = p.stripePaymentId?.startsWith("cs_test_");
                  const isGrant = p.kind === "comp" || p.kind === "staff";
                  let detail = `${p.type === "organization" ? "firemní" : "soukromá"} do ${p.expiresAt.toLocaleDateString("cs-CZ")}`;
                  if (isTestStripe) detail += " · ⚠ test mode";
                  else if (p.kind === "staff") detail += " · staff (admin)";
                  else if (p.kind === "comp") detail += " · grant od admina";
                  else if (p.paymentMethod === "stripe") detail += " · Stripe";
                  else if (p.paymentMethod === "fio") detail += " · FIO";
                  statusBadge = isGrant
                    ? {
                        label: "zdarma (grant)",
                        cls: "bg-indigo-100 text-indigo-800",
                        detail,
                      }
                    : {
                        label: "zaplaceno",
                        cls: "bg-emerald-100 text-emerald-800",
                        detail,
                      };
                } else {
                  statusBadge = {
                    label: p.status,
                    cls: "bg-red-100 text-red-700",
                    detail: p.paymentMethod,
                  };
                }
                return (
                  <tr class="border-t">
                    <td class="px-4 py-2 font-medium">
                      <a href={`/admin/users/${u.id}`} class="text-indigo-600 hover:underline no-underline">
                        {u.email}
                      </a>
                      {u.name && <span class="block text-xs text-gray-500">{u.name}</span>}
                    </td>
                    <td class="px-4 py-2">
                      <span class={`px-2 py-1 rounded-full text-xs font-medium ${
                        u.role === "admin"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-700"
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td class="px-4 py-2">
                      <span class={`px-2 py-1 rounded-full text-xs font-medium ${statusBadge.cls}`}>
                        {statusBadge.label}
                      </span>
                    </td>
                    <td class="px-4 py-2 text-xs text-gray-600">{statusBadge.detail}</td>
                    <td class="px-4 py-2 text-gray-500">
                      {u.createdAt.toLocaleDateString("cs-CZ")}
                    </td>
                  </tr>
                );
              })}
              {recentUsers.length === 0 && (
                <tr>
                  <td colspan={5} class="px-4 py-4 text-gray-500 text-center">
                    Zatím žádní uživatelé
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Organizations */}
        <h2 class="text-xl font-bold mb-4">Organizace</h2>
        <div class="bg-white rounded-lg border overflow-hidden mb-8">
          <table class="w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left">Doména</th>
                <th class="px-4 py-2 text-left">Kupující</th>
                <th class="px-4 py-2 text-left">Status</th>
                <th class="px-4 py-2 text-left">Akce</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => {
                const buyer = buyerFor(org.domain, org.createdAt);
                const buyerDomain = buyer?.split("@")[1]?.toLowerCase();
                const mismatch = !!buyer && buyerDomain !== org.domain.toLowerCase();
                return (
                  <tr class="border-t" id={`org-${org.id}`}>
                    <td class="px-4 py-2 font-medium">{org.domain}</td>
                    <td class="px-4 py-2">
                      {buyer ? (
                        <span class={mismatch ? "text-yellow-700" : "text-gray-600"}>
                          {mismatch && <span title="Email kupujícího neodpovídá doméně licence">⚠ </span>}
                          {buyer}
                        </span>
                      ) : (
                        <span class="text-gray-400 italic">neznámý</span>
                      )}
                    </td>
                    <td class="px-4 py-2">
                      <span
                        class={`px-2 py-1 rounded-full text-xs font-medium ${
                          org.status === "active"
                            ? "bg-green-100 text-green-700"
                            : org.status === "pending"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-700"
                        }`}
                      >
                        {org.status}
                      </span>
                    </td>
                    <td class="px-4 py-2">
                      {org.status === "pending" && (
                        <button
                          hx-post={`/admin/api/organizations/${org.id}/approve`}
                          hx-target={`#org-${org.id}`}
                          hx-swap="outerHTML"
                          class="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                        >
                          Schválit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {orgs.length === 0 && (
                <tr>
                  <td colspan={4} class="px-4 py-4 text-gray-500 text-center">
                    Zatím žádné organizace
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Quick links */}
        <div class="flex gap-4">
          <a href="/admin/courses" class="text-blue-600 hover:underline">
            Správa kurzů
          </a>
        </div>
      </div>
    </Layout>
  );
});

admin.get("/admin/stats", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);

  const buyerRow = (await db.get(sql`
    SELECT
      (SELECT count(*) FROM purchase WHERE kind='paid') AS paidCount,
      (SELECT coalesce(sum(amountPaid),0) FROM purchase WHERE kind='paid') AS revenue,
      (SELECT count(*) FROM purchase WHERE kind='paid' AND status='active' AND paymentMethod='stripe') AS stripeActive,
      (SELECT count(*) FROM purchase WHERE kind='paid' AND status='active' AND paymentMethod='fio') AS fioActive,
      (SELECT count(*) FROM purchase WHERE kind='paid' AND companyIco IS NOT NULL AND companyIco<>'') AS withIco,
      (SELECT count(*) FROM user) AS accounts,
      (SELECT count(*) FROM purchase WHERE kind='paid' AND status='active' AND userId IS NULL) AS noAccount,
      (SELECT count(*) FROM (SELECT DISTINCT p.userId FROM purchase p WHERE p.kind='paid' AND p.status='active' AND p.userId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM progress pr WHERE pr.userId=p.userId AND pr.completed=1))) AS notStarted
  `)) as {
    paidCount: number; revenue: number; stripeActive: number; fioActive: number;
    withIco: number; accounts: number; noAccount: number; notStarted: number;
  } | undefined;

  const funnelRows = (await db.all(sql`
    SELECT l.title AS title, l.durationSeconds AS durationSeconds,
      (SELECT count(*) FROM progress pr WHERE pr.lessonId=l.id AND pr.completed=1) AS completions
    FROM lesson l INNER JOIN module m ON l.moduleId=m.id
    ORDER BY m.sortOrder, l.sortOrder
  `)) as Array<{ title: string; durationSeconds: number; completions: number }>;

  const videoRows = (await db.all(sql`
    SELECT l.title AS title,
      coalesce(vs.views,0) AS views,
      coalesce(vs.watchTimeSeconds,0) AS watchTimeSeconds,
      coalesce(vs.engagementScore,0) AS engagementScore,
      (SELECT count(*) FROM progress pr WHERE pr.lessonId=l.id AND pr.completed=1) AS completions
    FROM lesson l
    INNER JOIN module m ON l.moduleId=m.id
    LEFT JOIN video_stats vs ON vs.videoGuid = l.bunnyVideoId
    WHERE l.bunnyVideoId IS NOT NULL
    ORDER BY m.sortOrder, l.sortOrder
  `)) as Array<{ title: string; views: number; watchTimeSeconds: number; engagementScore: number; completions: number }>;

  const syncRow = (await db.get(sql`SELECT max(syncedAt) AS lastSync FROM video_stats`)) as
    | { lastSync: number | null }
    | undefined;

  return c.html(
    <AdminStatsPage
      user={currentUser}
      lastSync={syncRow?.lastSync ?? null}
      data={{
        buyers: {
          paidCount: Number(buyerRow?.paidCount ?? 0),
          revenueCzk: Number(buyerRow?.revenue ?? 0),
          stripeActive: Number(buyerRow?.stripeActive ?? 0),
          fioActive: Number(buyerRow?.fioActive ?? 0),
          withIco: Number(buyerRow?.withIco ?? 0),
          accounts: Number(buyerRow?.accounts ?? 0),
          noAccount: Number(buyerRow?.noAccount ?? 0),
          notStarted: Number(buyerRow?.notStarted ?? 0),
        },
        funnel: funnelRows.map((r) => ({
          title: r.title,
          durationSeconds: Number(r.durationSeconds),
          completions: Number(r.completions),
        })),
        videos: videoRows.map((r) => ({
          title: r.title,
          views: Number(r.views),
          watchTimeSeconds: Number(r.watchTimeSeconds),
          engagementScore: Number(r.engagementScore),
          completions: Number(r.completions),
          syncedAt: null,
        })),
      }}
    />,
  );
});

admin.get("/admin/users/new", async (c) => {
  const currentUser = c.get("user")!;
  return c.html(
    <Layout title="Nový uživatel" user={currentUser}>
      <AdminUserForm />
    </Layout>
  );
});

admin.post("/admin/users/new", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const emails = String(body.emails ?? body.email ?? "");
  const name = String(body.name ?? "");
  const role = String(body.role ?? "user");
  const access = String(body.access ?? "individual");
  const accessExpiresOn = String(body.accessExpiresOn ?? "");
  const sendWelcomeEmail = body.sendWelcomeEmail === "on";
  const welcomeMessage = String(body.welcomeMessage ?? "").trim();

  try {
    const expiresAt = parseAdminGrantExpiresAt(accessExpiresOn);
    const result = await createAdminUsers(db, {
      emails, name, role, access, expiresAt,
      grantedBy: currentUser.email,
    });
    if (result.errors.length > 0) {
      const failed = result.errors.map((e) => `${e.email}: ${e.message}`).join("; ");
      throw new Error(`${result.created.length} založeno, ${result.errors.length} se nepodařilo: ${failed}`);
    }

    if (sendWelcomeEmail && welcomeMessage && result.created.length > 0) {
      const access2 = (["free", "individual", "organization"].includes(access)
        ? access
        : "individual") as "free" | "individual" | "organization";
      const expiryForEmail = access2 === "free" ? null : expiresAt;
      for (const u of result.created) {
        c.executionCtx.waitUntil(
          sendEmail(c.env, {
            from: "Patrick Zandl <patrick@vibecoding.cz>",
            replyTo: "patrick@vibecoding.cz",
            to: u.email,
            subject: "Tvůj účet na kurzy.vibecoding.cz",
            html: adminWelcomeUserHtml({
              personalMessage: welcomeMessage,
              email: u.email,
              access: access2,
              expiresAt: expiryForEmail,
              loginUrl: `${c.env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(u.email)}`,
            }),
          })
        );
      }
    }

    const label = result.created.length === 1
      ? result.created[0].email
      : `${result.created.length} uživatelů`;
    return c.redirect(`/admin?userCreated=${encodeURIComponent(label)}`);
  } catch (err) {
    const message = (err as Error).message || "Uživatele se nepodařilo založit.";
    return c.html(
      <Layout title="Nový uživatel" user={currentUser}>
        <AdminUserForm
          error={message}
          values={{
            emails: emails.trim(),
            name: name.trim(),
            role,
            access,
            accessExpiresOn,
            sendWelcomeEmail,
            welcomeMessage,
          }}
        />
      </Layout>,
      400
    );
  }
});

// ─── Users CRUD ───────────────────────────────────────────────────

const USER_PAGE_SIZE = 50;
const FLASH_MESSAGES: Record<string, { kind: "ok" | "err"; text: string }> = {
  saved: { kind: "ok", text: "Změny uloženy." },
  deleted: { kind: "ok", text: "Uživatel smazán." },
  granted: { kind: "ok", text: "Přístup přidán." },
  revoked: { kind: "ok", text: "Přístup odebrán." },
  extended: { kind: "ok", text: "Platnost přístupu upravena." },
};

function flashFromQuery(c: { req: { query: (k: string) => string | undefined } }) {
  const ok = c.req.query("ok");
  if (ok && FLASH_MESSAGES[ok]) return FLASH_MESSAGES[ok];
  const err = c.req.query("err");
  if (err) return { kind: "err" as const, text: err };
  return undefined;
}

admin.get("/admin/users", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);
  const search = (c.req.query("q") ?? "").trim();
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const offset = (page - 1) * USER_PAGE_SIZE;
  const { rows, total } = await listAdminUsers(db, { search, limit: USER_PAGE_SIZE, offset });

  return c.html(
    <Layout title="Uživatelé" user={currentUser}>
      <AdminUsersList
        rows={rows}
        total={total}
        search={search}
        page={page}
        pageSize={USER_PAGE_SIZE}
        flash={flashFromQuery(c)}
      />
    </Layout>
  );
});

admin.get("/admin/users/:id", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);
  const detail = await getAdminUserDetail(db, c.req.param("id"));
  if (!detail) return c.text("Not found", 404);
  return c.html(
    <Layout title={detail.email} user={currentUser}>
      <AdminUserDetailView
        user={detail}
        flash={flashFromQuery(c)}
        defaultExpiresOn={defaultAdminGrantExpiresOn()}
        currentUserId={currentUser.id}
      />
    </Layout>
  );
});

admin.post("/admin/users/:id/edit", async (c) => {
  const currentUser = c.get("user")!;
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const name = String(body.name ?? "");
  const role = String(body.role ?? "user");

  try {
    // Nelze měnit vlastní roli — chrání před locked-out adminem.
    const roleToSet = id === currentUser.id ? undefined : role;
    await updateAdminUser(db, id, { name, role: roleToSet });
    return c.redirect(`/admin/users/${id}?ok=saved`);
  } catch (err) {
    const message = encodeURIComponent((err as Error).message || "Změny se nepodařilo uložit.");
    return c.redirect(`/admin/users/${id}?err=${message}`);
  }
});

admin.post("/admin/users/:id/delete", async (c) => {
  const currentUser = c.get("user")!;
  const id = c.req.param("id");
  if (id === currentUser.id) {
    return c.redirect(`/admin/users/${id}?err=${encodeURIComponent("Vlastní účet nelze smazat.")}`);
  }
  const db = drizzle(c.env.DB);
  try {
    await deleteAdminUser(db, id);
    return c.redirect("/admin/users?ok=deleted");
  } catch (err) {
    const message = encodeURIComponent((err as Error).message || "Uživatele se nepodařilo smazat.");
    return c.redirect(`/admin/users/${id}?err=${message}`);
  }
});

admin.post("/admin/users/:id/purchases/new", async (c) => {
  const currentUser = c.get("user")!;
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const access = String(body.access ?? "individual");
  const expiresOn = String(body.expiresOn ?? "");
  const compReason = String(body.compReason ?? "").trim() || null;

  if (access !== "individual" && access !== "organization") {
    return c.redirect(`/admin/users/${id}?err=${encodeURIComponent("Neplatný typ přístupu.")}`);
  }

  try {
    const expiresAt = parseAdminGrantExpiresAt(expiresOn);
    await grantAdminAccess(db, {
      userId: id, access, expiresAt,
      grantedBy: currentUser.email,
      compReason,
    });
    return c.redirect(`/admin/users/${id}?ok=granted`);
  } catch (err) {
    const message = encodeURIComponent((err as Error).message || "Grant se nepodařilo přidat.");
    return c.redirect(`/admin/users/${id}?err=${message}`);
  }
});

admin.post("/admin/users/:id/purchases/:purchaseId/revoke", async (c) => {
  const id = c.req.param("id");
  const purchaseId = parseInt(c.req.param("purchaseId"), 10);
  const db = drizzle(c.env.DB);
  try {
    await revokeAdminPurchase(db, { userId: id, purchaseId });
    return c.redirect(`/admin/users/${id}?ok=revoked`);
  } catch (err) {
    const message = encodeURIComponent((err as Error).message || "Přístup se nepodařilo odebrat.");
    return c.redirect(`/admin/users/${id}?err=${message}`);
  }
});

admin.post("/admin/users/:id/purchases/:purchaseId/extend", async (c) => {
  const id = c.req.param("id");
  const purchaseId = parseInt(c.req.param("purchaseId"), 10);
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const expiresOn = String(body.expiresOn ?? "");
  try {
    const expiresAt = parseAdminGrantExpiresAt(expiresOn);
    await extendAdminPurchase(db, { userId: id, purchaseId, expiresAt });
    return c.redirect(`/admin/users/${id}?ok=extended`);
  } catch (err) {
    const message = encodeURIComponent((err as Error).message || "Platnost se nepodařilo upravit.");
    return c.redirect(`/admin/users/${id}?err=${message}`);
  }
});

// Approve organization (htmx)
admin.post("/admin/api/organizations/:id/approve", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);

  await db
    .update(organization)
    .set({ status: "active" })
    .where(eq(organization.id, id));

  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, id))
    .limit(1);

  if (!org) return c.text("Not found", 404);

  // Notify the most recent buyer on this domain that the license is active.
  const recentPurchases = await db
    .select({ email: purchase.email })
    .from(purchase)
    .where(
      and(
        eq(purchase.type, "organization"),
        or(eq(purchase.status, "pending"), eq(purchase.status, "active"))
      )
    )
    .orderBy(desc(purchase.createdAt))
    .limit(20);

  const buyerEmail = recentPurchases.find((r) =>
    r.email.toLowerCase().endsWith(`@${org.domain.toLowerCase()}`)
  )?.email;

  if (buyerEmail) {
    c.executionCtx.waitUntil(
      sendEmail(c.env, {
        to: buyerEmail,
        subject: `Firemní licence pro ${org.domain} aktivována`,
        html: organizationApprovedHtml(
          org.domain,
          `${c.env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(buyerEmail)}`
        ),
      })
    );
  }

  return c.html(
    <tr class="border-t" id={`org-${org.id}`}>
      <td class="px-4 py-2 font-medium">{org.domain}</td>
      <td class="px-4 py-2 text-gray-600">{buyerEmail ?? ""}</td>
      <td class="px-4 py-2">
        <span class="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
          active
        </span>
      </td>
      <td class="px-4 py-2"></td>
    </tr>
  );
});

// ─── Bunny API proxy ──────────────────────────────────────────────

admin.get("/admin/api/bunny/video/:videoId", async (c) => {
  const videoId = c.req.param("videoId");
  const libraryId = c.env.BUNNY_LIBRARY_ID;
  const apiKey = c.env.BUNNY_API_KEY;
  const url = `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`;
  const res = await fetch(url, { headers: { AccessKey: apiKey } });
  const body = await res.text();
  if (!res.ok) {
    return c.json({
      error: `Bunny vrátil ${res.status}`,
      detail: body,
      libraryId,
      url,
    }, 502);
  }
  const data = JSON.parse(body) as Record<string, unknown>;
  return c.json({
    title: data.title,
    length: data.length,
    chapters: data.chapters,
    moments: data.moments,
    thumbnailFileName: data.thumbnailFileName,
    status: data.status,
  });
});

// ─── FIO manual scan ─────────────────────────────────────────────

/**
 * Pro každý aktivní purchase BEZ fakturoidInvoiceId zkusí dohledat osiřelou
 * fakturu ve Fakturoidu: najde subject podle e-mailu, projde jeho faktury,
 * vybere nejnovější s odpovídající částkou. Pokud najde, naváže fakturu do DB
 * a označí ji jako zaplacenou. Důvod: dřívější verze scanFioPayments dělala
 * fire-and-forget volání Fakturoidu, takže worker zabil promise než stihl
 * uložit fakturoidInvoiceId, ačkoli Fakturoid fakturu vytvořil.
 */
admin.post("/admin/api/purchases/link-orphan-invoices", async (c) => {
  const db = drizzle(c.env.DB);
  const candidates = await db
    .select()
    .from(purchase)
    .where(
      and(
        eq(purchase.status, "active"),
        // fakturoidInvoiceId IS NULL
      ),
    );

  let linked = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Načti aktuální ceny pro výpočet expected amountu u FIO purchases.
  const cfgRows = await db.select().from(siteConfig);
  const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
  const priceIndividual = parseInt(cfg.price_individual ?? "2000", 10);
  const priceOrganization = parseInt(cfg.price_organization ?? "15000", 10);

  for (const p of candidates) {
    if (p.fakturoidInvoiceId) { skipped++; continue; }
    // Granty (comp/staff) nejsou reálné platby — žádná faktura.
    if (p.kind !== "paid") { skipped++; continue; }

    // Vypočítej, kolik měli zaplatit (pro match v Fakturoid invoices).
    const fullPrice = p.type === "organization" ? priceOrganization : priceIndividual;
    const discountFactor = (100 - (p.discountPercent ?? 0)) / 100;
    const expectedAmount = Math.floor(fullPrice * discountFactor);

    const subject = await findSubjectByEmail(c.env, p.email);
    if (!subject) { skipped++; continue; }

    const invoices = await listSubjectInvoices(c.env, subject.id);
    if (invoices.length === 0) { skipped++; continue; }

    // Vyber nejnovější fakturu s přesně odpovídající celkovou částkou.
    const match = invoices.find((inv) => Math.round(inv.total) === expectedAmount);
    if (!match) {
      errors.push(`${p.email}: žádná faktura subjektu nemá total = ${expectedAmount} Kč`);
      continue;
    }

    try {
      await db
        .update(purchase)
        .set({ fakturoidInvoiceId: match.id, fakturoidSubjectId: subject.id })
        .where(eq(purchase.id, p.id));

      if (match.status !== "paid") {
        const result = await markInvoicePaid(c.env, match.id, expectedAmount);
        if (!result.ok) {
          errors.push(`${p.email}: linked ale mark_paid: ${result.error}`);
        }
      }
      linked++;
    } catch (err) {
      errors.push(`${p.email}: ${(err as Error).message}`);
    }
  }

  const summary = `Navázáno: ${linked}, přeskočeno: ${skipped}` +
    (errors.length > 0 ? `, chyby: ${errors.slice(0, 5).join(" | ")}` : "");
  return c.redirect(`/admin?invoiceFill=${encodeURIComponent(summary)}`);
});

/**
 * Projde všechny purchase rows s fakturoidInvoiceId a u každé faktury ve stavu
 * Vystavená/Odeslaná označí platbu — tj. udělá z nich Zaplacenou. Slouží k
 * jednorázové opravě faktur, které zůstaly v částečném stavu kvůli selhání
 * předchozí verze createPaidInvoice (mark_as_sent / payments.json).
 */
admin.post("/admin/api/purchases/mark-invoices-paid", async (c) => {
  const db = drizzle(c.env.DB);
  const candidates = await db
    .select()
    .from(purchase)
    .where(eq(purchase.status, "active"));

  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" });
  let marked = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const p of candidates) {
    if (!p.fakturoidInvoiceId) { skipped++; continue; }

    const invoice = await fetchInvoice(c.env, p.fakturoidInvoiceId);
    if (!invoice) {
      errors.push(`${p.email}: fakturu ${p.fakturoidInvoiceId} nelze načíst`);
      continue;
    }
    if (invoice.status === "paid") { skipped++; continue; }

    // Najdi reálnou částku — pro Stripe ze session, jinak vypočítej z purchase.
    let amount: number | null = null;
    if (p.stripePaymentId && p.stripePaymentId.startsWith("cs_live_")) {
      try {
        const session = await stripe.checkout.sessions.retrieve(p.stripePaymentId);
        amount = session.amount_total ? Math.round(session.amount_total / 100) : null;
      } catch (err) {
        errors.push(`${p.email}: Stripe retrieve ${(err as Error).message}`);
        continue;
      }
    } else {
      // Fallback z line items na faktuře (Fakturoid uchovává unit_price).
      const lines = invoice.lines as Array<{ unit_price?: number }> | undefined;
      const firstPrice = lines?.[0]?.unit_price;
      if (typeof firstPrice === "number") amount = firstPrice;
    }

    if (!amount || amount <= 0) {
      errors.push(`${p.email}: nelze zjistit částku faktury`);
      continue;
    }

    const result = await markInvoicePaid(c.env, p.fakturoidInvoiceId, amount);
    if (result.ok) {
      marked++;
    } else {
      errors.push(`${p.email}: ${result.error}`);
    }
  }

  const summary = `Označeno jako zaplacených: ${marked}, přeskočeno: ${skipped}` +
    (errors.length > 0 ? `, chyby: ${errors.slice(0, 5).join(" | ")}` : "");
  return c.redirect(`/admin?invoiceFill=${encodeURIComponent(summary)}`);
});

/**
 * Jednorázové dovystavení Fakturoid faktur pro Stripe nákupy, které byly
 * provedeny před spuštěním integrace (fakturoidInvoiceId IS NULL). Stáhne
 * `amount_total` ze Stripe checkout session API, vystaví fakturu a aktualizuje
 * purchase. Bezpečný k opakovaným během — pokud purchase už invoice má,
 * přeskočí ji.
 */
admin.post("/admin/api/purchases/issue-missing-invoices", async (c) => {
  const db = drizzle(c.env.DB);
  const candidates = await db
    .select()
    .from(purchase)
    .where(eq(purchase.status, "active"));

  // Pro FIO purchases potřebujeme aktuální ceny (Stripe má amount_total v session).
  const cfgRows = await db.select().from(siteConfig);
  const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
  const priceIndividual = parseInt(cfg.price_individual ?? "2000", 10);
  const priceOrganization = parseInt(cfg.price_organization ?? "15000", 10);

  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" });
  let issued = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const p of candidates) {
    if (p.fakturoidInvoiceId) { skipped++; continue; }
    // Granty (comp/staff): žádná reálná platba, faktura nedává smysl.
    if (p.kind !== "paid") { skipped++; continue; }

    // Zjisti reálnou částku.
    let amountCzk = 0;
    if (p.paymentMethod === "stripe" && p.stripePaymentId?.startsWith("cs_live_")) {
      try {
        const session = await stripe.checkout.sessions.retrieve(p.stripePaymentId);
        amountCzk = session.amount_total ? Math.round(session.amount_total / 100) : 0;
      } catch (err) {
        errors.push(`${p.email}: Stripe retrieve ${(err as Error).message}`);
        continue;
      }
    } else if (p.paymentMethod === "fio") {
      // FIO: dopočítej z aktuálních cen a discountPercent na purchase.
      const fullPrice = p.type === "organization" ? priceOrganization : priceIndividual;
      const discountFactor = (100 - (p.discountPercent ?? 0)) / 100;
      amountCzk = Math.floor(fullPrice * discountFactor);
    } else {
      skipped++;
      continue;
    }

    if (amountCzk <= 0) {
      errors.push(`${p.email}: nelze určit částku (paymentMethod=${p.paymentMethod})`);
      continue;
    }

    const domain = p.type === "organization" ? p.email.split("@")[1] : null;
    try {
      const res = await exportPurchaseInvoice(
        c.env,
        {
          email: p.email,
          type: p.type as "individual" | "organization",
          domain,
          amount: amountCzk,
          variableSymbol: p.variableSymbol,
        },
        { sendEmail: true },
      );
      if (res.ok && res.invoiceId) {
        await db
          .update(purchase)
          .set({
            fakturoidInvoiceId: res.invoiceId,
            fakturoidSubjectId: res.subjectId ?? null,
          })
          .where(eq(purchase.id, p.id));
        issued++;
      } else {
        errors.push(`${p.email}: ${res.error ?? "neznámá chyba"}`);
      }
    } catch (err) {
      errors.push(`${p.email}: ${(err as Error).message}`);
    }
  }

  const summary = `Dovystaveno faktur: ${issued}, přeskočeno: ${skipped}` +
    (errors.length > 0 ? `, chyby: ${errors.slice(0, 5).join(" | ")}` : "");
  return c.redirect(`/admin?invoiceFill=${encodeURIComponent(summary)}`);
});

// Diagnostické volání FIO API — zkusí 3 varianty a vrátí, co každá vrátila.
// Pomáhá rozlišit: invalid token (FIO 500 prázdné body), token bez oprávnění,
// rate limit (409), rozsah dat (různá odpověď podle from/to), apod.
admin.get("/admin/api/fio/diagnose", async (c) => {
  const token = c.env.FIO_API_TOKEN;
  if (!token || token.length < 10) {
    return c.json({ error: "FIO_API_TOKEN nenastaven nebo příliš krátký", tokenLength: token?.length ?? 0 });
  }

  const tokenHint = `${token.slice(0, 4)}...${token.slice(-4)} (délka ${token.length})`;
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
  const twentyEightAgo = new Date(Date.now() - 28 * 86400 * 1000).toISOString().slice(0, 10);

  async function tryEndpoint(name: string, path: string) {
    try {
      const res = await fetch(`https://fioapi.fio.cz${path}`);
      const body = await res.text().catch(() => "");
      return {
        name,
        url: path,
        status: res.status,
        ok: res.ok,
        bodyHead: body.slice(0, 600),
        bodyLength: body.length,
      };
    } catch (err) {
      return { name, url: path, error: (err as Error).message };
    }
  }

  const last = await tryEndpoint("last", `/v1/rest/last/${token}/transactions.json`);
  // FIO rate-limituje 1/min, mezi voláními počkáme — ale 3 volání během několika sekund
  // často FIO toleruje. Pokud uvidíme 409, víme co to znamená.
  await new Promise((r) => setTimeout(r, 1000));
  const week = await tryEndpoint("periods 7d", `/v1/rest/periods/${token}/${weekAgo}/${today}/transactions.json`);
  await new Promise((r) => setTimeout(r, 1000));
  const month = await tryEndpoint("periods 28d", `/v1/rest/periods/${token}/${twentyEightAgo}/${today}/transactions.json`);

  return c.json({ tokenHint, tests: [last, week, month] }, 200, { "Cache-Control": "no-store" });
});

const FIO_SCAN_COOLDOWN_MS = 60 * 1000; // FIO API rate limit ~30s, držíme 60s buffer.
const FIO_SCAN_KV_KEY = "fio:lastScan";

type FioScanRecord = {
  at: number;
  matched: number;
  skipped: number;
  errors: string[];
};

/** „před 12 s" / „před 4 min" / „před 2 h" / „19. 5. 11:23". */
function formatRelativeTime(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `před ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `před ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `před ${hr} h`;
  return new Date(at).toLocaleString("cs-CZ", {
    day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

async function readLastFioScan(env: Env): Promise<FioScanRecord | null> {
  const raw = await env.KV.get(FIO_SCAN_KV_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FioScanRecord;
  } catch {
    return null;
  }
}

admin.post("/admin/api/fio/scan", async (c) => {
  const last = await readLastFioScan(c.env);
  const now = Date.now();
  if (last && now - last.at < FIO_SCAN_COOLDOWN_MS) {
    const remaining = Math.ceil((FIO_SCAN_COOLDOWN_MS - (now - last.at)) / 1000);
    return c.redirect(
      `/admin?fioScan=${encodeURIComponent(`Počkej ${remaining} s — FIO API má rate limit 30 s. Naposled spuštěno před ${Math.ceil((now - last.at) / 1000)} s.`)}`,
    );
  }

  try {
    const db = drizzle(c.env.DB);
    const result = await scanFioPayments(db, c.env);
    // Ulož stav do KV pro UI display + cooldown gating.
    const record: FioScanRecord = {
      at: Date.now(),
      matched: result.matched,
      skipped: result.skipped,
      errors: result.errors,
    };
    await c.env.KV.put(FIO_SCAN_KV_KEY, JSON.stringify(record), { expirationTtl: 7 * 86400 });

    const summary = `spárováno ${result.matched}, nezískáno ${result.skipped}` +
      (result.errors.length ? `, chyby: ${result.errors.join(" | ")}` : "");
    return c.redirect(`/admin?fioScan=${encodeURIComponent(summary)}`);
  } catch (err) {
    return c.redirect(`/admin?fioScan=${encodeURIComponent("chyba: " + (err as Error).message)}`);
  }
});

// ─── Transcribe AI ────────────────────────────────────────────────

admin.post("/admin/api/lessons/:id/transcribe", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [row] = await db
    .select({
      id: lesson.id,
      bunnyVideoId: lesson.bunnyVideoId,
      moduleId: lesson.moduleId,
    })
    .from(lesson)
    .where(eq(lesson.id, id))
    .limit(1);
  if (!row) return c.text("Not found", 404);
  if (!row.bunnyVideoId) {
    return c.json({ error: "Lekce nemá přiřazené Bunny video." }, 400);
  }

  try {
    await triggerTranscribe(c.env, row.bunnyVideoId, { sourceLanguage: "cs", force: true });
    await db
      .update(lesson)
      .set({ transcribeStatus: "pending", transcribedAt: null, transcribeError: null })
      .where(eq(lesson.id, id));
    return c.redirect(`/admin/lessons/${id}/edit#transkripce`);
  } catch (err) {
    const message = (err as Error).message || "Transkripci se nepodařilo spustit.";
    await db
      .update(lesson)
      .set({ transcribeStatus: "error", transcribeError: message.slice(0, 1000) })
      .where(eq(lesson.id, id));
    return c.html(
      <Layout title="Transkripce selhala" user={c.get("user")!}>
        <div class="max-w-2xl mx-auto px-4 py-8">
          <h1 class="text-2xl font-bold mb-4">Transkripci se nepodařilo spustit</h1>
          <p class="text-red-700 mb-4">{message}</p>
          <a href={`/admin/lessons/${id}/edit`} class="text-indigo-600 hover:underline">
            ← Zpět na lekci
          </a>
        </div>
      </Layout>,
      502,
    );
  }
});

admin.post("/admin/api/lessons/:id/transcribe/refresh", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [row] = await db
    .select({ id: lesson.id, bunnyVideoId: lesson.bunnyVideoId })
    .from(lesson)
    .where(eq(lesson.id, id))
    .limit(1);
  if (!row) return c.text("Not found", 404);
  if (!row.bunnyVideoId) {
    return c.json({ error: "Lekce nemá přiřazené Bunny video." }, 400);
  }

  try {
    const video = await fetchBunnyVideo(c.env, row.bunnyVideoId);
    const captionsSummary = (video.captions ?? [])
      .map((c) => c.srclang)
      .join(",");
    const czechCaption = findCzechCaption(video);
    if (!czechCaption) {
      await db
        .update(lesson)
        .set({
          transcribeError: captionsSummary
            ? `Bunny zatím nemá český caption track. Dostupné jazyky: ${captionsSummary}`
            : "Bunny zatím nemá žádné caption tracky — transkripce stále probíhá.",
        })
        .where(eq(lesson.id, id));
      return c.redirect(`/admin/lessons/${id}/edit#transkripce`);
    }
    const result = await fetchCaptionVtt(c.env, row.bunnyVideoId, czechCaption.srclang);
    if (result.kind === "ok") {
      await db
        .update(lesson)
        .set({
          transcribeStatus: "done",
          transcribedAt: new Date(),
          transcript: vttToPlainText(result.vtt),
          transcribeError: null,
        })
        .where(eq(lesson.id, id));
    } else {
      const diag = result.kind === "no-pull-zone"
        ? "Captions u Bunny existují, ale BUNNY_PULL_ZONE secret není nastavený."
        : `Captions u Bunny existují (${captionsSummary}), ale CDN vrátil HTTP ${result.status} na ${result.url}. Soubor se možná teprve generuje, zkus za 5 minut. Pokud trvá déle, zkontroluj cestu k VTT.`;
      await db
        .update(lesson)
        .set({
          transcribeStatus: "done",
          transcribedAt: new Date(),
          transcript: null,
          transcribeError: diag,
        })
        .where(eq(lesson.id, id));
    }
    return c.redirect(`/admin/lessons/${id}/edit#transkripce`);
  } catch (err) {
    const message = (err as Error).message || "Stav se nepodařilo obnovit.";
    await db
      .update(lesson)
      .set({ transcribeStatus: "error", transcribeError: message.slice(0, 1000) })
      .where(eq(lesson.id, id));
    return c.html(
      <Layout title="Obnovení selhalo" user={c.get("user")!}>
        <div class="max-w-2xl mx-auto px-4 py-8">
          <h1 class="text-2xl font-bold mb-4">Obnovení stavu selhalo</h1>
          <p class="text-red-700 mb-4">{message}</p>
          <a href={`/admin/lessons/${id}/edit`} class="text-indigo-600 hover:underline">
            ← Zpět na lekci
          </a>
        </div>
      </Layout>,
      502,
    );
  }
});

// ─── Courses CRUD ─────────────────────────────────────────────────

admin.get("/admin/courses", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);
  const courses = await db.select().from(course).orderBy(asc(course.id));
  return c.html(
    <Layout title="Správa kurzů" user={currentUser}>
      <AdminCoursesList courses={courses} />
    </Layout>
  );
});

admin.get("/admin/courses/new", async (c) => {
  const currentUser = c.get("user")!;
  return c.html(
    <Layout title="Nový kurz" user={currentUser}>
      <AdminCourseForm />
    </Layout>
  );
});

admin.post("/admin/courses/new", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  const description = String(body.description ?? "").trim();
  const published = body.published === "on";

  const [created] = await db
    .insert(course)
    .values({ title, slug, description, published })
    .returning({ id: course.id });

  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/courses/${created.id}`);
});

admin.get("/admin/courses/:id", async (c) => {
  const currentUser = c.get("user")!;
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);

  const [courseRow] = await db
    .select()
    .from(course)
    .where(eq(course.id, id))
    .limit(1);
  if (!courseRow) return c.text("Not found", 404);

  const courseModules = await db
    .select()
    .from(module)
    .where(eq(module.courseId, id))
    .orderBy(asc(module.sortOrder));

  const modulesWithLessons = await Promise.all(
    courseModules.map(async (m) => {
      const lessons = await db
        .select()
        .from(lesson)
        .where(eq(lesson.moduleId, m.id))
        .orderBy(asc(lesson.sortOrder));
      return { ...m, lessons };
    })
  );

  return c.html(
    <Layout title={courseRow.title} user={currentUser}>
      <AdminCourseDetail course={courseRow} modules={modulesWithLessons} />
    </Layout>
  );
});

admin.get("/admin/courses/:id/edit", async (c) => {
  const currentUser = c.get("user")!;
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [courseRow] = await db
    .select()
    .from(course)
    .where(eq(course.id, id))
    .limit(1);
  if (!courseRow) return c.text("Not found", 404);
  return c.html(
    <Layout title="Upravit kurz" user={currentUser}>
      <AdminCourseForm course={courseRow} />
    </Layout>
  );
});

admin.post("/admin/courses/:id/edit", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  const description = String(body.description ?? "").trim();
  const published = body.published === "on";

  await db
    .update(course)
    .set({ title, slug, description, published })
    .where(eq(course.id, id));

  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/courses/${id}`);
});

admin.post("/admin/courses/:id/delete", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  await db.delete(course).where(eq(course.id, id));
  await c.env.KV.delete("cache:catalog");
  return c.redirect("/admin/courses");
});

// ─── Modules CRUD ─────────────────────────────────────────────────

admin.get("/admin/courses/:courseId/modules/new", async (c) => {
  const currentUser = c.get("user")!;
  const courseId = parseInt(c.req.param("courseId"), 10);
  return c.html(
    <Layout title="Nový modul" user={currentUser}>
      <AdminModuleForm courseId={courseId} />
    </Layout>
  );
});

admin.post("/admin/courses/:courseId/modules/new", async (c) => {
  const courseId = parseInt(c.req.param("courseId"), 10);
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  const sortOrder = parseInt(String(body.sortOrder ?? "0"), 10);

  await db.insert(module).values({ courseId, title, slug, sortOrder });
  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/courses/${courseId}`);
});

admin.get("/admin/courses/:courseId/modules/:moduleId/edit", async (c) => {
  const currentUser = c.get("user")!;
  const courseId = parseInt(c.req.param("courseId"), 10);
  const moduleId = parseInt(c.req.param("moduleId"), 10);
  const db = drizzle(c.env.DB);
  const [mod] = await db
    .select()
    .from(module)
    .where(eq(module.id, moduleId))
    .limit(1);
  if (!mod) return c.text("Not found", 404);
  return c.html(
    <Layout title="Upravit modul" user={currentUser}>
      <AdminModuleForm courseId={courseId} mod={mod} />
    </Layout>
  );
});

admin.post("/admin/courses/:courseId/modules/:moduleId/edit", async (c) => {
  const courseId = parseInt(c.req.param("courseId"), 10);
  const moduleId = parseInt(c.req.param("moduleId"), 10);
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  const sortOrder = parseInt(String(body.sortOrder ?? "0"), 10);

  await db
    .update(module)
    .set({ title, slug, sortOrder })
    .where(eq(module.id, moduleId));

  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/courses/${courseId}`);
});

admin.post(
  "/admin/courses/:courseId/modules/:moduleId/delete",
  async (c) => {
    const courseId = parseInt(c.req.param("courseId"), 10);
    const moduleId = parseInt(c.req.param("moduleId"), 10);
    const db = drizzle(c.env.DB);
    await db.delete(module).where(eq(module.id, moduleId));
    await c.env.KV.delete("cache:catalog");
    return c.redirect(`/admin/courses/${courseId}`);
  }
);

// ─── Lessons CRUD ─────────────────────────────────────────────────

admin.get(
  "/admin/courses/:courseId/modules/:moduleId/lessons/new",
  async (c) => {
    const currentUser = c.get("user")!;
    const courseId = parseInt(c.req.param("courseId"), 10);
    const moduleId = parseInt(c.req.param("moduleId"), 10);
    return c.html(
      <Layout title="Nová epizoda" user={currentUser}>
        <AdminLessonForm courseId={courseId} moduleId={moduleId} />
      </Layout>
    );
  }
);

admin.post(
  "/admin/courses/:courseId/modules/:moduleId/lessons/new",
  async (c) => {
    const courseId = parseInt(c.req.param("courseId"), 10);
    const moduleId = parseInt(c.req.param("moduleId"), 10);
    const db = drizzle(c.env.DB);
    const body = await c.req.parseBody();
    const title = String(body.title ?? "").trim();
    const slug = String(body.slug ?? "").trim();
    const bunnyVideoId = String(body.bunnyVideoId ?? "").trim() || null;
    const durationSeconds =
      parseInt(String(body.durationMinutes ?? "0"), 10) * 60 +
      parseInt(String(body.durationSecondsRem ?? "0"), 10);
    const sortOrder = parseInt(String(body.sortOrder ?? "0"), 10);
    const isFree = body.isFree === "on";
    const chapters = String(body.chaptersJson ?? "[]").trim() || "[]";
    const moments = String(body.momentsJson ?? "[]").trim() || "[]";
    const bodyMarkdown = String(body.bodyMarkdown ?? "").trim();

    await db.insert(lesson).values({
      moduleId,
      publicId: nanoid(8),
      title,
      slug,
      bunnyVideoId,
      durationSeconds,
      sortOrder,
      isFree,
      chapters,
      moments,
      bodyMarkdown,
    });

    await c.env.KV.delete("cache:catalog");
    return c.redirect(`/admin/courses/${courseId}`);
  }
);

admin.get("/admin/lessons/:id/edit", async (c) => {
  const currentUser = c.get("user")!;
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);

  const [row] = await db
    .select({ lesson: lesson, courseId: module.courseId })
    .from(lesson)
    .innerJoin(module, eq(lesson.moduleId, module.id))
    .where(eq(lesson.id, id))
    .limit(1);

  if (!row) return c.text("Not found", 404);

  const saved = c.req.query("saved") === "1";
  return c.html(
    <Layout title="Upravit epizodu" user={currentUser}>
      <AdminLessonForm
        courseId={row.courseId}
        moduleId={row.lesson.moduleId}
        lesson={row.lesson}
        saved={saved}
      />
    </Layout>
  );
});

admin.post("/admin/lessons/:id/edit", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);

  const [row] = await db
    .select({ courseId: module.courseId })
    .from(lesson)
    .innerJoin(module, eq(lesson.moduleId, module.id))
    .where(eq(lesson.id, id))
    .limit(1);

  if (!row) return c.text("Not found", 404);

  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  const bunnyVideoId = String(body.bunnyVideoId ?? "").trim() || null;
  const durationSeconds =
    parseInt(String(body.durationMinutes ?? "0"), 10) * 60 +
    parseInt(String(body.durationSecondsRem ?? "0"), 10);
  const sortOrder = parseInt(String(body.sortOrder ?? "0"), 10);
  const isFree = body.isFree === "on";
  const chapters = String(body.chaptersJson ?? "[]").trim() || "[]";
  const moments = String(body.momentsJson ?? "[]").trim() || "[]";
  const bodyMarkdown = String(body.bodyMarkdown ?? "").trim();

  await db
    .update(lesson)
    .set({ title, slug, bunnyVideoId, durationSeconds, sortOrder, isFree, chapters, moments, bodyMarkdown })
    .where(eq(lesson.id, id));

  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/lessons/${id}/edit?saved=1`);
});

admin.post("/admin/lessons/:id/delete", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);

  const [row] = await db
    .select({ courseId: module.courseId })
    .from(lesson)
    .innerJoin(module, eq(lesson.moduleId, module.id))
    .where(eq(lesson.id, id))
    .limit(1);

  if (!row) return c.text("Not found", 404);

  await db.delete(lesson).where(eq(lesson.id, id));
  await c.env.KV.delete("cache:catalog");
  return c.redirect(`/admin/courses/${row.courseId}`);
});

// ─── Settings ─────────────────────────────────────────────────────

async function loadSettings(db: ReturnType<typeof drizzle>) {
  const rows = await db.select().from(siteConfig);
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const codeExpiresRaw = cfg.discount_code_expires_at ?? "";
  const codeExpiresAt = codeExpiresRaw ? new Date(codeExpiresRaw) : null;
  return {
    priceIndividual: parseInt(cfg.price_individual ?? "2000", 10),
    priceOrganization: parseInt(cfg.price_organization ?? "15000", 10),
    benefitsIndividual: JSON.parse(cfg.benefits_individual ?? "[]") as string[],
    benefitsOrganization: JSON.parse(cfg.benefits_organization ?? "[]") as string[],
    discount: {
      active: cfg.discount_active === "true",
      percent: parseInt(cfg.discount_percent ?? "0", 10),
      limit: parseInt(cfg.discount_limit ?? "0", 10),
      code: cfg.discount_code ?? "",
      codeExpiresAt: codeExpiresAt && !Number.isNaN(codeExpiresAt.getTime()) ? codeExpiresAt : null,
      label: cfg.discount_label ?? "",
    },
  };
}

export async function loadDiscountSettings(db: ReturnType<typeof drizzle>) {
  const s = await loadSettings(db);
  return s.discount;
}

admin.get("/admin/settings", async (c) => {
  const currentUser = c.get("user")!;
  const db = drizzle(c.env.DB);
  const settings = await loadSettings(db);
  const slotsUsed = await countDiscountedActivePurchases(db);
  return c.html(
    <Layout title="Nastavení" user={currentUser}>
      <AdminSettingsForm {...settings} slotsUsed={slotsUsed} />
    </Layout>
  );
});

admin.post("/admin/settings", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.parseBody();

  const priceIndividual = Math.max(0, parseInt(String(body.price_individual ?? "2000"), 10));
  const priceOrganization = Math.max(0, parseInt(String(body.price_organization ?? "15000"), 10));
  const benefitsIndividual = String(body.benefits_individual ?? "[]");
  const benefitsOrganization = String(body.benefits_organization ?? "[]");

  const discountActive = body.discount_active === "on";
  const discountPercent = Math.max(0, Math.min(100, parseInt(String(body.discount_percent ?? "0"), 10) || 0));
  const discountLimit = Math.max(0, parseInt(String(body.discount_limit ?? "0"), 10) || 0);
  const discountCode = String(body.discount_code ?? "").trim();
  const discountCodeExpiresOn = String(body.discount_code_expires_on ?? "").trim();
  const discountCodeExpiresAt = discountCodeExpiresOn
    ? new Date(`${discountCodeExpiresOn}T23:59:59.999Z`)
    : null;
  const discountLabel = String(body.discount_label ?? "").trim();

  const updates: Array<[string, string]> = [
    ["price_individual", String(priceIndividual)],
    ["price_organization", String(priceOrganization)],
    ["benefits_individual", benefitsIndividual],
    ["benefits_organization", benefitsOrganization],
    ["discount_active", discountActive ? "true" : "false"],
    ["discount_percent", String(discountPercent)],
    ["discount_limit", String(discountLimit)],
    ["discount_code", discountCode],
    [
      "discount_code_expires_at",
      discountCodeExpiresAt && !Number.isNaN(discountCodeExpiresAt.getTime())
        ? discountCodeExpiresAt.toISOString()
        : "",
    ],
    ["discount_label", discountLabel],
  ];

  await Promise.all(
    updates.map(([key, value]) =>
      db
        .insert(siteConfig)
        .values({ key, value })
        .onConflictDoUpdate({ target: siteConfig.key, set: { value } }),
    ),
  );

  await c.env.KV.delete("cache:catalog");

  const currentUser = c.get("user")!;
  const settings = await loadSettings(db);
  const slotsUsed = await countDiscountedActivePurchases(db);
  return c.html(
    <Layout title="Nastavení" user={currentUser}>
      <AdminSettingsForm {...settings} slotsUsed={slotsUsed} saved />
    </Layout>
  );
});

export { admin as adminRoutes, loadSettings };
