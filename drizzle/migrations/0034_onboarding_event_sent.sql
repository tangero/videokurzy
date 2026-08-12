-- Kdy byla doručena onboardingová Resend automation událost (`purchase.completed`).
--
-- Bez tohoto sloupce se odeslání události odvozovalo z toho, zda insert nákupu
-- vrátil řádek. To ale zaměňuje „nákup byl vložen" za „událost byla doručena":
-- když insert projde a odeslání události selže (sendResendEvent chyby polyká),
-- retry už řádek nevloží, guard událost přeskočí a onboarding se neodešle nikdy.
--
-- NULL = událost zatím neodešla (nebo jde o nákup z doby před touto migrací,
-- kde už proběhla po staru — proto se pro existující řádky needituje).
ALTER TABLE `purchase` ADD `onboardingEventSentAt` integer;
