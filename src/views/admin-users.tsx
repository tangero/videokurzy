import { AdminNav } from "./admin-courses";
import type { AdminUserListItem, AdminUserDetail } from "../lib/admin-users";

function formatDate(d: Date): string {
  return d.toLocaleDateString("cs-CZ");
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function accessBadge(
  access: AdminUserListItem["activeAccess"],
  expiresAt: Date | null,
  source: AdminUserListItem["accessSource"],
  role: string,
) {
  if (role === "admin") {
    return (
      <span
        class="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700"
        title="Plný přístup z titulu role administrátora — purchase řádek se neeviduje."
      >
        admin
      </span>
    );
  }
  if (!access) {
    return (
      <span
        class="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600"
        title="Bez aktivního přístupu — jen registrace, vidí jen ukázkové lekce."
      >
        zdarma
      </span>
    );
  }
  const typeLabel = access === "organization" ? "firemní" : "soukromá";
  const isGrant = source === "grant";
  const cls = isGrant
    ? "bg-indigo-100 text-indigo-700"
    : access === "organization"
      ? "bg-purple-100 text-purple-700"
      : "bg-emerald-100 text-emerald-700";
  const sourceLabel = isGrant ? "grant zdarma" : "zaplaceno";
  const expired = expiresAt && expiresAt < new Date();
  const title = `${sourceLabel}${expiresAt ? ` · platnost do ${formatDate(expiresAt)}` : ""}`;
  return (
    <span
      class={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${cls} ${expired ? "opacity-60 line-through" : ""}`}
      title={title}
    >
      <span>{typeLabel}</span>
      <span class="font-normal opacity-80">· {sourceLabel}</span>
      {expiresAt && <span class="font-normal opacity-70">do {formatDate(expiresAt)}</span>}
    </span>
  );
}

export function AdminUsersList({
  rows,
  total,
  search,
  page,
  pageSize,
  flash,
}: {
  rows: AdminUserListItem[];
  total: number;
  search: string;
  page: number;
  pageSize: number;
  flash?: { kind: "ok" | "err"; text: string };
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const prevHref = page > 1
    ? `/admin/users?${new URLSearchParams({ q: search, page: String(page - 1) }).toString()}`
    : null;
  const nextHref = page < totalPages
    ? `/admin/users?${new URLSearchParams({ q: search, page: String(page + 1) }).toString()}`
    : null;

  return (
    <div class="max-w-5xl mx-auto px-4 py-8">
      <h1 class="text-2xl font-bold mb-6">Admin</h1>
      <AdminNav active="/admin/users" />

      {flash && (
        <div
          class={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            flash.kind === "ok"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {flash.text}
        </div>
      )}

      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 class="text-xl font-bold">Uživatelé <span class="text-sm font-normal text-gray-500">({total})</span></h2>
        <a href="/admin/users/new" class="text-sm bg-gray-900 text-white px-3 py-2 rounded hover:bg-gray-700 no-underline">
          + Přidat uživatele
        </a>
      </div>

      <form method="get" action="/admin/users" class="mb-4 flex gap-2">
        <input
          type="search"
          name="q"
          value={search}
          placeholder="Hledat podle e-mailu nebo jména…"
          class="flex-1 rounded border px-3 py-2 text-sm"
        />
        <button type="submit" class="bg-gray-900 text-white px-4 py-2 rounded text-sm hover:bg-gray-700">
          Hledat
        </button>
        {search && (
          <a href="/admin/users" class="px-3 py-2 text-sm text-gray-600 hover:underline">
            zrušit
          </a>
        )}
      </form>

      <div class="bg-white rounded-lg border overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-2 text-left">E-mail</th>
              <th class="px-4 py-2 text-left">Jméno</th>
              <th class="px-4 py-2 text-left">Role</th>
              <th class="px-4 py-2 text-left">Přístup</th>
              <th class="px-4 py-2 text-left">Poslední aktivita</th>
              <th class="px-4 py-2 text-left">Vytvořen</th>
              <th class="px-4 py-2 text-right">Akce</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr class="border-t">
                <td class="px-4 py-2 font-medium">
                  <a href={`/admin/users/${u.id}`} class="text-indigo-600 hover:underline no-underline">
                    {u.email}
                  </a>
                </td>
                <td class="px-4 py-2 text-gray-600">{u.name ?? "—"}</td>
                <td class="px-4 py-2">
                  <span
                    class={`px-2 py-1 rounded-full text-xs font-medium ${
                      u.role === "admin"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td class="px-4 py-2">{accessBadge(u.activeAccess, u.accessExpiresAt, u.accessSource, u.role)}</td>
                <td class="px-4 py-2 text-gray-500">
                  {u.lastActivityAt ? formatDate(u.lastActivityAt) : "—"}
                </td>
                <td class="px-4 py-2 text-gray-500">{formatDate(u.createdAt)}</td>
                <td class="px-4 py-2 text-right">
                  <a href={`/admin/users/${u.id}`} class="text-indigo-600 hover:underline text-xs">
                    detail
                  </a>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colspan={6} class="px-4 py-6 text-gray-500 text-center">
                  Žádní uživatelé.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div class="flex items-center justify-between mt-4 text-sm">
          <span class="text-gray-500">
            Stránka {page} z {totalPages}
          </span>
          <div class="flex gap-2">
            {prevHref ? (
              <a href={prevHref} class="px-3 py-1 border rounded hover:bg-gray-50 no-underline">
                ← Předchozí
              </a>
            ) : (
              <span class="px-3 py-1 border rounded text-gray-300">← Předchozí</span>
            )}
            {nextHref ? (
              <a href={nextHref} class="px-3 py-1 border rounded hover:bg-gray-50 no-underline">
                Další →
              </a>
            ) : (
              <span class="px-3 py-1 border rounded text-gray-300">Další →</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminUserDetailView({
  user,
  flash,
  defaultExpiresOn,
  currentUserId,
}: {
  user: AdminUserDetail;
  flash?: { kind: "ok" | "err"; text: string };
  defaultExpiresOn: string;
  currentUserId: string;
}) {
  const isSelf = user.id === currentUserId;
  return (
    <div class="max-w-4xl mx-auto px-4 py-8">
      <h1 class="text-2xl font-bold mb-6">Admin</h1>
      <AdminNav active="/admin/users" />

      <div class="mb-4">
        <a href="/admin/users" class="text-sm text-gray-600 hover:underline">
          ← Zpět na uživatele
        </a>
      </div>

      {flash && (
        <div
          class={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            flash.kind === "ok"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {flash.text}
        </div>
      )}

      <div class="bg-white rounded-lg border p-5 mb-6">
        <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 class="text-xl font-bold">{user.name ?? user.email}</h2>
            <p class="text-sm text-gray-500">{user.email}</p>
          </div>
          <div class="flex items-center gap-2">
            <span
              class={`px-2 py-1 rounded-full text-xs font-medium ${
                user.role === "admin" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"
              }`}
            >
              {user.role}
            </span>
            {user.emailVerified && (
              <span class="px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                ověřený e-mail
              </span>
            )}
          </div>
        </div>

        <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt class="text-gray-500">ID</dt>
          <dd class="font-mono text-xs">{user.id}</dd>
          <dt class="text-gray-500">Vytvořen</dt>
          <dd>{formatDate(user.createdAt)}</dd>
          <dt class="text-gray-500">Aktualizován</dt>
          <dd>{formatDate(user.updatedAt)}</dd>
          <dt class="text-gray-500">Dokončené lekce</dt>
          <dd>{user.progressCount}</dd>
        </dl>
      </div>

      {/* Edit form */}
      <div class="bg-white rounded-lg border p-5 mb-6">
        <h3 class="text-lg font-semibold mb-3">Úpravy</h3>
        <form method="post" action={`/admin/users/${user.id}/edit`} class="space-y-3">
          <label class="block">
            <span class="block text-sm font-medium text-gray-700 mb-1">Jméno</span>
            <input name="name" value={user.name ?? ""} class="w-full rounded border px-3 py-2 text-sm" />
          </label>
          <label class="block">
            <span class="block text-sm font-medium text-gray-700 mb-1">Role</span>
            <select name="role" class="w-full rounded border px-3 py-2 text-sm" disabled={isSelf}>
              <option value="user" selected={user.role === "user"}>
                user
              </option>
              <option value="admin" selected={user.role === "admin"}>
                admin
              </option>
            </select>
            {isSelf && (
              <span class="mt-1 block text-xs text-gray-500">
                Vlastní roli nelze měnit.
              </span>
            )}
          </label>
          <button class="bg-gray-900 text-white px-4 py-2 rounded text-sm hover:bg-gray-700">Uložit</button>
        </form>
      </div>

      {/* Emails */}
      <div class="bg-white rounded-lg border p-5 mb-6">
        <h3 class="text-lg font-semibold mb-3">E-mailové adresy</h3>
        {user.emails.length === 0 ? (
          <p class="text-sm text-gray-500">Žádné adresy v user_emails.</p>
        ) : (
          <table class="w-full text-sm">
            <thead class="text-left text-gray-500">
              <tr>
                <th class="py-1 pr-2">E-mail</th>
                <th class="py-1 pr-2">Primární</th>
                <th class="py-1 pr-2">Ověřeno</th>
                <th class="py-1 pr-2">Přidáno</th>
                <th class="py-1">Zdroj</th>
              </tr>
            </thead>
            <tbody>
              {user.emails.map((e) => (
                <tr class="border-t">
                  <td class="py-1 pr-2 font-medium">{e.email}</td>
                  <td class="py-1 pr-2">{e.isPrimary ? "ano" : "—"}</td>
                  <td class="py-1 pr-2">
                    {e.verifiedAt.getTime() === 0 ? "—" : formatDate(e.verifiedAt)}
                  </td>
                  <td class="py-1 pr-2 text-gray-500">{formatDate(e.addedAt)}</td>
                  <td class="py-1 text-gray-500">{e.addedVia}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Grants / purchases */}
      <div class="bg-white rounded-lg border p-5 mb-6">
        <h3 class="text-lg font-semibold mb-3">Přístupy a nákupy</h3>
        {user.purchases.length === 0 ? (
          <p class="text-sm text-gray-500 mb-4">Zatím žádné nákupy ani granty.</p>
        ) : (
          <table class="w-full text-sm mb-4">
            <thead class="text-left text-gray-500">
              <tr>
                <th class="py-1 pr-2">Typ</th>
                <th class="py-1 pr-2">Stav</th>
                <th class="py-1 pr-2">Platnost do</th>
                <th class="py-1 pr-2">Zdroj / Důvod</th>
                <th class="py-1 pr-2">Vytvořeno</th>
                <th class="py-1 text-right">Akce</th>
              </tr>
            </thead>
            <tbody>
              {user.purchases.map((p) => (
                <tr class="border-t align-top">
                  <td class="py-2 pr-2 font-medium">{p.type === "organization" ? "firemní" : "soukromá"}</td>
                  <td class="py-2 pr-2">
                    <span
                      class={`px-2 py-1 rounded-full text-xs font-medium ${
                        p.status === "active"
                          ? "bg-green-100 text-green-700"
                          : p.status === "pending"
                            ? "bg-yellow-100 text-yellow-700"
                            : p.status === "expired"
                              ? "bg-gray-200 text-gray-700"
                              : "bg-red-100 text-red-700"
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td class="py-2 pr-2">{formatDate(p.expiresAt)}</td>
                  <td class="py-2 pr-2 text-gray-500 text-xs">
                    {p.kind === "paid" ? (
                      <span>{p.paymentMethod}</span>
                    ) : p.kind === "staff" ? (
                      <span class="text-blue-700">staff (admin)</span>
                    ) : (
                      <span>
                        grant
                        {p.grantedBy && <span class="block text-[10px] text-gray-400">{p.grantedBy}</span>}
                        {p.compReason && <span class="block text-[10px] italic text-indigo-600">„{p.compReason}“</span>}
                      </span>
                    )}
                  </td>
                  <td class="py-2 pr-2 text-gray-500">{formatDate(p.createdAt)}</td>
                  <td class="py-2 text-right">
                    <div class="flex justify-end gap-2">
                      <form
                        method="post"
                        action={`/admin/users/${user.id}/purchases/${p.id}/extend`}
                        class="flex items-center gap-1"
                      >
                        <input
                          type="date"
                          name="expiresOn"
                          value={isoDate(p.expiresAt)}
                          class="rounded border px-2 py-1 text-xs"
                        />
                        <button class="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700">
                          Prodloužit
                        </button>
                      </form>
                      {p.status === "active" && (
                        <form
                          method="post"
                          action={`/admin/users/${user.id}/purchases/${p.id}/revoke`}
                          onsubmit="return confirm('Opravdu odebrat tento přístup?');"
                        >
                          <button class="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">
                            Odebrat
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <details>
          <summary class="cursor-pointer text-sm font-medium text-indigo-600">
            + Přidat grant
          </summary>
          <form method="post" action={`/admin/users/${user.id}/purchases/new`} class="mt-3 grid grid-cols-2 gap-3 text-sm">
            <label class="block">
              <span class="block text-xs font-medium text-gray-700 mb-1">Typ</span>
              <select name="access" class="w-full rounded border px-3 py-2 text-sm">
                <option value="individual">Soukromá licence</option>
                <option value="organization">Firemní licence</option>
              </select>
            </label>
            <label class="block">
              <span class="block text-xs font-medium text-gray-700 mb-1">Platnost do</span>
              <input
                type="date"
                name="expiresOn"
                value={defaultExpiresOn}
                class="w-full rounded border px-3 py-2 text-sm"
              />
            </label>
            <label class="block col-span-2">
              <span class="block text-xs font-medium text-gray-700 mb-1">Důvod grantu (volitelné)</span>
              <input
                type="text"
                name="compReason"
                placeholder="např. Recenze, VIP, podpora, akce..."
                class="w-full rounded border px-3 py-2 text-sm"
              />
            </label>
            <div class="col-span-2">
              <button class="bg-gray-900 text-white px-4 py-2 rounded text-sm hover:bg-gray-700">
                Přidat přístup
              </button>
            </div>
          </form>
        </details>
      </div>

      {/* Danger zone */}
      <div class="bg-white rounded-lg border border-red-200 p-5">
        <h3 class="text-lg font-semibold mb-2 text-red-700">Nebezpečná zóna</h3>
        <p class="text-sm text-gray-600 mb-3">
          Smazání uživatele odstraní jeho session, e-mailové adresy a postup v lekcích. Nákupy zůstanou
          v historii (bez vazby na účet).
        </p>
        {isSelf ? (
          <p class="text-sm text-gray-500 italic">Vlastní účet nelze smazat.</p>
        ) : (
          <form
            method="post"
            action={`/admin/users/${user.id}/delete`}
            onsubmit={`return confirm('Opravdu smazat ${user.email}? Tuto akci nelze vrátit.');`}
          >
            <button class="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700">
              Smazat uživatele
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
