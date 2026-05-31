import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { AdminUsersList } from "../../src/views/admin-users";
import type { AdminUserListItem } from "../../src/lib/admin-users";

function userRow(overrides: Partial<AdminUserListItem> = {}): AdminUserListItem {
  return {
    id: "user-1",
    email: "user@example.cz",
    name: null,
    role: "user",
    createdAt: new Date("2026-05-31T08:00:00.000Z"),
    activeAccess: "individual",
    accessExpiresAt: new Date("2027-05-31T08:00:00.000Z"),
    accessSource: "paid",
    lastActivityAt: null,
    ...overrides,
  };
}

describe("AdminUsersList", () => {
  it("shows the add-user action only in the admin nav", () => {
    const html = renderToString(
      <AdminUsersList
        rows={[userRow()]}
        total={1}
        search=""
        page={1}
        pageSize={50}
      />,
    );

    expect(html.match(/Přidat uživatele/g)).toHaveLength(1);
  });

  it("renders access as a compact single-line badge", () => {
    const html = renderToString(
      <AdminUsersList
        rows={[userRow()]}
        total={1}
        search=""
        page={1}
        pageSize={50}
      />,
    );

    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("soukromá · zaplaceno · do 31. 5. 2027");
  });
});
