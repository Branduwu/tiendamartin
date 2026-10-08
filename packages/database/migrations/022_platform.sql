BEGIN;
CREATE ROLE smartretail_platform_guard NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT smartretail_platform_guard TO smartretail_owner;
-- Only Auth identity columns, never passwords, tokens or Auth mutations.
GRANT USAGE ON SCHEMA auth TO smartretail_platform_guard;
GRANT SELECT(id,email) ON auth.users TO smartretail_platform_guard;
SET LOCAL ROLE smartretail_owner;
GRANT USAGE,CREATE ON SCHEMA retail TO smartretail_platform_guard;
GRANT EXECUTE ON FUNCTION retail.is_active_member(),retail.has_permission(text),retail.has_location_access(uuid) TO smartretail_platform_guard;
ALTER TABLE retail.tenants ADD COLUMN display_name text NOT NULL DEFAULT 'Empresa existente' CHECK(retail.settings_text(display_name,120)),
 ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN('active','suspended')),
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();
UPDATE retail.tenants t SET display_name=coalesce(p.trade_name,p.business_name) FROM retail.business_profiles p WHERE p.tenant_id=t.tenant_id;
CREATE TABLE retail.platform_admins(user_id uuid PRIMARY KEY,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE retail.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.platform_admins FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_self ON retail.platform_admins FOR SELECT TO smartretail_app USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid AND active);
CREATE POLICY platform_guard_admin ON retail.platform_admins FOR SELECT TO smartretail_platform_guard USING(true);
GRANT SELECT ON retail.platform_admins TO smartretail_app,smartretail_platform_guard;
CREATE FUNCTION retail.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
 SELECT EXISTS(SELECT 1 FROM retail.platform_admins WHERE user_id=nullif(current_setting('app.user_id',true),'')::uuid AND active);
