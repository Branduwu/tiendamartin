BEGIN;
-- Resolve only the authenticated subject's verified email. Runtime cannot read
-- Auth or execute this private helper, and no Auth credentials are introduced.
GRANT SELECT(email_confirmed_at) ON auth.users TO smartretail_platform_guard;
CREATE POLICY onboarding_auth_self ON auth.users FOR SELECT TO smartretail_platform_guard
 USING(id=nullif(current_setting('app.user_id',true),'')::uuid AND email_confirmed_at IS NOT NULL);
SELECT set_config('smartretail.migration_admin',current_user,true),
 set_config('smartretail.migration_admin_create',has_schema_privilege(current_user,'retail','CREATE')::text,true);
SET LOCAL ROLE smartretail_owner;
DO $$ BEGIN IF current_setting('smartretail.migration_admin_create')='false' THEN
 EXECUTE format('GRANT CREATE ON SCHEMA retail TO %I',current_setting('smartretail.migration_admin'));
END IF; END $$;
GRANT CREATE ON SCHEMA retail TO smartretail_platform_guard;
RESET ROLE;
CREATE FUNCTION retail.onboarding_auth_email() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,retail
 BEGIN ATOMIC
 SELECT lower(u.email::text) FROM auth.users u WHERE u.id=nullif(current_setting('app.user_id',true),'')::uuid AND u.email_confirmed_at IS NOT NULL;
 END;
