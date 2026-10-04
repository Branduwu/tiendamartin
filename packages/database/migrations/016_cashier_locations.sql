BEGIN;
-- Dedicated definer can inspect/lock memberships under FORCE RLS. The runtime
-- never inherits this role and receives no direct membership write privileges.
CREATE ROLE smartretail_members_guard NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT smartretail_members_guard TO smartretail_owner;
SET LOCAL ROLE smartretail_owner;
ALTER TABLE retail.tenant_memberships DROP CONSTRAINT tenant_memberships_role_check;
ALTER TABLE retail.tenant_memberships ADD CONSTRAINT tenant_memberships_role_check CHECK(role IN ('owner','admin','inventory_clerk','cashier'));
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_role_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_role_check CHECK(role IN ('owner','admin','inventory_clerk','cashier'));
INSERT INTO retail.role_permissions SELECT 'cashier',p FROM unnest(ARRAY[
 'products.read','customers.read','customers.write','sales.read','sales.create',
 'cash.read','cash.open','cash.move','cash.close','locations.read','inventory.read']) p;
ALTER TABLE retail.tenant_memberships ADD COLUMN display_name text
 CHECK(display_name IS NULL OR (length(display_name) BETWEEN 1 AND 80 AND btrim(display_name)=display_name AND display_name !~ '[[:cntrl:]]'));
