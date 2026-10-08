import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as authSchema from "../../src/db/auth-schema";
import * as identitySchema from "../../src/db/identity-schema";
import * as appSchema from "../../src/db/schema";
import {
  createAdminUser,
  createAdminUsers,
  listAdminUsers,
  anonymizeAndDeleteUser,
  transferPurchaseToEmail,
  manuallyConfirmPayment,
} from "../../src/lib/admin-users";
import { addUserEmail } from "../../src/lib/user-emails";

describe("createAdminUser", () => {
  let db: ReturnType<typeof drizzle>;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM user_emails");
    await env.DB.exec("DELETE FROM lesson_watch");
    await env.DB.exec("DELETE FROM lesson");
    await env.DB.exec("DELETE FROM module");
    await env.DB.exec("DELETE FROM course");
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM session");
    await env.DB.exec("DELETE FROM account");
    await env.DB.exec("DELETE FROM user");
    db = drizzle(env.DB, { schema: { ...authSchema, ...identitySchema, ...appSchema } });
  });

  it("creates a verified user with primary email record and a comp purchase", async () => {
    const created = await createAdminUser(db, {
      email: "  New.User@Example.cz ",
      name: "Nový Uživatel",
      role: "user",
      access: "individual",
      grantedBy: "patrick@vibecoding.cz",
      compReason: "Recenze",
    });

    expect(created.email).toBe("new.user@example.cz");
    expect(created.role).toBe("user");

    const userRow = await db
      .select()
      .from(authSchema.user)
      .where(eq(authSchema.user.id, created.id))
      .get();
    expect(userRow?.emailVerified).toBe(true);

    const emailRow = await db
      .select()
      .from(identitySchema.userEmails)
      .where(eq(identitySchema.userEmails.userId, created.id))
      .get();
    expect(emailRow?.email).toBe("new.user@example.cz");
    expect(emailRow?.isPrimary).toBe(true);

    const purchaseRow = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.userId, created.id))
      .get();
    expect(purchaseRow?.type).toBe("individual");
    expect(purchaseRow?.status).toBe("active");
    expect(purchaseRow?.kind).toBe("comp");
    expect(purchaseRow?.grantedBy).toBe("patrick@vibecoding.cz");
    expect(purchaseRow?.compReason).toBe("Recenze");
    // Granty nepoužívají Stripe namespace — nezamořují stripePaymentId UNIQUE index.
    expect(purchaseRow?.stripePaymentId).toBeNull();
  });

  it("skips purchase creation for admin role (access is granted via user.role)", async () => {
    const created = await createAdminUser(db, {
      email: "boss@example.cz",
      role: "admin",
      access: "individual",
    });

    expect(created.role).toBe("admin");

    const purchases = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.userId, created.id));
    expect(purchases).toEqual([]);
  });

  it("uses a 90 day default expiry for comp grants", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T08:00:00.000Z"));

    const created = await createAdminUser(db, {
      email: "trial@example.cz",
      role: "user",
      access: "individual",
    });

    const purchaseRow = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.userId, created.id))
      .get();
    expect(purchaseRow?.expiresAt.toISOString()).toBe("2026-08-15T08:00:00.000Z");
  });

  it("stores an explicit access expiry for comp grants", async () => {
    const created = await createAdminUser(db, {
      email: "expires@example.cz",
      role: "user",
      access: "organization",
      expiresAt: new Date("2026-09-30T23:59:59.000Z"),
    });

    const purchaseRow = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.userId, created.id))
      .get();
    expect(purchaseRow?.type).toBe("organization");
    expect(purchaseRow?.kind).toBe("comp");
    expect(purchaseRow?.expiresAt.toISOString()).toBe("2026-09-30T23:59:59.000Z");
  });

  it("creates multiple users from pasted emails with shared settings", async () => {
    const result = await createAdminUsers(db, {
      emails: "alpha@example.cz\nbeta@example.cz, alpha@example.cz",
      role: "user",
      access: "individual",
      expiresAt: new Date("2026-10-01T23:59:59.000Z"),
    });

    expect(result.created.map((u) => u.email)).toEqual([
      "alpha@example.cz",
      "beta@example.cz",
    ]);
    expect(result.errors).toEqual([]);

    const purchases = await db
      .select()
      .from(appSchema.purchase);
    expect(purchases).toHaveLength(2);
    expect(purchases.every((p) => p.expiresAt.toISOString() === "2026-10-01T23:59:59.000Z")).toBe(true);
  });

  it("rejects duplicate users and links existing purchases", async () => {
    await db.insert(appSchema.purchase).values({
      email: "buyer@example.cz",
      type: "individual",
      paymentMethod: "stripe",
      stripePaymentId: "pi_admin_user_test",
      status: "active",
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
    });

    const created = await createAdminUser(db, { email: "buyer@example.cz" });

    const purchaseRow = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.email, "buyer@example.cz"))
      .get();
    expect(purchaseRow?.userId).toBe(created.id);

    await expect(
      createAdminUser(db, { email: "buyer@example.cz" }),
    ).rejects.toThrow(/už existuje/i);
  });

  it("normalizes aggregated lesson_watch timestamps in the user list", async () => {
    const created = await createAdminUser(db, { email: "watcher@example.cz" });
    const [course] = await db
      .insert(appSchema.course)
      .values({
        title: "Kurz",
        slug: "kurz",
        description: "",
        published: true,
      })
      .returning({ id: appSchema.course.id });
    const [module] = await db
      .insert(appSchema.module)
      .values({
        courseId: course.id,
        title: "Modul",
        slug: "modul",
        sortOrder: 1,
      })
      .returning({ id: appSchema.module.id });
    const [lesson] = await db
      .insert(appSchema.lesson)
      .values({
        moduleId: module.id,
        publicId: "lesson-admin-users-watch",
        title: "Lekce",
        slug: "lekce",
        sortOrder: 1,
      })
      .returning({ id: appSchema.lesson.id });
    await db.insert(appSchema.lessonWatch).values({
      userId: created.id,
      lessonId: lesson.id,
      maxSegment: 2,
      watchedSeconds: 120,
      startedAt: new Date("2026-05-31T06:00:00.000Z"),
      updatedAt: new Date("2026-05-31T06:53:03.000Z"),
    });

    const result = await listAdminUsers(db, { search: "watcher@example.cz" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].createdAt).toBeInstanceOf(Date);
    expect(result.rows[0].lastActivityAt).toBeInstanceOf(Date);
    expect(result.rows[0].lastActivityAt?.toISOString()).toBe("2026-05-31T06:53:03.000Z");
  });

  it("lists a full page of users with purchases without a wide OR query", async () => {
    const createdAt = new Date("2026-05-31T08:00:00.000Z");
    const expiresAt = new Date("2027-05-31T08:00:00.000Z");
    for (let i = 0; i < 50; i++) {
      const id = `bulk-user-${String(i).padStart(2, "0")}`;
      const email = `bulk-${String(i).padStart(2, "0")}@example.cz`;
      await db.insert(authSchema.user).values({
        id,
        email,
        name: null,
        role: "user",
        emailVerified: true,
        createdAt: new Date(createdAt.getTime() + i * 1000),
        updatedAt: createdAt,
      });
      await db.insert(appSchema.purchase).values({
        email,
        userId: id,
        type: "individual",
        paymentMethod: "stripe",
        stripePaymentId: `bulk-session-${i}`,
        status: "active",
        expiresAt,
        createdAt,
      });
    }

    const result = await listAdminUsers(db, { limit: 50 });

    expect(result.rows).toHaveLength(50);
    expect(result.rows.every((row) => row.activeAccess === "individual")).toBe(true);
  });
});

