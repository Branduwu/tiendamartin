BEGIN;
SET LOCAL ROLE smartretail_owner;
CREATE TABLE retail.suspended_sales (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES retail.tenants,
 location_id uuid NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'suspended' CHECK(status IN ('suspended','completed','cancelled')),
 completed_sale_id uuid UNIQUE, changed_by uuid, changed_at timestamptz,
 created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
 command_payload text NOT NULL CHECK(octet_length(command_payload) BETWEEN 1 AND 65536),
 UNIQUE(tenant_id,id,location_id), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id),
 FOREIGN KEY(tenant_id,completed_sale_id) REFERENCES retail.sales(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((status='suspended' AND completed_sale_id IS NULL AND changed_by IS NULL AND changed_at IS NULL)
 OR (status='cancelled' AND completed_sale_id IS NULL AND changed_by IS NOT NULL AND changed_at IS NOT NULL)
 OR (status='completed' AND completed_sale_id IS NOT NULL AND changed_by IS NOT NULL AND changed_at IS NOT NULL))
);
CREATE TABLE retail.suspended_sale_lines (
 tenant_id uuid NOT NULL, suspended_sale_id uuid NOT NULL, product_id uuid NOT NULL,
 unit text NOT NULL CHECK(unit IN ('piece','kg','g','l','ml','m','cm')),
 quantity_milli_units bigint NOT NULL CHECK(quantity_milli_units>0 AND (unit<>'piece' OR quantity_milli_units%1000=0)),
 PRIMARY KEY(tenant_id,suspended_sale_id,product_id),
 FOREIGN KEY(tenant_id,suspended_sale_id) REFERENCES retail.suspended_sales(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES retail.products(tenant_id,id)
);
ALTER TABLE retail.sales ADD COLUMN suspended_sale_id uuid UNIQUE;
ALTER TABLE retail.sales ADD CONSTRAINT sale_suspension_location_fk FOREIGN KEY(tenant_id,suspended_sale_id,location_id) REFERENCES retail.suspended_sales(tenant_id,id,location_id);
GRANT INSERT(suspended_sale_id) ON retail.sales TO smartretail_app;
CREATE INDEX pending_suspended_sales ON retail.suspended_sales(tenant_id,created_at DESC,id DESC) WHERE status='suspended';
CREATE INDEX suspended_line_product ON retail.suspended_sale_lines(tenant_id,product_id);
DO $$ DECLARE tbl text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['suspended_sales','suspended_sale_lines'] LOOP
  EXECUTE format('ALTER TABLE retail.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE retail.%I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY suspension_tenant ON retail.%I AS RESTRICTIVE USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member())',tbl);
  EXECUTE format('CREATE POLICY suspension_read ON retail.%I FOR SELECT USING(retail.has_permission(''sales.read'') OR retail.has_permission(''sales.create''))',tbl);
  EXECUTE format('CREATE POLICY suspension_insert ON retail.%I FOR INSERT WITH CHECK(retail.has_permission(''sales.create''))',tbl);
  EXECUTE format('GRANT SELECT ON retail.%I TO smartretail_app',tbl);
 END LOOP;
END $$;
CREATE POLICY suspension_change ON retail.suspended_sales FOR UPDATE USING(retail.has_permission('sales.create')) WITH CHECK(retail.has_permission('sales.create'));
GRANT INSERT(id,tenant_id,location_id,created_by,command_payload) ON retail.suspended_sales TO smartretail_app;
GRANT INSERT ON retail.suspended_sale_lines TO smartretail_app;
-- No runtime UPDATE or DELETE; transitions below are the sole status writer.
CREATE FUNCTION retail.lock_suspended_sale(sid uuid,loc uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE state text;
BEGIN
 IF NOT retail.has_permission('sales.create') THEN RAISE EXCEPTION 'Suspension denied' USING ERRCODE='42501'; END IF;
 SELECT status INTO state FROM retail.suspended_sales WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND id=sid AND location_id=loc FOR UPDATE;
 IF state IS DISTINCT FROM 'suspended' THEN RAISE EXCEPTION 'Suspension unavailable' USING ERRCODE='P0001'; END IF;
END $$;
REVOKE ALL ON FUNCTION retail.lock_suspended_sale(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.lock_suspended_sale(uuid,uuid) TO smartretail_app;
CREATE FUNCTION retail.guard_suspension() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Immutable suspension' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid OR NEW.status<>'suspended'
   OR NOT EXISTS(SELECT 1 FROM retail.inventory_locations l WHERE l.tenant_id=NEW.tenant_id AND l.id=NEW.location_id AND l.status='active') THEN RAISE EXCEPTION 'Invalid suspension' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.status<>'suspended' OR NEW.status NOT IN ('completed','cancelled') OR NOT retail.has_permission('sales.create')
   OR ROW(NEW.id,NEW.tenant_id,NEW.location_id,NEW.created_by,NEW.created_at,NEW.created_tx,NEW.command_payload) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.location_id,OLD.created_by,OLD.created_at,OLD.created_tx,OLD.command_payload)
   OR NEW.changed_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid THEN RAISE EXCEPTION 'Invalid suspension transition' USING ERRCODE='23514'; END IF;
  IF NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM retail.sales s WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.completed_sale_id AND s.suspended_sale_id=NEW.id AND s.created_tx=pg_current_xact_id()) THEN RAISE EXCEPTION 'Completed sale required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_suspension() FROM PUBLIC;
CREATE TRIGGER suspension_guard BEFORE INSERT OR UPDATE OR DELETE ON retail.suspended_sales FOR EACH ROW EXECUTE FUNCTION retail.guard_suspension();
CREATE FUNCTION retail.guard_suspended_line() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM retail.suspended_sales s WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.suspended_sale_id AND s.created_tx=pg_current_xact_id() AND s.status='suspended')
 OR NOT EXISTS(SELECT 1 FROM retail.products p WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.product_id AND p.status='active' AND p.unit=NEW.unit) THEN RAISE EXCEPTION 'Invalid suspended line' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_suspended_line() FROM PUBLIC;
