-- Support only: no commercial permissions or ledger mutations.
BEGIN;
SET LOCAL ROLE smartretail_owner;
GRANT USAGE, CREATE ON SCHEMA retail TO smartretail_platform_guard;
GRANT EXECUTE ON FUNCTION retail.lock_membership() TO smartretail_platform_guard;

CREATE TABLE retail.support_requests (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES retail.tenants,
 created_by_user_id uuid NOT NULL, created_by_name text NOT NULL, created_by_role text NOT NULL CHECK(created_by_role IN('owner','admin','cashier','inventory_clerk')),
 category text NOT NULL CHECK(category IN('function','error','billing','suggestion','other')),
 subject text NOT NULL CHECK(retail.settings_text(subject,120) AND subject !~ '[[:cntrl:]]'),
 description text NOT NULL CHECK(length(description) BETWEEN 1 AND 4000 AND octet_length(description)<=16000 AND length(btrim(description))>0 AND translate(description,chr(9)||chr(10)||chr(13),'') !~ '[[:cntrl:]]'),
 page_path text NOT NULL CHECK(page_path IN('/help','/help/support','/dashboard','/products','/inventory','/pos','/cash','/sales','/customers','/suppliers','/purchases','/receivables','/payables','/expenses','/promotions','/labels','/settings/users','/settings/taxes','/settings/business','/settings/account','/onboarding')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','in_progress','resolved','closed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,created_by_user_id) REFERENCES retail.tenant_memberships(tenant_id,user_id)
);
CREATE INDEX support_self_created ON retail.support_requests(tenant_id,created_by_user_id,created_at DESC,id);
CREATE INDEX support_platform_status ON retail.support_requests(status,created_at DESC,id);
ALTER TABLE retail.support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.support_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY support_self ON retail.support_requests FOR SELECT TO smartretail_app USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND created_by_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND retail.is_active_member());
CREATE POLICY support_guard_select ON retail.support_requests FOR SELECT TO smartretail_platform_guard USING(true);
CREATE POLICY support_guard_insert ON retail.support_requests FOR INSERT TO smartretail_platform_guard WITH CHECK(created_by_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND status='open' AND retail.is_active_member());
CREATE POLICY support_guard_update ON retail.support_requests FOR UPDATE TO smartretail_platform_guard USING(retail.is_platform_admin()) WITH CHECK(retail.is_platform_admin());
GRANT SELECT ON retail.support_requests TO smartretail_app,smartretail_platform_guard;
GRANT INSERT ON retail.support_requests TO smartretail_platform_guard;
GRANT UPDATE(status,updated_at) ON retail.support_requests TO smartretail_platform_guard;

CREATE TABLE retail.support_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,request_id uuid NOT NULL,actor_user_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('support.created','support.status')),correlation_id uuid NOT NULL,
 previous_status text CHECK(previous_status IN('open','in_progress','resolved','closed')),new_status text NOT NULL CHECK(new_status IN('open','in_progress','resolved','closed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), FOREIGN KEY(tenant_id,request_id) REFERENCES retail.support_requests(tenant_id,id)
);
ALTER TABLE retail.support_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.support_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY support_audit_guard ON retail.support_audit FOR INSERT TO smartretail_platform_guard WITH CHECK(actor_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND (retail.is_platform_admin() OR (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member())));
GRANT INSERT ON retail.support_audit TO smartretail_platform_guard;
CREATE TRIGGER support_audit_immutable BEFORE UPDATE OR DELETE ON retail.support_audit FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();

CREATE FUNCTION retail.support_summary(r retail.support_requests) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
 SELECT jsonb_build_object('id',r.id,'tenantId',r.tenant_id,'tenantName',(SELECT display_name FROM retail.tenants WHERE tenant_id=r.tenant_id), 'createdByUserId',r.created_by_user_id,'createdByName',r.created_by_name,'createdByRole',r.created_by_role,'category',r.category,'subject',r.subject,'status',r.status,'createdAt',r.created_at,'updatedAt',r.updated_at);
$$;
CREATE FUNCTION retail.support_create(rid uuid,cat text,subj text,body text,path text,correlation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE t uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid; u uuid:=nullif(current_setting('app.user_id',true),'')::uuid; existing retail.support_requests; member_role text; member_name text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Read committed required' USING ERRCODE='23514'; END IF;
 PERFORM retail.lock_membership();
 IF rid IS NULL OR correlation IS NULL THEN RAISE EXCEPTION 'Invalid support input' USING ERRCODE='23514'; END IF;
 -- Serialize all submissions by this actor, including the technical hourly limit.
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||'/'||u::text,45));
 PERFORM pg_advisory_xact_lock(hashtextextended(rid::text,46));
 SELECT * INTO existing FROM retail.support_requests WHERE id=rid;
 IF FOUND THEN
  IF existing.tenant_id<>t OR existing.created_by_user_id<>u THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
  IF existing.category IS DISTINCT FROM cat OR existing.subject IS DISTINCT FROM subj OR existing.description IS DISTINCT FROM body OR existing.page_path IS DISTINCT FROM path THEN RAISE EXCEPTION 'Conflicting request' USING ERRCODE='P0001'; END IF;
  RETURN retail.support_summary(existing)||jsonb_build_object('description',existing.description,'pagePath',existing.page_path);
 END IF;
 IF (SELECT count(*) FROM retail.support_requests WHERE tenant_id=t AND created_by_user_id=u AND created_at>clock_timestamp()-interval '1 hour')>=20 THEN RAISE EXCEPTION 'Support rate limit' USING ERRCODE='54000'; END IF;
 SELECT role,coalesce(display_name,'Usuario') INTO member_role,member_name FROM retail.tenant_memberships WHERE tenant_id=t AND user_id=u AND status='active';
 INSERT INTO retail.support_requests(id,tenant_id,created_by_user_id,created_by_name,created_by_role,category,subject,description,page_path) VALUES(rid,t,u,member_name,member_role,cat,subj,body,path) RETURNING * INTO existing;
 INSERT INTO retail.support_audit(tenant_id,request_id,actor_user_id,action,correlation_id,new_status) VALUES(t,rid,u,'support.created',correlation,'open');
 RETURN retail.support_summary(existing)||jsonb_build_object('description',existing.description,'pagePath',existing.page_path);
