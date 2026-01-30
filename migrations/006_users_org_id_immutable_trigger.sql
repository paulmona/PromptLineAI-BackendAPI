-- Enforce B2B invariant: users.org_id must not be updated when external_uid is set.
-- A user (external_uid) is permanently linked to one org; no code path may change org_id.
-- Idempotent: drops and recreates the trigger/function if they exist.

CREATE OR REPLACE FUNCTION public.users_prevent_org_id_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.external_uid IS NOT NULL AND (TG_OP = 'UPDATE' AND OLD.org_id IS DISTINCT FROM NEW.org_id) THEN
    RAISE EXCEPTION 'org_id cannot be updated when external_uid is set (user is permanently linked to one org)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_prevent_org_id_update_trigger ON public.users;

CREATE TRIGGER users_prevent_org_id_update_trigger
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.users_prevent_org_id_update();
