-- Seed data: kurz.vibecoding.cz
-- Run with: wrangler d1 execute videokurzy-db --local --file=scripts/seed.sql

-- Course: Claude Code s Patrickem
INSERT OR REPLACE INTO course (id, title, slug, description, published) VALUES
  (1, 'Claude Code s Patrickem', 'claude-code-s-patrickem', 'Videokurz vibe codingu. Od nápadu po hotovou aplikaci v 10 epizodách. Naučte se stavět aplikace s AI, i když nejste programátor.', 1);

-- Module 1: Začínáme (free preview)
INSERT OR REPLACE INTO module (id, courseId, title, slug, sortOrder) VALUES
  (1, 1, 'Začínáme', 'zaciname', 1);

-- Module 2: Stavíme aplikaci
INSERT OR REPLACE INTO module (id, courseId, title, slug, sortOrder) VALUES
  (2, 1, 'Stavíme aplikaci', 'stavime-aplikaci', 2);

-- Module 3: Produkce a polish
INSERT OR REPLACE INTO module (id, courseId, title, slug, sortOrder) VALUES
  (3, 1, 'Produkce a polish', 'produkce-a-polish', 3);

-- Lessons - Module 1: Začínáme (free preview)
INSERT OR REPLACE INTO lesson (id, moduleId, publicId, title, slug, bunnyVideoId, durationSeconds, isFree, sortOrder) VALUES
  (1, 1, 'ep01_napad_prd', 'Od nápadu k profi zadání (PRD s Cowork)', 'od-napadu-k-profi-zadani', NULL, 0, 1, 1),
  (2, 1, 'ep02_appka_20min', 'Postav appku za 20 minut (ten „wow" moment)', 'postav-appku-za-20-minut', NULL, 0, 1, 2),
  (3, 1, 'ep03_prvni_funkce', 'První funkce, která opravdu funguje', 'prvni-funkce-ktera-funguje', NULL, 0, 1, 3);

-- Lessons - Module 2: Stavíme aplikaci
INSERT OR REPLACE INTO lesson (id, moduleId, publicId, title, slug, bunnyVideoId, durationSeconds, isFree, sortOrder) VALUES
  (4, 2, 'ep04_design', 'Krásný design na prvním místě (moodboard + vizuální magie)', 'krasny-design', NULL, 0, 0, 1),
  (5, 2, 'ep05_data', 'Data a paměť tvé appky', 'data-a-pamet', NULL, 0, 0, 2),
  (6, 2, 'ep06_debugging', 'Když se to rozbije – jak to opravit rychle', 'kdyz-se-to-rozbije', NULL, 0, 0, 3),
  (7, 2, 'ep07_api', 'Připojení k světu (API a integrace)', 'pripojeni-k-svetu', NULL, 0, 0, 4);

-- Lessons - Module 3: Produkce a polish
INSERT OR REPLACE INTO lesson (id, moduleId, publicId, title, slug, bunnyVideoId, durationSeconds, isFree, sortOrder) VALUES
  (8, 3, 'ep08_auth', 'Bezpečnost a přihlášení bez bolesti', 'bezpecnost-a-prihlaseni', NULL, 0, 0, 1),
  (9, 3, 'ep09_deploy', 'Nahraj to na internet (deployment)', 'nahraj-to-na-internet', NULL, 0, 0, 2),
  (10, 3, 'ep10_final', 'Finální lesk a co dál (údržba, vylepšení, limity)', 'finalni-lesk-a-co-dal', NULL, 0, 0, 3);

-- ─── Admin uživatelé ────────────────────────────────────────────────
-- Admini (patrick@vibecoding.cz, andrea@vibecoding.cz) jsou spravováni
-- automaticky v src/middleware/auth.ts přes ADMIN_EMAILS whitelist.
-- Po prvním přihlášení magic linkem Better Auth vytvoří user record
-- a middleware mu nastaví role = 'admin'.
-- Seed zde proto nevytváří žádné user záznamy (bránilo by to signupu
-- přes Better Auth kvůli UNIQUE(email) kolizi s pre-seed ID).