ALTER FUNCTION retail.onboarding_auth_email() OWNER TO smartretail_platform_guard;
SET LOCAL ROLE smartretail_owner;
REVOKE ALL ON FUNCTION retail.onboarding_auth_email() FROM PUBLIC;
ALTER TABLE retail.tenants ADD COLUMN creation_origin text NOT NULL DEFAULT 'managed' CHECK(creation_origin IN('managed','self-service'));
CREATE TABLE retail.onboarding_commands(
 user_id uuid PRIMARY KEY,command_id uuid NOT NULL UNIQUE,tenant_id uuid NOT NULL UNIQUE REFERENCES retail.tenants,
 location_id uuid NOT NULL,intent jsonb NOT NULL CHECK(octet_length(intent::text)<=4096),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES retail.tenant_memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id)
);
CREATE TABLE retail.tenant_invitations(
 tenant_id uuid NOT NULL REFERENCES retail.tenants,id uuid NOT NULL DEFAULT gen_random_uuid(),
 email text NOT NULL CHECK(length(email)<=254 AND email=lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
 role text NOT NULL CHECK(role IN('admin','cashier','inventory_clerk')),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 accepted_at timestamptz,accepted_by uuid,revoked_at timestamptz,
 PRIMARY KEY(tenant_id,id),UNIQUE(id),FOREIGN KEY(tenant_id,created_by) REFERENCES retail.tenant_memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,accepted_by) REFERENCES retail.tenant_memberships(tenant_id,user_id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '14 days'),
 CHECK((accepted_at IS NULL)=(accepted_by IS NULL)),CHECK(accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX invitation_company_created ON retail.tenant_invitations(tenant_id,created_at DESC);
CREATE TABLE retail.invitation_locations(
 tenant_id uuid NOT NULL,invitation_id uuid NOT NULL,location_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,invitation_id,location_id),
 FOREIGN KEY(tenant_id,invitation_id) REFERENCES retail.tenant_invitations(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id)
);
CREATE TABLE retail.onboarding_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES retail.tenants,actor_user_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('self_registration.completed','company.created','invitation.created','invitation.revoked','invitation.accepted')),
 entity_id uuid NOT NULL,correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,actor_user_id) REFERENCES retail.tenant_memberships(tenant_id,user_id)
);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['onboarding_commands','tenant_invitations','invitation_locations','onboarding_audit'] LOOP
 EXECUTE format('ALTER TABLE retail.%I ENABLE ROW LEVEL SECURITY',tbl);
 EXECUTE format('ALTER TABLE retail.%I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('CREATE POLICY onboarding_guard ON retail.%I TO smartretail_platform_guard USING(true) WITH CHECK(true)',tbl);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON retail.onboarding_commands,retail.invitation_locations,retail.onboarding_audit TO smartretail_platform_guard;
GRANT SELECT,INSERT,UPDATE(accepted_at,accepted_by,revoked_at) ON retail.tenant_invitations TO smartretail_platform_guard;
CREATE TRIGGER onboarding_command_immutable BEFORE UPDATE OR DELETE ON retail.onboarding_commands FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE TRIGGER onboarding_audit_immutable BEFORE UPDATE OR DELETE ON retail.onboarding_audit FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
GRANT INSERT,UPDATE(status) ON retail.inventory_locations TO smartretail_platform_guard;
GRANT SELECT ON retail.role_permissions TO smartretail_platform_guard;
CREATE POLICY onboarding_branch ON retail.inventory_locations FOR INSERT TO smartretail_platform_guard WITH CHECK(true);
CREATE POLICY onboarding_branch_lock ON retail.inventory_locations FOR UPDATE TO smartretail_platform_guard USING(true) WITH CHECK(false);
-- Retain restrictive branch checks for ordinary runtime sessions.
ALTER POLICY tenant_member ON retail.inventory_locations WITH CHECK(CASE WHEN current_user='smartretail_platform_guard' THEN true ELSE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member() END);
GRANT SELECT,INSERT ON retail.member_locations TO smartretail_platform_guard;
CREATE POLICY onboarding_assignments ON retail.member_locations TO smartretail_platform_guard USING(true) WITH CHECK(true);
GRANT EXECUTE ON FUNCTION retail.lock_membership() TO smartretail_platform_guard;

CREATE FUNCTION retail.self_onboard(command uuid,data jsonb,correlation uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid; previous retail.onboarding_commands;
 tid uuid:=gen_random_uuid(); lid uuid:=gen_random_uuid();
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Fresh authorization required' USING ERRCODE='42501'; END IF;
 IF actor IS NULL OR retail.onboarding_auth_email() IS NULL THEN RAISE EXCEPTION 'Verified identity required' USING ERRCODE='42501'; END IF;
 IF command IS NULL OR correlation IS NULL OR data IS NULL OR jsonb_typeof(data)<>'object'
 OR NOT(data ?& ARRAY['businessName','tradeName','phone','email','branchName'])
 OR (data-ARRAY['businessName','tradeName','phone','email','branchName'])<>'{}'::jsonb
 OR jsonb_typeof(data->'businessName')<>'string' OR jsonb_typeof(data->'branchName')<>'string'
 OR jsonb_typeof(data->'tradeName') NOT IN('string','null') OR jsonb_typeof(data->'phone') NOT IN('string','null') OR jsonb_typeof(data->'email') NOT IN('string','null')
 OR NOT retail.settings_text(data->>'businessName',120) OR NOT retail.settings_text(data->>'branchName',100)
 OR NOT retail.settings_text(data->>'tradeName',120) OR NOT retail.settings_text(data->>'phone',50)
 THEN RAISE EXCEPTION 'Invalid onboarding' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,33));
 IF retail.onboarding_auth_email() IS NULL THEN RAISE EXCEPTION 'Verified identity required' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM retail.onboarding_commands WHERE user_id=actor;
 IF FOUND THEN
  IF previous.command_id<>command OR previous.intent<>data THEN RAISE EXCEPTION 'Onboarding intent conflict' USING ERRCODE='P0001'; END IF;
  PERFORM 1 FROM retail.tenants WHERE tenant_id=previous.tenant_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company suspended' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('tenantId',previous.tenant_id,'locationId',previous.location_id);
 END IF;
 IF EXISTS(SELECT 1 FROM retail.tenant_memberships WHERE user_id=actor) THEN RAISE EXCEPTION 'Existing membership' USING ERRCODE='P0001'; END IF;
 INSERT INTO retail.tenants(tenant_id,display_name,creation_origin) VALUES(tid,data->>'businessName','self-service');
 INSERT INTO retail.tenant_memberships(tenant_id,user_id,role,status,display_name) VALUES(tid,actor,'owner','active','Propietario');
 PERFORM set_config('app.tenant_id',tid::text,true),set_config('app.correlation_id',correlation::text,true);
 INSERT INTO retail.business_profiles(tenant_id,business_name,trade_name,phone,email) VALUES(tid,data->>'businessName',data->>'tradeName',data->>'phone',data->>'email');
 INSERT INTO retail.inventory_locations(tenant_id,id,code,name,status) VALUES(tid,lid,'MAIN',data->>'branchName','active');
 INSERT INTO retail.onboarding_commands(user_id,command_id,tenant_id,location_id,intent) VALUES(actor,command,tid,lid,data);
 INSERT INTO retail.onboarding_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id) VALUES
 (tid,actor,'self_registration.completed',actor,correlation),(tid,actor,'company.created',tid,correlation);
 RETURN jsonb_build_object('tenantId',tid,'locationId',lid);
