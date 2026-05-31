import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  signAddEmailIntentForTest,
  verifyAddEmailIntentForTest,
} from "../../src/routes/internal";

describe("add-email intent signing", () => {
  it("verifies an untampered add-email intent", async () => {
    const intent = await signAddEmailIntentForTest(env, {
      userId: "user-1",
      email: "New.Email@Example.CZ",
      expiresAt: Date.now() + 60_000,
    });

    const payload = await verifyAddEmailIntentForTest(env, intent);

    expect(payload).toEqual({
      userId: "user-1",
      email: "new.email@example.cz",
      expiresAt: expect.any(Number),
    });
  });

  it("rejects a tampered add-email intent payload", async () => {
    const intent = await signAddEmailIntentForTest(env, {
      userId: "user-1",
      email: "new.email@example.cz",
      expiresAt: Date.now() + 60_000,
    });
    const [body, sig] = intent.split(".");
    const tampered = `${body!.replace(/.$/, body!.endsWith("A") ? "B" : "A")}.${sig}`;

    const payload = await verifyAddEmailIntentForTest(env, tampered);

    expect(payload).toBeNull();
  });

  it("rejects expired add-email intents", async () => {
    const intent = await signAddEmailIntentForTest(env, {
      userId: "user-1",
      email: "new.email@example.cz",
      expiresAt: Date.now() - 1,
    });

    const payload = await verifyAddEmailIntentForTest(env, intent);

    expect(payload).toBeNull();
  });
});
