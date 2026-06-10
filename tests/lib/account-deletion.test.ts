import { describe, expect, it } from "vitest";
import {
  signDeletionIntent,
  verifyDeletionIntent,
  DELETION_TOKEN_TTL_MS,
} from "../../src/lib/account-deletion";

const ENV = { AUTH_INTERNAL_SECRET: "test-secret-for-deletion-tokens" };

describe("deletion intent token", () => {
  it("round-trip: podepsaný token se ověří zpět na stejný intent", async () => {
    const intent = {
      userId: "u_123",
      email: "User@Example.cz",
      expiresAt: Date.now() + DELETION_TOKEN_TTL_MS,
    };
    const token = await signDeletionIntent(ENV, intent);
    const verified = await verifyDeletionIntent(ENV, token);
    expect(verified).not.toBeNull();
    expect(verified!.userId).toBe("u_123");
    expect(verified!.email).toBe("user@example.cz"); // normalizováno na lowercase
  });

  it("prošlý token se odmítne", async () => {
    const token = await signDeletionIntent(ENV, {
      userId: "u_1",
      email: "a@b.cz",
      expiresAt: Date.now() - 1000,
    });
    expect(await verifyDeletionIntent(ENV, token)).toBeNull();
  });

  it("pozměněný podpis se odmítne", async () => {
    const token = await signDeletionIntent(ENV, {
      userId: "u_1",
      email: "a@b.cz",
      expiresAt: Date.now() + DELETION_TOKEN_TTL_MS,
    });
    const [body] = token.split(".");
    const tampered = `${body}.AAAAinvalidsignatureAAAA`;
    expect(await verifyDeletionIntent(ENV, tampered)).toBeNull();
  });

  it("pozměněné tělo (jiný userId) zneprojde podpisem", async () => {
    const token = await signDeletionIntent(ENV, {
      userId: "u_1",
      email: "a@b.cz",
      expiresAt: Date.now() + DELETION_TOKEN_TTL_MS,
    });
    const [, sig] = token.split(".");
    const forgedBody = btoa(
      JSON.stringify({ userId: "u_ADMIN", email: "a@b.cz", expiresAt: Date.now() + 100000 }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(await verifyDeletionIntent(ENV, `${forgedBody}.${sig}`)).toBeNull();
  });

  it("token podepsaný jiným secretem se odmítne", async () => {
    const token = await signDeletionIntent(ENV, {
      userId: "u_1",
      email: "a@b.cz",
      expiresAt: Date.now() + DELETION_TOKEN_TTL_MS,
    });
    expect(
      await verifyDeletionIntent({ AUTH_INTERNAL_SECRET: "jiny-secret" }, token),
    ).toBeNull();
  });

  it("nesmyslný vstup se odmítne bez výjimky", async () => {
    expect(await verifyDeletionIntent(ENV, "")).toBeNull();
    expect(await verifyDeletionIntent(ENV, "abc")).toBeNull();
    expect(await verifyDeletionIntent(ENV, "a.b.c")).toBeNull();
  });
});