END $$;

CREATE FUNCTION retail.invitation_manager() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Fresh authorization required' USING ERRCODE='42501'; END IF;
 PERFORM retail.lock_membership();
 IF NOT retail.has_permission('members.manage') OR retail.onboarding_auth_email() IS NULL THEN RAISE EXCEPTION 'Invitation denied' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION retail.list_invitations() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 PERFORM retail.invitation_manager();
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(SELECT i.id,i.email,i.role,i.expires_at AS "expiresAt",i.accepted_at AS "acceptedAt",i.revoked_at AS "revokedAt",
 ARRAY(SELECT location_id FROM retail.invitation_locations l WHERE l.tenant_id=i.tenant_id AND l.invitation_id=i.id ORDER BY location_id) AS "locationIds"
 FROM retail.tenant_invitations i WHERE i.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid ORDER BY i.created_at DESC,i.id LIMIT 100)x),'[]'::jsonb);
END $$;
CREATE FUNCTION retail.create_invitation(address text,invited_role text,locations uuid[],days integer,hash text,correlation uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE tid uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid; actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid;
 iid uuid:=gen_random_uuid(); now_at timestamptz:=clock_timestamp();
BEGIN
 PERFORM retail.invitation_manager();
 IF address IS NULL OR address<>lower(btrim(address)) OR invited_role IS NULL OR invited_role NOT IN('admin','cashier','inventory_clerk') OR days IS NULL OR days NOT BETWEEN 1 AND 14
 OR hash IS NULL OR hash !~ '^[a-f0-9]{64}$' OR correlation IS NULL OR locations IS NULL OR cardinality(locations)>100
 OR array_position(locations,NULL) IS NOT NULL OR cardinality(locations)<>(SELECT count(DISTINCT x) FROM unnest(locations)x)
 OR (invited_role='admin' AND cardinality(locations)<>0) THEN RAISE EXCEPTION 'Invalid invitation' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM retail.inventory_locations WHERE tenant_id=tid AND id=ANY(locations) AND status='active' FOR SHARE;
 IF (SELECT count(*) FROM retail.inventory_locations WHERE tenant_id=tid AND id=ANY(locations) AND status='active')<>cardinality(locations) THEN RAISE EXCEPTION 'Location denied' USING ERRCODE='42501'; END IF;
 INSERT INTO retail.tenant_invitations(tenant_id,id,email,role,token_hash,created_by,created_at,expires_at) VALUES(tid,iid,address,invited_role,hash,actor,now_at,now_at+days*interval '1 day');
 INSERT INTO retail.invitation_locations SELECT tid,iid,x FROM unnest(locations)x;
 INSERT INTO retail.onboarding_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id) VALUES(tid,actor,'invitation.created',iid,correlation);
 RETURN iid;
END $$;
CREATE FUNCTION retail.revoke_invitation(iid uuid,correlation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE row retail.tenant_invitations; tid uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 PERFORM retail.invitation_manager();
 IF correlation IS NULL THEN RAISE EXCEPTION 'Invalid correlation' USING ERRCODE='23514'; END IF;
 SELECT * INTO row FROM retail.tenant_invitations WHERE tenant_id=tid AND id=iid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 IF row.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Invitation already accepted' USING ERRCODE='P0001'; END IF;
 IF row.revoked_at IS NOT NULL THEN RETURN; END IF;
 UPDATE retail.tenant_invitations SET revoked_at=clock_timestamp() WHERE tenant_id=tid AND id=iid;
 INSERT INTO retail.onboarding_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id) VALUES(tid,nullif(current_setting('app.user_id',true),'')::uuid,'invitation.revoked',iid,correlation);