CREATE TRIGGER suspended_line_guard BEFORE INSERT ON retail.suspended_sale_lines FOR EACH ROW EXECUTE FUNCTION retail.guard_suspended_line();
CREATE TRIGGER suspended_line_immutable BEFORE UPDATE OR DELETE ON retail.suspended_sale_lines FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE FUNCTION retail.check_suspension_complete() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
DECLARE sid uuid; n bigint;
BEGIN
 IF TG_TABLE_NAME='suspended_sales' THEN sid:=NEW.id; ELSE sid:=NEW.suspended_sale_id; END IF;
 SELECT count(*) INTO n FROM retail.suspended_sale_lines WHERE tenant_id=NEW.tenant_id AND suspended_sale_id=sid;
 IF n<1 OR n>1000 THEN RAISE EXCEPTION 'Invalid suspended line count' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.check_suspension_complete() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER suspension_complete AFTER INSERT ON retail.suspended_sales DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_suspension_complete();
CREATE CONSTRAINT TRIGGER suspended_lines_complete AFTER INSERT ON retail.suspended_sale_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_suspension_complete();
CREATE FUNCTION retail.cancel_suspended_sale(sid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE state text;
BEGIN
 IF NOT retail.has_permission('sales.create') THEN RAISE EXCEPTION 'Suspension denied' USING ERRCODE='42501'; END IF;
 SELECT status INTO state FROM retail.suspended_sales WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND id=sid FOR UPDATE;
 IF state='cancelled' THEN RETURN; END IF;
 IF state IS DISTINCT FROM 'suspended' THEN RAISE EXCEPTION 'Suspension unavailable' USING ERRCODE='P0001'; END IF;
 UPDATE retail.suspended_sales SET status='cancelled',changed_by=nullif(current_setting('app.user_id',true),'')::uuid,changed_at=clock_timestamp() WHERE id=sid;
END $$;
REVOKE ALL ON FUNCTION retail.cancel_suspended_sale(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.cancel_suspended_sale(uuid) TO smartretail_app;
CREATE FUNCTION retail.guard_sale_suspension() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NEW.suspended_sale_id IS NOT NULL THEN PERFORM retail.lock_suspended_sale(NEW.suspended_sale_id,NEW.location_id); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_sale_suspension() FROM PUBLIC;
-- Alphabetic BEFORE ordering locks the suspension before the cash shift.
CREATE TRIGGER sale_aa_suspension BEFORE INSERT ON retail.sales FOR EACH ROW EXECUTE FUNCTION retail.guard_sale_suspension();
CREATE FUNCTION retail.complete_suspended_sale() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NEW.suspended_sale_id IS NOT NULL THEN
  PERFORM retail.lock_suspended_sale(NEW.suspended_sale_id,NEW.location_id);
  UPDATE retail.suspended_sales SET status='completed',completed_sale_id=NEW.id,changed_by=nullif(current_setting('app.user_id',true),'')::uuid,changed_at=clock_timestamp() WHERE tenant_id=NEW.tenant_id AND id=NEW.suspended_sale_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.complete_suspended_sale() FROM PUBLIC;
CREATE TRIGGER sale_complete_suspension AFTER INSERT ON retail.sales FOR EACH ROW EXECUTE FUNCTION retail.complete_suspended_sale();
COMMIT;
