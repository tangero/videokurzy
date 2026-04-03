-- Seed data: Claude Code s Patrickem videokurz
-- Run with: wrangler d1 execute videokurzy-db --local --file=scripts/seed.sql

-- Course
INSERT OR IGNORE INTO course (id, title, slug, description, published) VALUES
  (1, 'Claude Code s Patrickem', 'claude-code-s-patrickem', 'Videokurz vibe codingu. Od nápadu po hotovou aplikaci v 10 epizodách.', 1);

-- Module 1: Začínáme
INSERT OR IGNORE INTO module (id, courseId, title, slug, sortOrder) VALUES
  (1, 1, 'Začínáme', 'zaciname', 1);

-- Module 2: Stavíme aplikaci
INSERT OR IGNORE INTO module (id, courseId, title, slug, sortOrder) VALUES
  (2, 1, 'Stavíme aplikaci', 'stavime-aplikaci', 2);

-- Module 3: Produkce a polish
INSERT OR IGNORE INTO module (id, courseId, title, slug, sortOrder) VALUES
  (3, 1, 'Produkce a polish', 'produkce-a-polish', 3);

-- Lessons - Module 1
INSERT OR IGNORE INTO lesson (id, moduleId, publicId, title, slug, bunnyVideoId, durationSeconds, isFree, sortOrder) VALUES
  (1, 1, 'ep01_napad_zadani', 'Ep. 1: Nápad a zadání', 'napad-a-zadani', NULL, 0, 1, 1),
  (2, 1, 'ep02_kostra_appky', 'Ep. 2: Kostra aplikace za 20 minut', 'kostra-aplikace', NULL, 0, 1, 2),
  (3, 1, 'ep03_prvni_feature', 'Ep. 3: První feature a iterace', 'prvni-feature', NULL, 0, 0, 3);

-- Lessons - Module 2
INSERT OR IGNORE INTO lesson (id, moduleId, publicId, title, slug, bunnyVideoId, durationSeconds, isFree, sortOrder) VALUES
  (4, 2, 'ep04_databaze', 'Ep. 4: Databáze a data', 'databaze-a-data', NULL, 0, 0, 1),
  (5, 2, 'ep05_rozbije_se', 'Ep. 5: Když se to rozbije', 'kdyz-se-to-rozbije', NULL, 0, 0, 2),
  (6, 2, 'ep06_api', 'Ep. 6: API a integrace', 'api-a-integrace', NULL, 0, 0, 3),
  (7, 2, 'ep07_auth', 'Ep. 7: Autentizace a bezpečnost', 'autentizace-a-bezpecnost', NULL, 0, 0, 4);

-- Lessons - Module 3
INSERT OR IGNORE INTO lesson (id, moduleId, publicId, title, slug, bunnyVideoId, durationSeconds, isFree, sortOrder) VALUES
  (8, 3, 'ep08_deployment', 'Ep. 8: Deployment', 'deployment', NULL, 0, 0, 1),
  (9, 3, 'ep09_design', 'Ep. 9: Design — moodboard a vizuální identita', 'design', NULL, 0, 0, 2),
  (10, 3, 'ep10_co_dal', 'Ep. 10: Co dál — údržba, vylepšení, limity', 'co-dal', NULL, 0, 0, 3);