END $$;
CREATE FUNCTION retail.support_list(page integer DEFAULT 1,platform boolean DEFAULT false,filter_status text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE result jsonb; t uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid; u uuid:=nullif(current_setting('app.user_id',true),'')::uuid;
BEGIN
 IF platform THEN PERFORM retail.require_platform_admin(); ELSE PERFORM retail.lock_membership(); END IF;
 IF page NOT BETWEEN 1 AND 99999 OR page IS NULL OR (filter_status IS NOT NULL AND filter_status NOT IN('open','in_progress','resolved','closed')) THEN RAISE EXCEPTION 'Invalid support query' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(retail.support_summary(x::retail.support_requests) ORDER BY x.created_at DESC,x.id),'[]'::jsonb) INTO result FROM (SELECT r.* FROM retail.support_requests r WHERE (platform OR (r.tenant_id=t AND r.created_by_user_id=u)) AND (filter_status IS NULL OR r.status=filter_status) ORDER BY created_at DESC,id LIMIT 26 OFFSET(page-1)*25)x;
 RETURN result;
END $$;
CREATE FUNCTION retail.support_detail(rid uuid,platform boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE r retail.support_requests;
BEGIN
 IF platform THEN PERFORM retail.require_platform_admin(); ELSE PERFORM retail.lock_membership(); END IF;
 SELECT * INTO r FROM retail.support_requests WHERE id=rid AND (platform OR (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND created_by_user_id=nullif(current_setting('app.user_id',true),'')::uuid));
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
 RETURN retail.support_summary(r)||jsonb_build_object('description',r.description,'pagePath',r.page_path);
END $$;
CREATE FUNCTION retail.support_status(rid uuid,newstatus text,correlation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE r retail.support_requests; oldstatus text;
BEGIN
 PERFORM retail.require_platform_admin();
 IF newstatus IS NULL OR newstatus NOT IN('open','in_progress','resolved','closed') OR correlation IS NULL THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM retail.support_requests WHERE id=rid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
 oldstatus:=r.status;
 IF oldstatus<>newstatus THEN
  UPDATE retail.support_requests SET status=newstatus,updated_at=clock_timestamp() WHERE id=rid RETURNING * INTO r;
  INSERT INTO retail.support_audit(tenant_id,request_id,actor_user_id,action,correlation_id,previous_status,new_status) VALUES(r.tenant_id,rid,nullif(current_setting('app.user_id',true),'')::uuid,'support.status',correlation,oldstatus,newstatus);
 END IF;
 RETURN retail.support_summary(r)||jsonb_build_object('description',r.description,'pagePath',r.page_path);
END $$;
-- No private renderer, ownership, or CREATE is exposed to runtime.
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['support_summary(retail.support_requests)','support_create(uuid,text,text,text,text,uuid)','support_list(integer,boolean,text)','support_detail(uuid,boolean)','support_status(uuid,text,uuid)'] LOOP
  EXECUTE 'ALTER FUNCTION retail.'||signature||' OWNER TO smartretail_platform_guard';
  EXECUTE 'REVOKE ALL ON FUNCTION retail.'||signature||' FROM PUBLIC';
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION retail.support_create(uuid,text,text,text,text,uuid),retail.support_list(integer,boolean,text),retail.support_detail(uuid,boolean),retail.support_status(uuid,text,uuid) TO smartretail_app;
REVOKE CREATE ON SCHEMA retail FROM smartretail_platform_guard;
DO $$ BEGIN
 IF has_function_privilege('smartretail_app','retail.support_summary(retail.support_requests)','EXECUTE') OR has_function_privilege('smartretail_api','retail.support_summary(retail.support_requests)','EXECUTE') THEN RAISE EXCEPTION 'Support renderer must remain private'; END IF;
END $$;
COMMIT;
