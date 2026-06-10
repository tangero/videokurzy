import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, asc } from "drizzle-orm";
import type { Env, Variables } from "../types";
import { LandingPage } from "../views/landing";
import { course, module, lesson, siteConfig } from "../db/schema";
import { hasAccess } from "../lib/access";
import { PRICE_INDIVIDUAL, PRICE_ORGANIZATION } from "../config/payment";
import { getDiscountState } from "../lib/discount";

const landing = new Hono<{ Bindings: Env; Variables: Variables }>();

landing.get("/", async (c) => {
  const user = c.get("user");
  const db = drizzle(c.env.DB);

  const [firstCourse] = await db
    .select()
    .from(course)
    .where(eq(course.published, true))
    .limit(1);

  let modules: Array<{
    id: number;
    title: string;
    lessons: Array<{
      id: number;
      slug: string;
      title: string;
      durationSeconds: number;
      isFree: boolean;
      sortOrder: number;
    }>;
  }> = [];

  if (firstCourse) {
    const courseModules = await db
      .select()
      .from(module)
      .where(eq(module.courseId, firstCourse.id))
      .orderBy(asc(module.sortOrder));

    modules = await Promise.all(
      courseModules.map(async (m) => {
        const lessons = await db
          .select({
            id: lesson.id,
            slug: lesson.slug,
            title: lesson.title,
            durationSeconds: lesson.durationSeconds,
            isFree: lesson.isFree,
            sortOrder: lesson.sortOrder,
          })
          .from(lesson)
          .where(eq(lesson.moduleId, m.id))
          .orderBy(asc(lesson.sortOrder));
        return { ...m, lessons };
      })
    );
  }

  // Zjisti přístup přihlášeného uživatele (admin bypass je v hasAccess).
  const userHasAccess = user ? await hasAccess(user, db, c.env.KV) : false;

  // Načti ceny a výhody z DB, fallback na config hodnoty
  const configRows = await db.select().from(siteConfig);
  const cfg = Object.fromEntries(configRows.map((r) => [r.key, r.value]));
  const priceIndividual = parseInt(cfg.price_individual ?? String(PRICE_INDIVIDUAL), 10);
  const priceOrganization = parseInt(cfg.price_organization ?? String(PRICE_ORGANIZATION), 10);
  const benefitsIndividual = JSON.parse(
    cfg.benefits_individual ?? '["Přístup ke všem epizodám","Všechny budoucí kurzy v předplatném","Komentáře a Q&A s Patrickem","14 dní na vrácení, bez dotazů"]'
  ) as string[];
  const benefitsOrganization = JSON.parse(
    cfg.benefits_organization ?? '["Neomezený počet zaměstnanců","Přístup podle emailové domény","Faktura v CZK, standardní daňový doklad","Přehled využití pro L&D oddělení"]'
  ) as string[];

  const codeExpiresRaw = cfg.discount_code_expires_at ?? "";
  const codeExpiresAt = codeExpiresRaw ? new Date(codeExpiresRaw) : null;
  const discountSettings = {
    active: cfg.discount_active === "true",
    percent: parseInt(cfg.discount_percent ?? "0", 10),
    limit: parseInt(cfg.discount_limit ?? "0", 10),
    code: cfg.discount_code ?? "",
    codeExpiresAt: codeExpiresAt && !Number.isNaN(codeExpiresAt.getTime()) ? codeExpiresAt : null,
    label: cfg.discount_label ?? "",
  };
  const discountStage = await getDiscountState(db, discountSettings);

  return c.html(
    <LandingPage
      user={user}
      modules={modules}
      userHasAccess={userHasAccess}
      priceIndividual={priceIndividual}
      priceOrganization={priceOrganization}
      benefitsIndividual={benefitsIndividual}
      benefitsOrganization={benefitsOrganization}
      discount={discountStage}
    />
  );
});

export { landing as landingRoutes };
