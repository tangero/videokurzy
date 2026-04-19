CREATE UNIQUE INDEX `user_emails_one_primary_per_user` ON `user_emails` (`userId`) WHERE `isPrimary` = 1;
