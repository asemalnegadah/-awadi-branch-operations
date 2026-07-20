BEGIN;

DO $$
DECLARE
  system_admin_grants integer;
  has_create_payload boolean;
  guard_trigger_count integer;
BEGIN
  SELECT COUNT(*)
  INTO system_admin_grants
  FROM role_permissions AS role_permission
  JOIN roles AS role ON role.id = role_permission.role_id
  JOIN permissions AS permission ON permission.id = role_permission.permission_id
  WHERE role.code = 'SYSTEM_ADMIN'
    AND permission.code IN ('promises.read', 'promises.view_history');

  IF system_admin_grants <> 0 THEN
    RAISE EXCEPTION 'SYSTEM_ADMIN must not receive promise business access by default';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_promises'
      AND column_name = 'create_payload'
      AND data_type = 'jsonb'
  ) INTO has_create_payload;

  IF NOT has_create_payload THEN
    RAISE EXCEPTION 'payment_promises.create_payload is missing';
  END IF;

  SELECT COUNT(*)
  INTO guard_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'collections'::regclass
    AND tgname = 'a_collections_guard_promise_allocations_before_reversal'
    AND NOT tgisinternal;

  IF guard_trigger_count <> 1 THEN
    RAISE EXCEPTION 'collection promise-allocation reversal guard is missing';
  END IF;
END;
$$;

ROLLBACK;