CREATE TABLE retail.member_locations (
 tenant_id uuid NOT NULL,user_id uuid NOT NULL,location_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,user_id,location_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES retail.tenant_memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id)
);
CREATE INDEX member_locations_location ON retail.member_locations(tenant_id,location_id,user_id);
ALTER TABLE retail.member_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.member_locations FORCE ROW LEVEL SECURITY;
CREATE POLICY assigned_self ON retail.member_locations FOR SELECT USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND retail.is_active_member());
GRANT SELECT ON retail.member_locations TO smartretail_app;
GRANT USAGE ON SCHEMA retail TO smartretail_members_guard;
GRANT CREATE ON SCHEMA retail TO smartretail_members_guard;
GRANT SELECT,UPDATE(role,status,display_name) ON retail.tenant_memberships TO smartretail_members_guard;
GRANT SELECT,INSERT,DELETE ON retail.member_locations TO smartretail_members_guard;
GRANT SELECT ON retail.role_permissions,retail.inventory_locations TO smartretail_members_guard;
GRANT EXECUTE ON FUNCTION retail.has_permission(text),retail.is_active_member() TO smartretail_members_guard;
CREATE POLICY membership_guard ON retail.tenant_memberships TO smartretail_members_guard
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY assignment_guard ON retail.member_locations TO smartretail_members_guard
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE FUNCTION retail.has_location_access(lid uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,retail AS $$
DECLARE member_role text;
BEGIN
 SELECT role INTO member_role FROM retail.tenant_memberships WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND status='active';
 IF member_role IS NULL THEN RETURN false; END IF;
 RETURN member_role IN ('owner','admin') OR EXISTS(SELECT 1 FROM retail.member_locations
 WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND location_id=lid);
END $$;
ALTER FUNCTION retail.has_location_access(uuid) OWNER TO smartretail_members_guard;
REVOKE ALL ON FUNCTION retail.has_location_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.has_location_access(uuid) TO smartretail_app,smartretail_owner,smartretail_members_guard;
CREATE POLICY location_assignment ON retail.inventory_locations AS RESTRICTIVE
 USING(CASE WHEN current_user='smartretail_members_guard' THEN true ELSE retail.has_location_access(id) END)
 WITH CHECK(CASE WHEN current_user='smartretail_members_guard' THEN true ELSE retail.has_location_access(id) END);
-- INSERT of new locations is owner/admin only and must not require its own
-- not-yet-existing ID to be visible to has_location_access.
ALTER POLICY location_assignment ON retail.inventory_locations
 WITH CHECK(retail.has_permission('locations.write') OR retail.has_location_access(id));
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['stock_balances','inventory_movements','inventory_counts','inventory_minimums','cash_register_shifts','sales','suspended_sales','sale_returns'] LOOP
 EXECUTE format('CREATE POLICY assigned_location ON retail.%I AS RESTRICTIVE USING(retail.has_location_access(location_id)) WITH CHECK(retail.has_location_access(location_id))',tbl);
 END LOOP;
END $$;
CREATE POLICY assigned_transfer ON retail.inventory_transfers AS RESTRICTIVE
 USING(retail.has_location_access(source_location_id) AND retail.has_location_access(destination_location_id))
 WITH CHECK(retail.has_location_access(source_location_id) AND retail.has_location_access(destination_location_id));
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['sale_lines','sale_payments'] LOOP
 EXECUTE format('CREATE POLICY assigned_sale ON retail.%I AS RESTRICTIVE USING(EXISTS(SELECT 1 FROM retail.sales s WHERE s.tenant_id=%I.tenant_id AND s.id=%I.sale_id)) WITH CHECK(EXISTS(SELECT 1 FROM retail.sales s WHERE s.tenant_id=%I.tenant_id AND s.id=%I.sale_id))',tbl,tbl,tbl,tbl,tbl);
 END LOOP;
 FOREACH tbl IN ARRAY ARRAY['sale_return_lines','sale_return_refunds'] LOOP
 EXECUTE format('CREATE POLICY assigned_return ON retail.%I AS RESTRICTIVE USING(EXISTS(SELECT 1 FROM retail.sale_returns s WHERE s.tenant_id=%I.tenant_id AND s.id=%I.return_id)) WITH CHECK(EXISTS(SELECT 1 FROM retail.sale_returns s WHERE s.tenant_id=%I.tenant_id AND s.id=%I.return_id))',tbl,tbl,tbl,tbl,tbl);
 END LOOP;
END $$;
CREATE POLICY assigned_cash_movement ON retail.cash_movements AS RESTRICTIVE
 USING(EXISTS(SELECT 1 FROM retail.cash_register_shifts c WHERE c.tenant_id=cash_movements.tenant_id AND c.id=cash_movements.shift_id))
 WITH CHECK(EXISTS(SELECT 1 FROM retail.cash_register_shifts c WHERE c.tenant_id=cash_movements.tenant_id AND c.id=cash_movements.shift_id));
CREATE POLICY assigned_suspended_lines ON retail.suspended_sale_lines AS RESTRICTIVE
 USING(EXISTS(SELECT 1 FROM retail.suspended_sales s WHERE s.tenant_id=suspended_sale_lines.tenant_id AND s.id=suspended_sale_lines.suspended_sale_id))
 WITH CHECK(EXISTS(SELECT 1 FROM retail.suspended_sales s WHERE s.tenant_id=suspended_sale_lines.tenant_id AND s.id=suspended_sale_lines.suspended_sale_id));

-- Cashier has no inventory.issue permission. A sale-linked issue is authorized
-- only through sales.create and the existing deferred complete-sale invariants.
CREATE POLICY sale_balance_insert ON retail.stock_balances FOR INSERT WITH CHECK(retail.has_permission('sales.create'));
CREATE POLICY sale_balance_ledger ON retail.stock_balances FOR UPDATE USING(retail.has_permission('sales.create')) WITH CHECK(retail.has_permission('sales.create'));
CREATE POLICY sale_command ON retail.inventory_commands FOR INSERT WITH CHECK(kind='issue' AND retail.has_permission('sales.create'));
CREATE POLICY sale_issue ON retail.inventory_movements FOR INSERT WITH CHECK(type='issue' AND sale_id IS NOT NULL AND retail.has_permission('sales.create'));
-- SELECT FOR SHARE needs an UPDATE USING policy, but this policy never permits
-- changed product rows. The existing products.write WITH CHECK remains required.
CREATE POLICY sale_product_lock ON retail.products FOR UPDATE USING(retail.has_permission('sales.create')) WITH CHECK(false);

CREATE FUNCTION retail.lock_membership() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 PERFORM 1 FROM retail.tenant_memberships WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Membership denied' USING ERRCODE='42501'; END IF;
END $$;
ALTER FUNCTION retail.lock_membership() OWNER TO smartretail_members_guard;
REVOKE ALL ON FUNCTION retail.lock_membership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.lock_membership() TO smartretail_app;

CREATE TABLE retail.membership_audit (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES retail.tenants,actor_user_id uuid NOT NULL,
 user_id uuid NOT NULL,action text NOT NULL DEFAULT 'members.update' CHECK(action='members.update'),
 correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 metadata jsonb NOT NULL CHECK(octet_length(metadata::text)<=4096),
 FOREIGN KEY(tenant_id,user_id) REFERENCES retail.tenant_memberships(tenant_id,user_id),UNIQUE(tenant_id,correlation_id)
);
ALTER TABLE retail.membership_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.membership_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_audit_scope ON retail.membership_audit AS RESTRICTIVE USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY membership_audit_read ON retail.membership_audit FOR SELECT USING(retail.has_permission('members.manage'));
CREATE POLICY membership_audit_guard ON retail.membership_audit FOR INSERT TO smartretail_members_guard WITH CHECK(retail.has_permission('members.manage'));
GRANT SELECT ON retail.membership_audit TO smartretail_app;
GRANT INSERT ON retail.membership_audit TO smartretail_members_guard;
CREATE TRIGGER immutable_membership_audit BEFORE UPDATE OR DELETE ON retail.membership_audit FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();

CREATE FUNCTION retail.list_members() RETURNS TABLE(user_id uuid,display_name text,role text,status text,location_ids uuid[],all_locations boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NOT retail.has_permission('members.manage') THEN RAISE EXCEPTION 'Membership management denied' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT m.user_id,coalesce(m.display_name,CASE m.role WHEN 'owner' THEN 'Propietario' WHEN 'admin' THEN 'Administrador' WHEN 'cashier' THEN 'Cajero' ELSE 'Encargado de inventario' END),m.role,m.status,
 ARRAY(SELECT a.location_id FROM retail.member_locations a WHERE a.tenant_id=m.tenant_id AND a.user_id=m.user_id ORDER BY a.location_id),m.role IN ('owner','admin')
 FROM retail.tenant_memberships m WHERE m.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid ORDER BY m.role,m.user_id;
END $$;
ALTER FUNCTION retail.list_members() OWNER TO smartretail_members_guard;
REVOKE ALL ON FUNCTION retail.list_members() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.list_members() TO smartretail_app;
CREATE FUNCTION retail.update_member(target uuid,newrole text,newstatus text,newname text,newlocations uuid[],correlation uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE oldrow retail.tenant_memberships; tid uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid; actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid;
BEGIN
 PERFORM retail.lock_membership();
 IF NOT retail.has_permission('members.manage') THEN RAISE EXCEPTION 'Membership management denied' USING ERRCODE='42501'; END IF;
 IF target IS NULL OR target=actor OR newrole IS NULL OR newrole NOT IN ('admin','cashier','inventory_clerk') OR newstatus IS NULL OR newstatus NOT IN ('active','inactive') OR correlation IS NULL
 THEN RAISE EXCEPTION 'Protected membership' USING ERRCODE='42501'; END IF;
 SELECT * INTO oldrow FROM retail.tenant_memberships WHERE tenant_id=tid AND user_id=target FOR UPDATE;
 IF NOT FOUND OR oldrow.role='owner' THEN RAISE EXCEPTION 'Protected membership' USING ERRCODE='42501'; END IF;
 IF newname IS NULL OR length(newname) NOT BETWEEN 1 AND 80 OR btrim(newname)<>newname OR newname ~ '[[:cntrl:]]' OR newlocations IS NULL OR cardinality(newlocations)>100
 OR EXISTS(SELECT 1 FROM unnest(newlocations) x WHERE x IS NULL) OR cardinality(newlocations)<>(SELECT count(DISTINCT x) FROM unnest(newlocations) x)
 OR (newrole='admin' AND cardinality(newlocations)<>0)
 THEN RAISE EXCEPTION 'Invalid member input' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(newlocations) x WHERE NOT EXISTS(SELECT 1 FROM retail.inventory_locations l WHERE l.tenant_id=tid AND l.id=x AND l.status='active'))
 THEN RAISE EXCEPTION 'Location denied' USING ERRCODE='42501'; END IF;
 UPDATE retail.tenant_memberships SET role=newrole,status=newstatus,display_name=newname WHERE tenant_id=tid AND user_id=target;
 DELETE FROM retail.member_locations WHERE tenant_id=tid AND user_id=target;
 INSERT INTO retail.member_locations SELECT tid,target,x FROM unnest(newlocations) x;
 INSERT INTO retail.membership_audit(id,tenant_id,actor_user_id,user_id,correlation_id,metadata)
 VALUES(gen_random_uuid(),tid,actor,target,correlation,jsonb_build_object('previousRole',oldrow.role,'role',newrole,'previousStatus',oldrow.status,'status',newstatus,'locationIds',newlocations));
END $$;
ALTER FUNCTION retail.update_member(uuid,text,text,text,uuid[],uuid) OWNER TO smartretail_members_guard;
REVOKE ALL ON FUNCTION retail.update_member(uuid,text,text,text,uuid[],uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.update_member(uuid,text,text,text,uuid[],uuid) TO smartretail_app;
GRANT EXECUTE ON FUNCTION retail.lock_membership() TO smartretail_members_guard;

-- Historical references remain intact; new records snapshot only the operative
-- name, never email/phone. Legacy NULL names use a neutral UI fallback.
ALTER TABLE retail.sales ADD COLUMN created_by_name text,ADD COLUMN location_name text;
ALTER TABLE retail.cash_register_shifts ADD COLUMN opened_by_name text,ADD COLUMN closed_by_name text;
CREATE FUNCTION retail.current_actor_name() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
 SELECT coalesce(display_name,CASE role WHEN 'owner' THEN 'Propietario' WHEN 'admin' THEN 'Administrador' WHEN 'cashier' THEN 'Cajero' ELSE 'Encargado de inventario' END)
 FROM retail.tenant_memberships WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND status='active';
$$;
REVOKE ALL ON FUNCTION retail.current_actor_name() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.current_actor_name() TO smartretail_app,smartretail_owner;
CREATE FUNCTION retail.snapshot_operator() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF TG_TABLE_NAME='sales' THEN
  NEW.created_by_name:=retail.current_actor_name();
  SELECT name INTO NEW.location_name FROM retail.inventory_locations WHERE tenant_id=NEW.tenant_id AND id=NEW.location_id;
 ELSE
  IF TG_OP='INSERT' THEN NEW.opened_by_name:=retail.current_actor_name();
  ELSE NEW.opened_by_name:=OLD.opened_by_name; NEW.closed_by_name:=retail.current_actor_name(); END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.snapshot_operator() FROM PUBLIC;
CREATE TRIGGER sale_operator_snapshot BEFORE INSERT ON retail.sales FOR EACH ROW EXECUTE FUNCTION retail.snapshot_operator();
CREATE TRIGGER shift_operator_snapshot BEFORE INSERT OR UPDATE ON retail.cash_register_shifts FOR EACH ROW EXECUTE FUNCTION retail.snapshot_operator();
REVOKE CREATE ON SCHEMA retail FROM smartretail_members_guard;
COMMIT;
