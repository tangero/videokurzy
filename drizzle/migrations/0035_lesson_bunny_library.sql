-- Lekce může mít video v jiné Bunny Stream library než hlavní.
-- NULL = hlavní library (BUNNY_LIBRARY_ID), jinak ID z BUNNY_EXTRA_LIBRARIES.
ALTER TABLE `lesson` ADD COLUMN `bunnyLibraryId` text;