describe("anonymizeAndDeleteUser", () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM user_emails");
    await env.DB.exec("DELETE FROM progress");
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM session");
    await env.DB.exec("DELETE FROM account");
    await env.DB.exec("DELETE FROM user");
    db = drizzle(env.DB, { schema: { ...authSchema, ...identitySchema, ...appSchema } });
  });

  it("smaže usera a anonymizuje jeho purchase (PII pryč, účetní data zůstanou)", async () => {
    const created = await createAdminUser(db, {
      email: "mazany@example.cz",
      name: "Mazaný Uživatel",
      role: "user",
      access: "individual",
    });

    // Doplň reálnou platbu s PII (firma) navázanou na usera.
    await db.insert(appSchema.purchase).values({
      email: "mazany@example.cz",
      userId: created.id,
      type: "individual",
      paymentMethod: "fio",
      variableSymbol: "33999111",
      stripePaymentId: null,
      status: "active",
      kind: "paid",
      amountPaid: 2000,
      companyName: "Firma s.r.o.",
      companyIco: "12345678",
      contactName: "Mazaný Uživatel",
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const anonymized = await anonymizeAndDeleteUser(db, created.id);
    expect(anonymized).toBeGreaterThanOrEqual(2); // comp grant + reálná platba

    // User je pryč.
    const userRow = await db
      .select()
      .from(authSchema.user)
      .where(eq(authSchema.user.id, created.id))
      .get();
    expect(userRow).toBeUndefined();

    // user_emails kaskádovaly.
    const emailRows = await db
      .select()
      .from(identitySchema.userEmails)
      .where(eq(identitySchema.userEmails.userId, created.id));
    expect(emailRows).toHaveLength(0);

    // Purchase přežil, ale PII je anonymizovaná; účetní data zůstala.
    const paid = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.variableSymbol, "33999111"))
      .get();
    expect(paid).toBeDefined();
    expect(paid!.userId).toBeNull();
    expect(paid!.email).toBe(`deleted+${created.id}@deleted.invalid`);
    expect(paid!.companyName).toBeNull();
    expect(paid!.companyIco).toBeNull();
    expect(paid!.contactName).toBeNull();
    expect(paid!.amountPaid).toBe(2000); // účetní data zachována
    expect(paid!.variableSymbol).toBe("33999111");
  });

  it("anonymizuje i nespárovanou objednávku podle e-mailu (userId NULL) — GDPR P1", async () => {
    const created = await createAdminUser(db, {
      email: "Prevod@Example.cz",
      role: "user",
      access: "free", // bez comp grantu
    });

    // Převodová objednávka vzniklá PŘED spárováním: userId=NULL, ale stejný
    // (lowercased) e-mail. Bez e-mailové větve by výmaz tenhle řádek minul.
    await db.insert(appSchema.purchase).values({
      email: "prevod@example.cz",
      userId: null,
      type: "individual",
      paymentMethod: "fio",
      variableSymbol: "33888222",
      status: "pending",
      kind: "paid",
      amountPaid: 2000,
      contactName: "Jan Převod",
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await anonymizeAndDeleteUser(db, created.id);

    const row = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.variableSymbol, "33888222"))
      .get();
    expect(row).toBeDefined();
    expect(row!.email).toBe(`deleted+${created.id}@deleted.invalid`);
    expect(row!.contactName).toBeNull();
  });

  it("hodí chybu pro neexistujícího uživatele", async () => {
    await expect(anonymizeAndDeleteUser(db, "neexistuje")).rejects.toThrow();
  });
});

