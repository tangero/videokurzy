CREATE TABLE `video_stats` (
	`videoGuid` text PRIMARY KEY NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`watchTimeSeconds` integer DEFAULT 0 NOT NULL,
	`engagementScore` integer DEFAULT 0 NOT NULL,
	`syncedAt` integer NOT NULL
);
