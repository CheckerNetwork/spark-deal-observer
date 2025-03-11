ALTER TABLE active_deals
ADD COLUMN reverted BOOLEAN;

UPDATE active_deals SET reverted = FALSE;

ALTER TABLE active_deals
ALTER COLUMN reverted SET NOT NULL;