CREATE TABLE `oidc_client` (
	`id` text PRIMARY KEY NOT NULL,
	`secretHash` text NOT NULL,
	`name` text NOT NULL,
	`redirectUris` text NOT NULL,
	`allowedScopes` text DEFAULT 'openid profile email' NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`email` text NOT NULL,
	`verifiedAt` integer NOT NULL,
	`isPrimary` integer DEFAULT false NOT NULL,
	`addedAt` integer NOT NULL,
	`addedVia` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_emails_email_unique` ON `user_emails` (`email`);--> statement-breakpoint
CREATE INDEX `idx_user_emails_user` ON `user_emails` (`userId`);--> statement-breakpoint
CREATE TABLE `user_identity_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`details` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_user` ON `user_identity_audit` (`userId`,`createdAt`);--> statement-breakpoint
ALTER TABLE `user` ADD `recoveryBannerDismissedUntil` integer;--> statement-breakpoint
-- Backfill: seed primary email records from existing user table
INSERT INTO user_emails (id, userId, email, verifiedAt, isPrimary, addedAt, addedVia)
SELECT
  lower(hex(randomblob(16))) AS id,
  u.id AS userId,
  u.email AS email,
  u.createdAt AS verifiedAt,
  1 AS isPrimary,
  u.createdAt AS addedAt,
  'signup' AS addedVia
FROM user u
WHERE NOT EXISTS (SELECT 1 FROM user_emails ue WHERE ue.userId = u.id);