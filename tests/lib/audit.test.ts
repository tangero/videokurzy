import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { userIdentityAudit } from "../../src/db/identity-schema";
import { logIdentityEvent } from "../../src/lib/audit";

describe("audit lib", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM user_identity_audit");
  });

  it("writes an audit record with serialized details", async () => {
    const db = drizzle(env.DB);
    await logIdentityEvent(db, {
      userId: "u1",
      action: "email_added",
      actor: "self",
      details: { email: "x@y.cz" },
    });
    const rows = await db
      .select()
      .from(userIdentityAudit)
      .where(eq(userIdentityAudit.userId, "u1"))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("email_added");
    expect(JSON.parse(rows[0].details!)).toEqual({ email: "x@y.cz" });
  });

  it("writes record without details (null)", async () => {
    const db = drizzle(env.DB);
    await logIdentityEvent(db, {
      userId: "u2",
      action: "email_removed",
      actor: "admin:patrick@vibecoding.cz",
    });
    const rows = await db
      .select()
      .from(userIdentityAudit)
      .where(eq(userIdentityAudit.userId, "u2"))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toBeNull();
    expect(rows[0].actor).toBe("admin:patrick@vibecoding.cz");
  });
});
