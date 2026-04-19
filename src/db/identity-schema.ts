import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export const userEmails = sqliteTable(
  "user_emails",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // COLLATE NOCASE is applied manually in migration 0004 SQL for
    // case-insensitive UNIQUE. Drizzle has no first-class support for
    // SQLite COLLATE, so if you regenerate the migration via `db:generate`,
    // re-add `COLLATE NOCASE` to this column before applying.
    email: text("email").notNull().unique(),
    verifiedAt: integer("verifiedAt", { mode: "timestamp" }).notNull(),
    isPrimary: integer("isPrimary", { mode: "boolean" }).notNull().default(false),
    addedAt: integer("addedAt", { mode: "timestamp" }).notNull(),
    addedVia: text("addedVia", {
      enum: ["signup", "self-add", "recovery", "admin"],
    }).notNull(),
  },
  (t) => [index("idx_user_emails_user").on(t.userId)],
);

/**
 * Audit log of identity-related actions.
 *
 * Note: userId has no FK constraint on purpose — audit records must survive
 * user deletion for forensic and compliance (GDPR retention is handled
 * separately via a dedicated retention policy, not via CASCADE).
 */
export const userIdentityAudit = sqliteTable(
  "user_identity_audit",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    action: text("action", {
      enum: [
        "email_added",
        "email_removed",
        "email_promoted_primary",
        "email_verified",
        "recovery_approved",
        "recovery_banner_dismissed",
      ],
    }).notNull(),
    actor: text("actor").notNull(),
    details: text("details"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("idx_audit_user").on(t.userId, t.createdAt)],
);

export const oidcClient = sqliteTable("oidc_client", {
  id: text("id").primaryKey(),
  secretHash: text("secretHash").notNull(),
  name: text("name").notNull(),
  redirectUris: text("redirectUris").notNull(),
  allowedScopes: text("allowedScopes").notNull().default("openid profile email"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});
