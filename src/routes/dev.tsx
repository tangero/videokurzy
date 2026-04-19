import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { Env, Variables } from "../types";
import { purchase } from "../db/schema";
import { ACCESS_DURATION_DAYS } from "../config/payment";
import { sendEmail, purchaseConfirmedHtml } from "../lib/email";
import { Layout } from "../views/layout";

const devRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Guard: pouze když FIO_API_TOKEN === "dev". Nikdy neběhá v produkci. */
devRoutes.use("/dev/*", async (c, next) => {
  if (c.env.FIO_API_TOKEN !== "dev") {
    return c.text("Not available in production.", 404);
  }
  await next();
});

devRoutes.get("/dev/fio/pay/:vs", async (c) => {
  const vs = c.req.param("vs");
  const db = drizzle(c.env.DB);

  const rows = await db.select().from(purchase).where(eq(purchase.variableSymbol, vs)).limit(1);
  if (rows.length === 0) return c.text("Purchase not found.", 404);

  const p = rows[0];
  if (p.status !== "pending") return c.text(`Purchase already ${p.status}.`, 409);

  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + ACCESS_DURATION_DAYS * 86400 * 1000);
  await db
    .update(purchase)
    .set({ status: "active", expiresAt: newExpiresAt, fioTransactionId: `dev-${Date.now()}` })
    .where(eq(purchase.id, p.id));

  c.executionCtx.waitUntil(
    sendEmail(c.env, {
      to: p.email,
      subject: "Platba přijata — přihlaste se do kurzu (DEV)",
      html: purchaseConfirmedHtml(`${c.env.BETTER_AUTH_URL}/login?email=${encodeURIComponent(p.email)}`, p.type as "individual" | "organization"),
    })
  );

  return c.html(
    <Layout title="DEV mock — platba označena jako přijatá">
      <section class="max-w-md mx-auto px-4 py-16 text-center">
        <h1 class="text-2xl font-bold mb-4">[DEV] Platba přijata</h1>
        <p class="text-gray-600 mb-6">Purchase {vs} je nyní active. Přístup končí {newExpiresAt.toLocaleDateString("cs-CZ")}.</p>
        <a href={`/login?email=${encodeURIComponent(p.email)}`} class="inline-block bg-green-600 text-white px-6 py-3 rounded-lg">
          Přihlásit se
        </a>
      </section>
    </Layout>
  );
});

export { devRoutes };
