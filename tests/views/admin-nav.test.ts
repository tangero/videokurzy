import { describe, expect, it } from "vitest";
import { renderToString } from "hono/jsx/dom/server";
import { AdminNav } from "../../src/views/admin-courses";

describe("AdminNav", () => {
  it("shows the new user action from admin subpages", () => {
    const html = renderToString(AdminNav({ active: "/admin/courses" }));

    expect(html).toContain('href="/admin/users/new"');
    expect(html).toContain("Přidat uživatele");
    expect(html).toContain('href="/admin/users"');
  });
});
