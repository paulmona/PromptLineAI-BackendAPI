-- Backfill events.user_id from devices.user_id for historical events.
-- Only updates rows where events.user_id IS NULL and the device has a non-null user_id.
-- Safe to run multiple times (idempotent).

UPDATE events
SET user_id = d.user_id
FROM devices d
WHERE events.device_id = d.id
  AND events.user_id IS NULL
  AND d.user_id IS NOT NULL;
