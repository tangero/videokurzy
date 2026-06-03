CREATE TABLE `discount_invite` (
	`token` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`percent` integer NOT NULL,
	`label` text,
	`expiresAt` integer,
	`createdAt` integer NOT NULL,
	`batch` text,
	`usedAt` integer,
	`usedByPurchaseId` integer
);
--> statement-breakpoint
CREATE INDEX `discount_invite_batch_idx` ON `discount_invite` (`batch`);