describe("transferPurchaseToEmail", () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM user_identity_audit");
    await env.DB.exec("DELETE FROM user_emails");
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM session");
    await env.DB.exec("DELETE FROM account");
    await env.DB.exec("DELETE FROM user");
    db = drizzle(env.DB, { schema: { ...authSchema, ...identitySchema, ...appSchema } });
  });

  /** Založí uživatele s aktivním nákupem a vrátí obojí. */
  async function seedBuyer(email: string) {
    const created = await createAdminUser(db, { email, access: "individual" });
    await db.insert(appSchema.purchase).values({
      email,
      userId: created.id,
      type: "individual",
      paymentMethod: "fio",
      status: "active",
      kind: "paid",
      amountPaid: 3000,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
    });
    const row = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.userId, created.id))
      .get();
    return { userId: created.id, purchaseId: row!.id };
  }

  it("přesune nákup pod existující cílový účet", async () => {
    const { userId, purchaseId } = await seedBuyer("firma@example.cz");
    const target = await createAdminUser(db, { email: "soukroma@example.cz" });

    const result = await transferPurchaseToEmail(db, {
      fromUserId: userId,
      purchaseId,
      targetEmail: "  Soukroma@Example.cz  ",
      actor: "admin:test",
    });

    expect(result.createdTargetUser).toBe(false);
    expect(result.toUserId).toBe(target.id);
    expect(result.fromEmail).toBe("firma@example.cz");

    // userId i email musí jít spolu — hasAccess() páruje přes obojí.
    const moved = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.id, purchaseId))
      .get();
    expect(moved?.userId).toBe(target.id);
    expect(moved?.email).toBe("soukroma@example.cz");
  });

  it("založí cílový účet, když ještě neexistuje", async () => {
    const { userId, purchaseId } = await seedBuyer("firma2@example.cz");

    const result = await transferPurchaseToEmail(db, {
      fromUserId: userId,
      purchaseId,
      targetEmail: "novy@example.cz",
      actor: "admin:test",
    });

    expect(result.createdTargetUser).toBe(true);
    const created = await db
      .select()
      .from(authSchema.user)
      .where(eq(authSchema.user.id, result.toUserId))
      .get();
    expect(created?.email).toBe("novy@example.cz");

    // Bez záznamu v user_emails by se profil tvářil, že adresu nezná.
    const emailRow = await db
      .select()
      .from(identitySchema.userEmails)
      .where(eq(identitySchema.userEmails.email, "novy@example.cz"))
      .get();
    expect(emailRow?.userId).toBe(result.toUserId);
  });

  it("nechá fakturační údaje beze změny", async () => {
    const { userId, purchaseId } = await seedBuyer("firma3@example.cz");
    await db
      .update(appSchema.purchase)
      .set({ invoiceEmail: "fakturace@firma.cz", fakturoidSubjectId: 12345 })
      .where(eq(appSchema.purchase.id, purchaseId));

    await transferPurchaseToEmail(db, {
      fromUserId: userId,
      purchaseId,
      targetEmail: "jina@example.cz",
      actor: "admin:test",
    });

    const row = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.id, purchaseId))
      .get();
    expect(row?.invoiceEmail).toBe("fakturace@firma.cz");
    expect(row?.fakturoidSubjectId).toBe(12345);
  });

  it("zapíše audit záznam", async () => {
    const { userId, purchaseId } = await seedBuyer("firma4@example.cz");
    const result = await transferPurchaseToEmail(db, {
      fromUserId: userId,
      purchaseId,
      targetEmail: "audit@example.cz",
      actor: "admin:patrick@vibecoding.cz",
    });

    const audit = await db
      .select()
      .from(identitySchema.userIdentityAudit)
      .where(eq(identitySchema.userIdentityAudit.userId, result.toUserId))
      .get();
    expect(audit?.action).toBe("purchase_transferred");
    expect(audit?.actor).toBe("admin:patrick@vibecoding.cz");
    expect(JSON.parse(audit!.details!)).toMatchObject({
      purchaseId,
      fromEmail: "firma4@example.cz",
      toEmail: "audit@example.cz",
    });
  });

  it("převede nákup na účet, jehož vedlejší adresou je cíl", async () => {
    const { userId, purchaseId } = await seedBuyer("firma6@example.cz");
    const owner = await createAdminUser(db, { email: "hlavni@example.cz" });
    await addUserEmail(db, { userId: owner.id, email: "vedlejsi@example.cz", via: "self-add" });
    const usersBefore = (await db.select().from(authSchema.user).all()).length;

    const result = await transferPurchaseToEmail(db, {
      fromUserId: userId,
      purchaseId,
      targetEmail: "vedlejsi@example.cz",
      actor: "admin:test",
    });

    expect(result.toUserId).toBe(owner.id);
    expect(result.createdTargetUser).toBe(false);
    expect((await db.select().from(authSchema.user).all()).length).toBe(usersBefore);
    const moved = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.id, purchaseId))
      .get();
    expect(moved?.userId).toBe(owner.id);
  });

  it("odmítne převod na vedlejší adresu téhož účtu", async () => {
    const { userId, purchaseId } = await seedBuyer("firma7@example.cz");
    await addUserEmail(db, { userId, email: "druha@example.cz", via: "self-add" });
    await expect(
      transferPurchaseToEmail(db, {
        fromUserId: userId,
        purchaseId,
        targetEmail: "druha@example.cz",
        actor: "admin:test",
      }),
    ).rejects.toThrow(/stejnému účtu/i);
  });

  it("odmítne převod na stejnou adresu", async () => {
    const { userId, purchaseId } = await seedBuyer("stejna@example.cz");
    await expect(
      transferPurchaseToEmail(db, {
        fromUserId: userId,
        purchaseId,
        targetEmail: "STEJNA@example.cz",
        actor: "admin:test",
      }),
    ).rejects.toThrow(/stejná/i);
  });

  it("odmítne neplatnou adresu i cizí objednávku", async () => {
    const { userId, purchaseId } = await seedBuyer("firma5@example.cz");
    await expect(
      transferPurchaseToEmail(db, {
        fromUserId: userId,
        purchaseId,
        targetEmail: "neni-email",
        actor: "admin:test",
      }),
    ).rejects.toThrow(/platnou/i);

    const other = await createAdminUser(db, { email: "cizi@example.cz" });
    await expect(
      transferPurchaseToEmail(db, {
        fromUserId: other.id,
        purchaseId,
        targetEmail: "kamkoliv@example.cz",
        actor: "admin:test",
      }),
    ).rejects.toThrow(/nenalezena/i);
  });
});

