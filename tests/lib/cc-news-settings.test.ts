import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { siteConfig } from "../../src/db/schema";
import {
  CC_NEWS_LIVE_SEND_KEY,
  getCcNewsLiveSend,
  isCcNewsLiveSend,
} from "../../src/lib/cc-news/settings";

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

  it("isCcNewsLiveSend vyžaduje OBĚ brány (env + admin přepínač)", async () => {
    const db = drizzle(env.DB);

    // jen env, admin přepínač chybí → dry-run
    expect(await isCcNewsLiveSend(db, { CC_NEWS_DRY_RUN: "0" })).toBe(false);

    // jen admin přepínač, env není "0" → dry-run
    await setLiveSend(db, "true");
    expect(await isCcNewsLiveSend(db, { CC_NEWS_DRY_RUN: undefined })).toBe(false);
    expect(await isCcNewsLiveSend(db, { CC_NEWS_DRY_RUN: "1" })).toBe(false);

    // obě brány → live
    expect(await isCcNewsLiveSend(db, { CC_NEWS_DRY_RUN: "0" })).toBe(true);
  });
});