$$;
REVOKE ALL ON FUNCTION retail.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.is_platform_admin() TO smartretail_app,smartretail_platform_guard;
CREATE FUNCTION retail.require_platform_admin() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 PERFORM 1 FROM retail.platform_admins WHERE user_id=nullif(current_setting('app.user_id',true),'')::uuid AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Platform denied' USING ERRCODE='42501'; END IF;
END $$;
-- Locking the admin row requires UPDATE privilege, without an update policy.
GRANT UPDATE(active) ON retail.platform_admins TO smartretail_platform_guard;
CREATE POLICY platform_guard_admin_lock ON retail.platform_admins FOR UPDATE TO smartretail_platform_guard USING(true) WITH CHECK(false);
CREATE POLICY platform_tenants ON retail.tenants TO smartretail_platform_guard USING(true) WITH CHECK(true);
ALTER POLICY tenant_member ON retail.tenants USING(CASE WHEN current_user='smartretail_platform_guard' THEN true ELSE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member() END) WITH CHECK(CASE WHEN current_user='smartretail_platform_guard' THEN true ELSE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member() END);
ALTER POLICY tenant_read ON retail.tenants TO smartretail_app;
GRANT SELECT,INSERT,UPDATE(status) ON retail.tenants TO smartretail_platform_guard;
CREATE FUNCTION retail.tenant_operational(tid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
 SELECT EXISTS(SELECT 1 FROM retail.tenants t JOIN retail.tenant_memberships m ON m.tenant_id=t.tenant_id WHERE t.tenant_id=tid AND t.status='active' AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.status='active');
$$;
-- Even the operational boolean requires this subject's own active membership.
CREATE OR REPLACE FUNCTION retail.is_active_member() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
 SELECT retail.tenant_operational(nullif(current_setting('app.tenant_id',true),'')::uuid) AND EXISTS(SELECT 1 FROM retail.tenant_memberships WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND status='active');
$$;
CREATE OR REPLACE FUNCTION retail.has_permission(requested text) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
 SELECT retail.is_active_member() AND EXISTS(SELECT 1 FROM retail.tenant_memberships m JOIN retail.role_permissions p ON p.role=m.role WHERE m.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.status='active' AND p.permission=requested);
$$;
CREATE OR REPLACE FUNCTION retail.has_location_access(lid uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE member_role text;
BEGIN
 IF NOT retail.tenant_operational(nullif(current_setting('app.tenant_id',true),'')::uuid) THEN RETURN false; END IF;
 SELECT role INTO member_role FROM retail.tenant_memberships WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND status='active';
 RETURN coalesce(member_role IN('owner','admin') OR (member_role IS NOT NULL AND EXISTS(SELECT 1 FROM retail.member_locations WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND location_id=lid)),false);
END $$;
ALTER FUNCTION retail.has_location_access(uuid) OWNER TO smartretail_members_guard;
CREATE POLICY platform_members ON retail.tenant_memberships TO smartretail_platform_guard USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON retail.tenant_memberships TO smartretail_platform_guard;
CREATE POLICY platform_branches ON retail.inventory_locations FOR SELECT TO smartretail_platform_guard USING(true);
ALTER POLICY tenant_member ON retail.inventory_locations USING(CASE WHEN current_user='smartretail_platform_guard' THEN true ELSE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member() END);
ALTER POLICY location_assignment ON retail.inventory_locations USING(CASE WHEN current_user IN('smartretail_members_guard','smartretail_platform_guard') THEN true ELSE retail.has_location_access(id) END);
GRANT SELECT ON retail.inventory_locations,retail.business_profiles TO smartretail_platform_guard;
CREATE POLICY platform_profile ON retail.business_profiles TO smartretail_platform_guard USING(true) WITH CHECK(true);
ALTER POLICY profile_tenant ON retail.business_profiles USING(CASE WHEN current_user='smartretail_platform_guard' THEN true ELSE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member() END) WITH CHECK(CASE WHEN current_user='smartretail_platform_guard' THEN true ELSE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member() END);
GRANT INSERT ON retail.business_profiles TO smartretail_platform_guard;
GRANT EXECUTE ON FUNCTION retail.settings_text(text,integer) TO smartretail_platform_guard;
CREATE TABLE retail.platform_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES retail.tenants,user_id uuid NOT NULL REFERENCES retail.platform_admins,
 action text NOT NULL CHECK(action IN('company.created','company.suspended','company.reactivated','owner.assigned')),correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object'),command_id uuid,
 CHECK((action IN('company.suspended','company.reactivated'))=(command_id IS NOT NULL)));
CREATE INDEX platform_audit_company ON retail.platform_audit(tenant_id,created_at DESC);
CREATE UNIQUE INDEX platform_status_command ON retail.platform_audit(user_id,command_id) WHERE command_id IS NOT NULL;
ALTER TABLE retail.platform_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.platform_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_audit_guard ON retail.platform_audit TO smartretail_platform_guard USING(true) WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::uuid AND retail.is_platform_admin() AND created_tx=pg_current_xact_id());
GRANT SELECT,INSERT ON retail.platform_audit TO smartretail_platform_guard;
CREATE TRIGGER platform_audit_immutable BEFORE UPDATE OR DELETE ON retail.platform_audit FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE FUNCTION retail.platform_initial_profile(tid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
 SELECT retail.is_platform_admin() AND EXISTS(SELECT 1 FROM retail.platform_audit WHERE tenant_id=tid AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND action='company.created' AND created_tx=pg_current_xact_id());
$$;
-- A company created by platform may have a different owner. Its atomic platform
-- audit replaces the tenant-settings audit for this one initial profile insert.
CREATE OR REPLACE FUNCTION retail.audit_business_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE changes jsonb; before_row jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper) THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='business_profiles' AND retail.platform_initial_profile(NEW.tenant_id) THEN RETURN NEW; END IF;
 before_row=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
 SELECT coalesce(jsonb_agg(key ORDER BY key),'[]'::jsonb) INTO changes FROM jsonb_each(to_jsonb(NEW)) WHERE key<>'tenant_id' AND value IS DISTINCT FROM before_row->key;
 IF changes='[]'::jsonb THEN RETURN NEW; END IF;
 INSERT INTO retail.settings_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,fields) VALUES(NEW.tenant_id,nullif(current_setting('app.user_id',true),'')::uuid,CASE WHEN TG_TABLE_NAME='business_profiles' THEN 'business.settings' ELSE 'branch.settings' END,CASE WHEN TG_TABLE_NAME='business_profiles' THEN NEW.tenant_id ELSE (to_jsonb(NEW)->>'id')::uuid END,nullif(current_setting('app.correlation_id',true),'')::uuid,changes);
 RETURN NEW;