describe("manuallyConfirmPayment", () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM user_emails");
    await env.DB.exec("DELETE FROM purchase");
    await env.DB.exec("DELETE FROM session");
    await env.DB.exec("DELETE FROM account");
    await env.DB.exec("DELETE FROM user");
    db = drizzle(env.DB, { schema: { ...authSchema, ...identitySchema, ...appSchema } });
  });

  /** Pending převodová objednávka se splatností za `dueInDays` dní. */
  async function seedPending(email: string, dueInDays: number) {
    const created = await createAdminUser(db, { email });
    await db.insert(appSchema.purchase).values({
      email,
      userId: created.id,
      type: "individual",
      paymentMethod: "creditas",
      status: "pending",
      kind: "paid",
      amountPaid: 3000,
      expiresAt: new Date(Date.now() + dueInDays * 86_400_000),
      createdAt: new Date(),
    });
    const row = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.userId, created.id))
      .get();
    return { userId: created.id, purchaseId: row!.id };
  }

  /**
   * Regrese: expiresAt u pending objednávky je splatnost převodu (7 dní), ne
   * platnost kurzu. Dřívější verze si ji při potvrzení uvnitř splatnosti
   * ponechala a zákazník dostal přístup jen na týden.
   */
  it("dá plnou roční platnost i při potvrzení uvnitř splatnosti", async () => {
    const { userId, purchaseId } = await seedPending("brzy@example.cz", 7);

    await manuallyConfirmPayment(db, { userId, purchaseId, grantedBy: "admin@test.cz" });

    const row = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.id, purchaseId))
      .get();
    const days = (row!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(360);
    expect(row!.status).toBe("active");
    expect(row!.kind).toBe("manual");
  });

  it("dá plnou roční platnost i u dávno propadlé objednávky", async () => {
    const { userId, purchaseId } = await seedPending("stara@example.cz", -30);

    await manuallyConfirmPayment(db, { userId, purchaseId });

    const row = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.id, purchaseId))
      .get();
    const days = (row!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(360);
  });

  it("umí přepsat částku a odmítne nepending objednávku", async () => {
    const { userId, purchaseId } = await seedPending("castka@example.cz", 7);

    await manuallyConfirmPayment(db, { userId, purchaseId, amountPaid: 1500 });
    const row = await db
      .select()
      .from(appSchema.purchase)
      .where(eq(appSchema.purchase.id, purchaseId))
      .get();
    expect(row!.amountPaid).toBe(1500);

    // Druhé potvrzení už projít nesmí — objednávka je aktivní.
    await expect(
      manuallyConfirmPayment(db, { userId, purchaseId }),
    ).rejects.toThrow(/pending/i);
  });
});
