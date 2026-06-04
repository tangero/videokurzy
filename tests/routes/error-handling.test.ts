import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// Globální error handling — app.onError + app.notFound (src/index.tsx).
// Formát odpovědi se rozlišuje podle prefixu cesty: /api/ a /internal/ → JSON,
// vše ostatní → HTML stránka (ErrorPage). Viz src/lib/errors.ts wantsJson().

describe("globální 404", () => {
  it("ne-API cesta → HTML stránka s DOCTYPE", async () => {
    const res = await SELF.fetch("https://test.local/neexistuje-xyz");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("404");
  });

  it("throw NotFoundError z handleru (/watch/neexistuje) → HTML 404", async () => {
    const res = await SELF.fetch("https://test.local/watch/neexistujici-slug-xyz");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("404");
  });

  it("/api/ cesta → JSON { error: not_found } bez correlationId", async () => {
    const res = await SELF.fetch("https://test.local/api/neexistuje");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("/internal/ cesta → JSON (auth guard odpoví dřív než notFound, ale stále JSON)", async () => {
    // Neexistující /internal/ endpoint spadne na requireInternalSecret (403)
    // dřív, než se dojde k notFound — to je žádoucí (neprozrazuje existenci
    // endpointů). Pointa testu: odpověď pod /internal/ je JSON, ne HTML stránka.
    const res = await SELF.fetch("https://test.local/internal/neexistuje");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.status).not.toBe(200);
  });
});

describe("globální 500", () => {
  it("/api/__throw → JSON s correlationId", async () => {
    const res = await SELF.fetch("https://test.local/api/__throw");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json<{ error: string; correlationId: string }>();
    expect(typeof body.error).toBe("string");
    expect(typeof body.correlationId).toBe("string");
    expect(body.correlationId.length).toBeGreaterThan(0);
  });

  it("/__throw → HTML stránka s DOCTYPE", async () => {
    const res = await SELF.fetch("https://test.local/__throw");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("500");
  });
});

describe("htmx fragment se nepřebíjí globálním handlerem", () => {
  it("řízená validační odpověď z handleru zůstává fragment, ne celostránkový ErrorPage", async () => {
    // verify bez hlavičky HX-Request → handler vrátí <VerifyError> fragment (403)
    // přímo, nevyhazuje výjimku. Ověřujeme, že globální handler do toho nezasáhl
    // (žádný <!DOCTYPE>, žádný celý <html>).
    const res = await SELF.fetch("https://test.local/api/fio/verify/NEEXISTUJE-VS", {
      method: "POST",
    });
    expect(res.status).toBe(403);
    const html = await res.text();
    // Fragment, ne celostránkový ErrorPage (ten by měl <html> a hlavičku/patičku).
    expect(html).not.toContain("<html");
    expect(html).not.toContain("site-header");
    expect(html).toContain("Chyba ověření");
  });
});
