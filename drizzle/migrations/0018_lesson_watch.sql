CREATE TABLE `lesson_watch` (
	`userId` text NOT NULL,
	`lessonId` integer NOT NULL,
	`maxSegment` integer DEFAULT 0 NOT NULL,
	`watchedSeconds` integer DEFAULT 0 NOT NULL,
	`startedAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `lessonId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lessonId`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE cascade
);