END $$;
ALTER FUNCTION retail.audit_business_settings() OWNER TO smartretail_settings_guard;
CREATE FUNCTION retail.lock_operational_tenant() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE tid uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 PERFORM 1 FROM retail.tenants WHERE tenant_id=tid AND status='active' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM retail.tenant_memberships WHERE tenant_id=tid AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND status='active') THEN RAISE EXCEPTION 'Tenant operation denied' USING ERRCODE='42501'; END IF;
END $$;
CREATE OR REPLACE FUNCTION retail.lock_membership() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 PERFORM retail.lock_operational_tenant();
 PERFORM 1 FROM retail.tenant_memberships WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Membership denied' USING ERRCODE='42501'; END IF;
END $$;
ALTER FUNCTION retail.lock_membership() OWNER TO smartretail_members_guard;
CREATE FUNCTION retail.tenant_write_gate() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF current_user='smartretail_platform_guard' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper) THEN RETURN NULL; END IF;
 PERFORM retail.lock_operational_tenant(); RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION retail.tenant_write_gate() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name WHERE c.table_schema='retail' AND c.column_name='tenant_id' AND t.table_type='BASE TABLE' AND c.table_name NOT IN('tenants','platform_audit') LOOP
 EXECUTE format('CREATE TRIGGER tenant_operation_gate BEFORE INSERT OR UPDATE OR DELETE ON retail.%I FOR EACH STATEMENT EXECUTE FUNCTION retail.tenant_write_gate()',t);
 END LOOP;
END $$;
-- SQL entry points also acquire the tenant before resource/advisory locks.
-- Existing definitions, owners and grants are retained; only the first BEGIN
-- gains the same transaction-scoped gate used by adapters.
DO $$ DECLARE signature text; definition text; BEGIN
 FOREACH signature IN ARRAY ARRAY['lock_cash_shift(uuid)','lock_suspended_sale(uuid,uuid)','cancel_suspended_sale(uuid)','lock_sale_for_return(uuid)','lock_coupon(uuid)','lock_sale_customer(uuid)','lock_return_receivable(uuid)','validate_customer_credit(uuid,bigint)','collect_receivable(uuid,uuid,text,bigint,uuid,uuid)','pay_supplier(uuid,uuid,text,bigint,uuid,uuid)','create_expense(uuid,text,text,bigint,text,uuid,uuid,uuid)'] LOOP
 definition:=pg_get_functiondef(('retail.'||signature)::regprocedure);
 IF definition !~* '\mBEGIN\M' THEN RAISE EXCEPTION 'Unexpected operational function body'; END IF;
 EXECUTE regexp_replace(definition,'\mBEGIN\M',E'BEGIN\n PERFORM retail.lock_operational_tenant();','i');
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION retail.lock_balance(product uuid,location uuid) RETURNS SETOF retail.stock_balances LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 PERFORM retail.lock_operational_tenant();
 RETURN QUERY SELECT * FROM retail.stock_balances WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND product_id=product AND location_id=location FOR UPDATE;
