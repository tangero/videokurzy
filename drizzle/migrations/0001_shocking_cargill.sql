PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_purchase` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`userId` text,
	`courseId` integer NOT NULL,
	`type` text NOT NULL,
	`stripePaymentId` text NOT NULL,
	`stripeSubscriptionId` text,
	`status` text DEFAULT 'active' NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`courseId`) REFERENCES `course`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_purchase`("id", "email", "userId", "courseId", "type", "stripePaymentId", "stripeSubscriptionId", "status", "expiresAt", "createdAt") SELECT "id", "email", "userId", "courseId", "type", "stripePaymentId", "stripeSubscriptionId", "status", "expiresAt", "createdAt" FROM `purchase`;--> statement-breakpoint
DROP TABLE `purchase`;--> statement-breakpoint
ALTER TABLE `__new_purchase` RENAME TO `purchase`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_stripePaymentId_unique` ON `purchase` (`stripePaymentId`);