import { describe, expect, it } from "vitest";
import { buildInviteRows } from "../../src/lib/invite-generate";

describe("buildInviteRows", () => {
  let n = 0;
  const fakeToken = () => `tok${++n}`;

  it("builds one row per unique email with token, url and SQL", () => {
    n = 0;
    const out = buildInviteRows(["a@x.cz", "b@y.cz"], {
      percent: 50,
      batch: "vibecoding-2026-06",
      label: "Osobní sleva",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      baseUrl: "https://kurzy.vibecoding.cz",
      now: new Date("2026-06-03T10:00:00.000Z"),
      genToken: fakeToken,
    });

    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({
      email: "a@x.cz",
      token: "tok1",
      url: "https://kurzy.vibecoding.cz/checkout/individual?invite=tok1",
    });
    expect(out.sql).toContain("INSERT INTO discount_invite");
    expect(out.sql).toContain("'tok1'");
    expect(out.sql).toContain("'a@x.cz'");
    expect(out.sql).toContain(String(Math.floor(new Date("2026-12-31T00:00:00.000Z").getTime() / 1000)));
  });

  it("normalizes and dedupes emails, skips blanks", () => {
    n = 0;
    const out = buildInviteRows(["A@X.cz", " a@x.cz ", "", "b@y.cz"], {
      percent: 50,
      batch: "b",
      label: null,
      expiresAt: null,
      baseUrl: "https://kurzy.vibecoding.cz",
      now: new Date("2026-06-03T10:00:00.000Z"),
      genToken: fakeToken,
    });
    expect(out.rows.map((r) => r.email)).toEqual(["a@x.cz", "b@y.cz"]);
  });

  it("escapes single quotes in email to prevent broken SQL", () => {
    n = 0;
    const out = buildInviteRows(["o'brien@x.cz"], {
      percent: 50, batch: "b", label: null, expiresAt: null,
      baseUrl: "https://kurzy.vibecoding.cz",
      now: new Date("2026-06-03T10:00:00.000Z"),
      genToken: fakeToken,
    });
    expect(out.sql).toContain("'o''brien@x.cz'");
  });
});
