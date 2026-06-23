-- Úvodník vydání „Novinky v Claude Code". Markdown osobní komentář redaktora,
-- který se vkládá POUZE do rozesílaného newsletteru (ne na web /novinky-cc).
-- Ukládá se k řádce vydání, edituje se v adminu /admin/newsletter.
ALTER TABLE `cc_news_item` ADD `editorialMarkdown` text;
