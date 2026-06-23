import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { siteConfig } from "../../src/db/schema";
import {
  CC_NEWS_LIVE_SEND_KEY,
  CC_NEWS_APPROVAL_EMAILS_KEY,
  getCcNewsLiveSend,
  isCcNewsLiveSend,
  parseApprovalEmails,
  getCcNewsApprovalEmails,
} from "../../src/lib/cc-news/settings";
import { ADMIN_EMAILS } from "../../src/config/admin";

async function setLiveSend(db: ReturnType<typeof drizzle>, value: string) {
  await db
    .insert(siteConfig)
    .values({ key: CC_NEWS_LIVE_SEND_KEY, value })
    .onConflictDoUpdate({ target: siteConfig.key, set: { value } });
}

describe("cc-news live-send přepínač (dvě brány)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM site_config");
  });

  it("getCcNewsLiveSend je defaultně false (chybí řádek)", async () => {
    const db = drizzle(env.DB);
    expect(await getCcNewsLiveSend(db)).toBe(false);
  });

  it("getCcNewsLiveSend čte 'true' / 'false'", async () => {
    const db = drizzle(env.DB);
    await setLiveSend(db, "true");
    expect(await getCcNewsLiveSend(db)).toBe(true);
    await setLiveSend(db, "false");
    expect(await getCcNewsLiveSend(db)).toBe(false);
  });

  it("isCcNewsLiveSend vyžaduje OBĚ brány + RESEND_API_KEY", async () => {
    const db = drizzle(env.DB);
    const KEY = "re_test";

    // jen env, admin přepínač chybí → dry-run
    expect(await isCcNewsLiveSend(db, { CC_NEWS_DRY_RUN: "0", RESEND_API_KEY: KEY })).toBe(false);

    // jen admin přepínač, env není "0" → dry-run
    await setLiveSend(db, "true");
    expect(await isCcNewsLiveSend(db, { CC_NEWS_DRY_RUN: undefined, RESEND_API_KEY: KEY })).toBe(false);
    expect(await isCcNewsLiveSend(db, { CC_NEWS_DRY_RUN: "1", RESEND_API_KEY: KEY })).toBe(false);

    // obě brány, ale chybí RESEND_API_KEY → dry-run (radši nic neposílat naprázdno)
    expect(await isCcNewsLiveSend(db, { CC_NEWS_DRY_RUN: "0" })).toBe(false);
    expect(await isCcNewsLiveSend(db, { CC_NEWS_DRY_RUN: "0", RESEND_API_KEY: "" })).toBe(false);

    // všechny tři podmínky → live
    expect(await isCcNewsLiveSend(db, { CC_NEWS_DRY_RUN: "0", RESEND_API_KEY: KEY })).toBe(true);
  });
});

describe("cc-news příjemci schvalovacího e-mailu", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM site_config");
  });

  it("parseApprovalEmails rozseká řádky/čárky/středníky, dedup, lowercase, jen validní", () => {
    expect(
      parseApprovalEmails("  A@B.cz \n c@d.cz, c@d.cz; nevalid ; x@y.io "),
    ).toEqual(["a@b.cz", "c@d.cz", "x@y.io"]);
    expect(parseApprovalEmails("")).toEqual([]);
    expect(parseApprovalEmails(null)).toEqual([]);
    expect(parseApprovalEmails("bez-zavinace")).toEqual([]);
  });

  it("getCcNewsApprovalEmails: prázdné/chybějící → fallback ADMIN_EMAILS", async () => {
    const db = drizzle(env.DB);
    expect(await getCcNewsApprovalEmails(db)).toEqual([...ADMIN_EMAILS]);

    // prázdný řádek v configu → pořád fallback (parse vrátí [])
    await db
      .insert(siteConfig)
      .values({ key: CC_NEWS_APPROVAL_EMAILS_KEY, value: "   " })
      .onConflictDoUpdate({ target: siteConfig.key, set: { value: "   " } });
    expect(await getCcNewsApprovalEmails(db)).toEqual([...ADMIN_EMAILS]);
  });

  it("getCcNewsApprovalEmails: nastavené adresy přebijou ADMIN_EMAILS", async () => {
    const db = drizzle(env.DB);
    const value = "patrick@zandl.cz\nredakce@example.cz";
    await db
      .insert(siteConfig)
      .values({ key: CC_NEWS_APPROVAL_EMAILS_KEY, value })
      .onConflictDoUpdate({ target: siteConfig.key, set: { value } });
    expect(await getCcNewsApprovalEmails(db)).toEqual([
      "patrick@zandl.cz",
      "redakce@example.cz",
    ]);
  });
});