END $$;
CREATE FUNCTION retail.accept_invitation(hash text,correlation uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid; address text; row retail.tenant_invitations; tid uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Fresh authorization required' USING ERRCODE='42501'; END IF;
 address:=retail.onboarding_auth_email();
 IF actor IS NULL OR address IS NULL THEN RAISE EXCEPTION 'Verified identity required' USING ERRCODE='42501'; END IF;
 IF hash IS NULL OR hash !~ '^[a-f0-9]{64}$' OR correlation IS NULL THEN RAISE EXCEPTION 'Invalid invitation' USING ERRCODE='23514'; END IF;
 SELECT tenant_id INTO tid FROM retail.tenant_invitations WHERE token_hash=hash;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 -- Same order as suspension: tenant, subject, invitation, resources.
 PERFORM 1 FROM retail.tenants WHERE tenant_id=tid AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company suspended' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,33));
 SELECT * INTO row FROM retail.tenant_invitations WHERE token_hash=hash FOR UPDATE;
 address:=retail.onboarding_auth_email();
 IF address IS NULL OR row.email<>address THEN RAISE EXCEPTION 'Invitation identity mismatch' USING ERRCODE='42501'; END IF;
 IF row.accepted_at IS NOT NULL OR row.revoked_at IS NOT NULL OR row.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Invitation no longer available' USING ERRCODE='P0001'; END IF;
 IF EXISTS(SELECT 1 FROM retail.tenant_memberships WHERE tenant_id=tid AND user_id=actor) THEN RAISE EXCEPTION 'Membership already exists' USING ERRCODE='P0001'; END IF;
 PERFORM 1 FROM retail.inventory_locations l JOIN retail.invitation_locations x ON x.tenant_id=l.tenant_id AND x.location_id=l.id WHERE x.tenant_id=tid AND x.invitation_id=row.id FOR SHARE OF l;
 IF EXISTS(SELECT 1 FROM retail.invitation_locations x JOIN retail.inventory_locations l ON l.tenant_id=x.tenant_id AND l.id=x.location_id WHERE x.tenant_id=tid AND x.invitation_id=row.id AND l.status<>'active') THEN RAISE EXCEPTION 'Location unavailable' USING ERRCODE='P0001'; END IF;
 -- Authorization point is after every potentially blocking lock above.
 address:=retail.onboarding_auth_email();
 IF address IS NULL OR row.email<>address THEN RAISE EXCEPTION 'Invitation identity mismatch' USING ERRCODE='42501'; END IF;
 IF row.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Invitation expired' USING ERRCODE='P0001'; END IF;
 INSERT INTO retail.tenant_memberships(tenant_id,user_id,role,status,display_name) VALUES(tid,actor,row.role,'active','Usuario invitado');
 INSERT INTO retail.member_locations SELECT tid,actor,location_id FROM retail.invitation_locations WHERE tenant_id=tid AND invitation_id=row.id;
 UPDATE retail.tenant_invitations SET accepted_at=clock_timestamp(),accepted_by=actor WHERE tenant_id=tid AND id=row.id;
 INSERT INTO retail.onboarding_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id) VALUES(tid,actor,'invitation.accepted',row.id,correlation);
 RETURN tid;
END $$;
-- Add origin to existing metadata responses without changing their authorization.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('retail.platform_companies(integer)'::regprocedure);
 EXECUTE replace(definition,'t.status,t.created_at','t.status,t.creation_origin AS origin,t.created_at');
 definition:=pg_get_functiondef('retail.platform_company(uuid)'::regprocedure);
 EXECUTE replace(definition,'''createdAt'',created_at','''origin'',creation_origin,''createdAt'',created_at');
END $$;
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['self_onboard(uuid,jsonb,uuid)','invitation_manager()','list_invitations()','create_invitation(text,text,uuid[],integer,text,uuid)','revoke_invitation(uuid,uuid)','accept_invitation(text,uuid)'] LOOP
 EXECUTE 'ALTER FUNCTION retail.'||signature||' OWNER TO smartretail_platform_guard';
 EXECUTE 'REVOKE ALL ON FUNCTION retail.'||signature||' FROM PUBLIC';
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION retail.self_onboard(uuid,jsonb,uuid),retail.list_invitations(),retail.create_invitation(text,text,uuid[],integer,text,uuid),retail.revoke_invitation(uuid,uuid),retail.accept_invitation(text,uuid) TO smartretail_app;
REVOKE CREATE ON SCHEMA retail FROM smartretail_platform_guard;
DO $$ BEGIN IF current_setting('smartretail.migration_admin_create')='false' THEN
 EXECUTE format('REVOKE CREATE ON SCHEMA retail FROM %I',current_setting('smartretail.migration_admin'));
END IF; END $$;
COMMIT;
