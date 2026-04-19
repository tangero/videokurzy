import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("has D1 binding", () => {
    expect(env.DB).toBeDefined();
  });

  it("has KV binding", () => {
    expect(env.KV).toBeDefined();
  });
});
