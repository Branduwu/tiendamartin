-- The managed migration login has SET but does not inherit the owner role.
-- Revoke as the effective owner; its earlier creator-context REVOKE was a noop.
BEGIN;
SET LOCAL ROLE smartretail_owner;
REVOKE ALL ON FUNCTION retail.platform_existing_auth_users() FROM PUBLIC;
DO $$ BEGIN
 IF has_function_privilege('smartretail_app','retail.platform_existing_auth_users()','EXECUTE')
 OR has_function_privilege('smartretail_api','retail.platform_existing_auth_users()','EXECUTE')
 THEN RAISE EXCEPTION 'Private Auth helper must not be executable by runtime'; END IF;
END $$;
COMMIT;
