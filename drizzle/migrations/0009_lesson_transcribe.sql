ALTER TABLE `lesson` ADD `transcribeStatus` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `lesson` ADD `transcribedAt` integer;
--> statement-breakpoint
ALTER TABLE `lesson` ADD `transcript` text;
