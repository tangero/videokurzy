import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export const userEmails = sqliteTable(
  "user_emails",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
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
