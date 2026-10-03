BEGIN;
SET LOCAL ROLE smartretail_owner;
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_permission_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_permission_check CHECK(permission IN (
'products.read','products.write','locations.read','locations.write','inventory.read','inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage',
'sales.read','sales.create','sales.return','cash.read','cash.open','cash.move','cash.close','suppliers.read','suppliers.write','purchases.read','purchases.write','purchases.receive','customers.read','customers.write','reports.read','inventory.minimum.write'));
INSERT INTO retail.role_permissions VALUES('owner','inventory.minimum.write'),('admin','inventory.minimum.write');

CREATE TABLE retail.inventory_minimums (
 tenant_id uuid NOT NULL REFERENCES retail.tenants,product_id uuid NOT NULL,location_id uuid NOT NULL,
 unit text NOT NULL,milli_units bigint NOT NULL CHECK(milli_units>=0 AND (unit<>'piece' OR milli_units%1000=0)),
 PRIMARY KEY(tenant_id,product_id,location_id),
 FOREIGN KEY(tenant_id,product_id,unit) REFERENCES retail.products(tenant_id,id,unit),
 FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id)
);
CREATE TABLE retail.inventory_minimum_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES retail.tenants,
 product_id uuid NOT NULL,location_id uuid NOT NULL,unit text NOT NULL,
 before_milli_units bigint,after_milli_units bigint,action text NOT NULL CHECK(action IN ('minimum.set','minimum.remove')),
 actor_user_id uuid NOT NULL,correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,product_id) REFERENCES retail.products(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id)
);
DO $$ DECLARE tbl text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['inventory_minimums','inventory_minimum_audit'] LOOP
  EXECUTE format('ALTER TABLE retail.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE retail.%I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY minimum_tenant ON retail.%I AS RESTRICTIVE USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member())',tbl);
  EXECUTE format('CREATE POLICY minimum_read ON retail.%I FOR SELECT USING(retail.has_permission(''inventory.read'') OR retail.has_permission(''reports.read''))',tbl);
  EXECUTE format('GRANT SELECT ON retail.%I TO smartretail_app',tbl);
 END LOOP;
END $$;
CREATE POLICY minimum_insert ON retail.inventory_minimums FOR INSERT WITH CHECK(retail.has_permission('inventory.minimum.write'));
CREATE POLICY minimum_update ON retail.inventory_minimums FOR UPDATE USING(retail.has_permission('inventory.minimum.write')) WITH CHECK(retail.has_permission('inventory.minimum.write'));
CREATE POLICY minimum_delete ON retail.inventory_minimums FOR DELETE USING(retail.has_permission('inventory.minimum.write'));
CREATE POLICY minimum_audit_insert ON retail.inventory_minimum_audit FOR INSERT WITH CHECK(retail.has_permission('inventory.minimum.write'));
GRANT INSERT,DELETE ON retail.inventory_minimums TO smartretail_app;
GRANT UPDATE(milli_units) ON retail.inventory_minimums TO smartretail_app;
CREATE TRIGGER minimum_audit_immutable BEFORE UPDATE OR DELETE ON retail.inventory_minimum_audit FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE FUNCTION retail.audit_inventory_minimum() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE t uuid;p uuid;l uuid;u text;b bigint;a bigint;
BEGIN
 IF TG_OP='DELETE' THEN t:=OLD.tenant_id;p:=OLD.product_id;l:=OLD.location_id;u:=OLD.unit;b:=OLD.milli_units;
 ELSE t:=NEW.tenant_id;p:=NEW.product_id;l:=NEW.location_id;u:=NEW.unit;a:=NEW.milli_units;
 IF TG_OP='UPDATE' THEN b:=OLD.milli_units; END IF;
 END IF;
 IF NOT retail.has_permission('inventory.minimum.write') OR t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'Minimum access denied' USING ERRCODE='42501'; END IF;
 INSERT INTO retail.inventory_minimum_audit(tenant_id,product_id,location_id,unit,before_milli_units,after_milli_units,action,actor_user_id,correlation_id)
 VALUES(t,p,l,u,b,a,CASE WHEN TG_OP='DELETE' THEN 'minimum.remove' ELSE 'minimum.set' END,nullif(current_setting('app.user_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION retail.audit_inventory_minimum() FROM PUBLIC;
CREATE TRIGGER minimum_audit AFTER INSERT OR UPDATE OR DELETE ON retail.inventory_minimums FOR EACH ROW EXECUTE FUNCTION retail.audit_inventory_minimum();
CREATE FUNCTION retail.inventory_stock_state(stock bigint,minimum bigint) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN stock<=0 THEN 'out' WHEN minimum IS NULL THEN 'unconfigured' WHEN stock<=minimum THEN 'low' ELSE 'normal' END;
$$;
CREATE FUNCTION retail.inventory_shortfall(stock bigint,minimum bigint) RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN minimum IS NULL THEN NULL ELSE greatest(minimum-stock,0) END;
$$;
REVOKE ALL ON FUNCTION retail.inventory_stock_state(bigint,bigint),retail.inventory_shortfall(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.inventory_stock_state(bigint,bigint),retail.inventory_shortfall(bigint,bigint) TO smartretail_app;
CREATE VIEW retail.inventory_threshold_status WITH(security_invoker=true) AS
 SELECT p.id,p.name,p.sku,l.id AS location_id,l.name AS location_name,m.tenant_id,p.unit,
 coalesce(b.milli_units,0) AS stock,m.milli_units AS minimum,
 retail.inventory_shortfall(coalesce(b.milli_units,0),m.milli_units) AS suggested,
 retail.inventory_stock_state(coalesce(b.milli_units,0),m.milli_units) AS state
 FROM retail.inventory_minimums m JOIN retail.products p ON p.tenant_id=m.tenant_id AND p.id=m.product_id
 JOIN retail.inventory_locations l ON l.tenant_id=m.tenant_id AND l.id=m.location_id
 LEFT JOIN retail.stock_balances b ON b.tenant_id=m.tenant_id AND b.product_id=m.product_id AND b.location_id=m.location_id
 WHERE p.status='active' AND l.status='active';
GRANT SELECT ON retail.inventory_threshold_status TO smartretail_app;
COMMIT;
