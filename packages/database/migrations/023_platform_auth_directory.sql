-- Supabase reserves auth schema USAGE. A SQL-standard body resolves the two
-- authorized columns during migration, while execution still uses the NOLOGIN
-- guard's column privileges and RLS. No Auth secret or runtime bypass is added.
BEGIN;
SELECT set_config('smartretail.migration_admin',current_user,true),
 set_config('smartretail.migration_admin_create',has_schema_privilege(current_user,'retail','CREATE')::text,true);
SET LOCAL ROLE smartretail_owner;
DO $$ BEGIN
 IF current_setting('smartretail.migration_admin_create')='false' THEN
  EXECUTE format('GRANT CREATE ON SCHEMA retail TO %I',current_setting('smartretail.migration_admin'));
 END IF;
END $$;
GRANT CREATE ON SCHEMA retail TO smartretail_platform_guard;
RESET ROLE;
CREATE FUNCTION retail.platform_existing_auth_users() RETURNS TABLE(id uuid,email text)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,retail
 BEGIN ATOMIC
 SELECT u.id,u.email::text FROM auth.users u WHERE retail.is_platform_admin();
 END;
ALTER FUNCTION retail.platform_existing_auth_users() OWNER TO smartretail_platform_guard;
REVOKE ALL ON FUNCTION retail.platform_existing_auth_users() FROM PUBLIC;
SET LOCAL ROLE smartretail_owner;
-- Keep the same public functions and their internal platform authorization.
DO $$ DECLARE signature text; definition text; BEGIN
 FOREACH signature IN ARRAY ARRAY['platform_auth_users(text,integer)','platform_create_company(uuid,text,uuid,uuid)'] LOOP
 definition:=pg_get_functiondef(('retail.'||signature)::regprocedure);
 IF strpos(definition,'FROM auth.users')=0 THEN RAISE EXCEPTION 'Unexpected platform directory definition'; END IF;
 EXECUTE replace(definition,'FROM auth.users','FROM retail.platform_existing_auth_users()');
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA retail FROM smartretail_platform_guard;
DO $$ BEGIN
 IF current_setting('smartretail.migration_admin_create')='false' THEN
  EXECUTE format('REVOKE CREATE ON SCHEMA retail FROM %I',current_setting('smartretail.migration_admin'));
 END IF;
END $$;
COMMIT;