END $$;
CREATE FUNCTION retail.membership_tenants() RETURNS TABLE(tenant_id uuid,display_name text,status text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
 SELECT t.tenant_id,t.display_name,t.status FROM retail.tenants t JOIN retail.tenant_memberships m ON m.tenant_id=t.tenant_id WHERE m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.status='active';
$$;
CREATE FUNCTION retail.platform_companies(page integer DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE result jsonb;
BEGIN
 PERFORM retail.require_platform_admin();IF page NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='23514'; END IF;
 SELECT jsonb_build_object('summary',jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE status='active'),'suspended',count(*) FILTER(WHERE status='suspended'))) INTO result FROM retail.tenants;
 RETURN result||jsonb_build_object('companies',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(SELECT t.tenant_id AS id,t.display_name AS "displayName",t.status,t.created_at AS "createdAt",(SELECT count(*) FROM retail.tenant_memberships m WHERE m.tenant_id=t.tenant_id) AS "userCount",coalesce((SELECT string_agg(coalesce(m.display_name,'Propietario'),', ' ORDER BY m.user_id) FROM retail.tenant_memberships m WHERE m.tenant_id=t.tenant_id AND m.role='owner'),'Sin propietario') AS owner FROM retail.tenants t ORDER BY t.created_at DESC,t.tenant_id LIMIT 50 OFFSET (page-1)*50)x),'[]'::jsonb));
END $$;
CREATE FUNCTION retail.platform_company(tid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE result jsonb;
BEGIN
 PERFORM retail.require_platform_admin();SELECT jsonb_build_object('id',tenant_id,'displayName',display_name,'status',status,'createdAt',created_at) INTO result FROM retail.tenants WHERE tenant_id=tid;
 IF result IS NULL THEN RAISE EXCEPTION 'Company unavailable' USING ERRCODE='P0002'; END IF;
 RETURN result||jsonb_build_object('profile',(SELECT jsonb_build_object('businessName',business_name,'tradeName',trade_name,'timezone',timezone,'currency',currency) FROM retail.business_profiles WHERE tenant_id=tid),
 'members',coalesce((SELECT jsonb_agg(jsonb_build_object('name',coalesce(display_name,'Usuario'),'role',role,'status',status) ORDER BY role,user_id) FROM retail.tenant_memberships WHERE tenant_id=tid),'[]'::jsonb),
 'branches',coalesce((SELECT jsonb_agg(jsonb_build_object('name',coalesce(display_name,name),'status',status) ORDER BY name,id) FROM retail.inventory_locations WHERE tenant_id=tid),'[]'::jsonb));
END $$;
CREATE FUNCTION retail.platform_auth_users(search text DEFAULT '',page integer DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 PERFORM retail.require_platform_admin();IF search IS NULL OR length(search)>254 OR page NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='23514'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(SELECT id,email FROM auth.users WHERE email IS NOT NULL AND strpos(lower(email),lower(search))>0 ORDER BY id LIMIT 50 OFFSET(page-1)*50)x),'[]'::jsonb);
END $$;
CREATE FUNCTION retail.platform_create_company(tid uuid,name text,owner_id uuid,correlation uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 PERFORM retail.require_platform_admin();IF tid IS NULL OR owner_id IS NULL OR correlation IS NULL OR name IS NULL OR NOT retail.settings_text(name,120) THEN RAISE EXCEPTION 'Invalid company' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(tid::text,31));
 IF EXISTS(SELECT 1 FROM retail.tenants WHERE tenant_id=tid) THEN
  IF EXISTS(SELECT 1 FROM retail.platform_audit a JOIN retail.tenants t ON t.tenant_id=a.tenant_id WHERE a.tenant_id=tid AND a.action='company.created' AND a.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND a.metadata->>'ownerUserId'=owner_id::text AND t.display_name=name) THEN RETURN tid; END IF;
  RAISE EXCEPTION 'Company intent conflict' USING ERRCODE='P0001';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=owner_id) THEN RAISE EXCEPTION 'Auth owner unavailable' USING ERRCODE='23514'; END IF;
 INSERT INTO retail.tenants(tenant_id,display_name) VALUES(tid,name);
 INSERT INTO retail.tenant_memberships(tenant_id,user_id,role,status,display_name) VALUES(tid,owner_id,'owner','active','Propietario');
 INSERT INTO retail.platform_audit(tenant_id,user_id,action,correlation_id,metadata) VALUES(tid,nullif(current_setting('app.user_id',true),'')::uuid,'company.created',correlation,jsonb_build_object('ownerUserId',owner_id));
 INSERT INTO retail.business_profiles(tenant_id,business_name) VALUES(tid,name);
 INSERT INTO retail.platform_audit(tenant_id,user_id,action,correlation_id,metadata) VALUES(tid,nullif(current_setting('app.user_id',true),'')::uuid,'owner.assigned',correlation,jsonb_build_object('ownerUserId',owner_id));
 RETURN tid;
