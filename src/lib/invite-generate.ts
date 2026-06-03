// Čistá logika generátoru invite tokenů — bez I/O, aby šla testovat.
// CLI obálka (scripts/discount-invites/generate.mjs) řeší čtení CSV a zápis souborů.

export interface BuildInviteOptions {
  percent: number;
  batch: string;
  label: string | null;
  expiresAt: Date | null;
  baseUrl: string;
  now: Date;
  genToken: () => string;
}

export interface InviteRow {
  email: string;
  token: string;
  url: string;
}

export interface BuildInviteResult {
  rows: InviteRow[];
  sql: string;
}

function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function sqlTimestamp(d: Date | null): string {
  // Drizzle timestamp mode ukládá unix epoch v SEKUNDÁCH.
  return d ? String(Math.floor(d.getTime() / 1000)) : "NULL";
}

export function buildInviteRows(
  emails: string[],
  opts: BuildInviteOptions,
): BuildInviteResult {
  const seen = new Set<string>();
  const rows: InviteRow[] = [];

  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const token = opts.genToken();
    rows.push({
      email,
      token,
      url: `${opts.baseUrl}/checkout/individual?invite=${token}`,
    });
  }

  const createdAt = sqlTimestamp(opts.now);
  const expiresAt = sqlTimestamp(opts.expiresAt);
  const label = opts.label === null ? "NULL" : sqlString(opts.label);
  const batch = sqlString(opts.batch);

  const values = rows
    .map(
      (r) =>
        `  (${sqlString(r.token)}, ${sqlString(r.email)}, ${opts.percent}, ${label}, ${expiresAt}, ${createdAt}, ${batch}, NULL, NULL)`,
    )
    .join(",\n");

  const sql =
    rows.length === 0
      ? "-- žádné e-maily\n"
      : `INSERT INTO discount_invite (token, email, percent, label, expiresAt, createdAt, batch, usedAt, usedByPurchaseId) VALUES\n${values};\n`;

  return { rows, sql };
}
