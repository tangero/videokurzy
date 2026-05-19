-- Oprava 0014 backfillu: pending objednávky ještě nezaplatily, takže jejich
-- amountPaid by mělo být 0, ne 1500. Předchozí migrace omylem nastavila
-- amountPaid=1500 i pro pending stavy (filtr byl jen na kind='paid').
-- Po FIO matchi se amountPaid stejně přepíše skutečnou částkou z tx.amount.

UPDATE `purchase` SET `amountPaid` = 0 WHERE `status` = 'pending';