END $$;
CREATE FUNCTION retail.platform_company_status(tid uuid,newstatus text,correlation uuid,command uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE oldstatus text; prior retail.platform_audit; actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid;
BEGIN
 PERFORM retail.require_platform_admin();IF newstatus IS NULL OR newstatus NOT IN('active','suspended') OR correlation IS NULL OR command IS NULL THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||'/'||command::text,32));
 SELECT * INTO prior FROM retail.platform_audit WHERE user_id=actor AND command_id=command;
 IF FOUND THEN
  IF prior.tenant_id<>tid OR prior.action<>(CASE WHEN newstatus='suspended' THEN 'company.suspended' ELSE 'company.reactivated' END) THEN RAISE EXCEPTION 'Status intent conflict' USING ERRCODE='P0001'; END IF;
  RETURN;
 END IF;
 SELECT status INTO oldstatus FROM retail.tenants WHERE tenant_id=tid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company unavailable' USING ERRCODE='P0002'; END IF;
 IF newstatus<>oldstatus THEN UPDATE retail.tenants SET status=newstatus WHERE tenant_id=tid; END IF;
 INSERT INTO retail.platform_audit(tenant_id,user_id,action,correlation_id,command_id,metadata) VALUES(tid,actor,CASE WHEN newstatus='suspended' THEN 'company.suspended' ELSE 'company.reactivated' END,correlation,command,jsonb_build_object('previousStatus',oldstatus,'changed',newstatus<>oldstatus));
END $$;
DO $$ DECLARE signature text; guard text; BEGIN
 FOREACH signature IN ARRAY ARRAY['require_platform_admin()','tenant_operational(uuid)','platform_initial_profile(uuid)','lock_operational_tenant()','membership_tenants()','platform_companies(integer)','platform_company(uuid)','platform_auth_users(text,integer)','platform_create_company(uuid,text,uuid,uuid)','platform_company_status(uuid,text,uuid,uuid)'] LOOP
 EXECUTE 'ALTER FUNCTION retail.'||signature||' OWNER TO smartretail_platform_guard';EXECUTE 'REVOKE ALL ON FUNCTION retail.'||signature||' FROM PUBLIC'; END LOOP;
 FOR guard IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'smartretail_%guard' OR rolname IN('smartretail_app','smartretail_owner') LOOP
 EXECUTE format('GRANT EXECUTE ON FUNCTION retail.tenant_operational(uuid),retail.lock_operational_tenant() TO %I',guard);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION retail.platform_initial_profile(uuid) TO smartretail_settings_guard;
GRANT EXECUTE ON FUNCTION retail.membership_tenants(),retail.platform_companies(integer),retail.platform_company(uuid),retail.platform_auth_users(text,integer),retail.platform_create_company(uuid,text,uuid,uuid),retail.platform_company_status(uuid,text,uuid,uuid) TO smartretail_app;
REVOKE CREATE ON SCHEMA retail FROM smartretail_platform_guard;
-- Supabase Auth already enables RLS. Preserve it and expose only existing
-- identities to the non-login guard while the verified actor is platform admin.
-- Column grants above still limit reads to id/email; runtime cannot inherit it.
RESET ROLE;
CREATE POLICY platform_existing_owner ON auth.users FOR SELECT TO smartretail_platform_guard USING(retail.is_platform_admin());
COMMIT;
