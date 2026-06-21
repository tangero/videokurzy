-- Odhlášení z newsletteru „Novinky v Claude Code" (GDPR, W-007). Klíč je
-- emailHash = HMAC-SHA256(normalizovaný e-mail, účel) — žádné plain PII.
-- Samostatná tabulka, aby suppression přežil GDPR výmaz uživatele.
CREATE TABLE `newsletter_suppression` (
	`emailHash` text PRIMARY KEY NOT NULL,
	`newsletter` text DEFAULT 'claude_code_news' NOT NULL,
	`optedOutAt` integer NOT NULL,
	`source` text,
	`createdFromUserId` text
);
