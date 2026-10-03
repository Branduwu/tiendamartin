BEGIN;
SET LOCAL ROLE smartretail_owner;
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_permission_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_permission_check CHECK(permission IN (
  'products.read','products.write','locations.read','locations.write','inventory.read',
  'inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage','sales.read','sales.create'));
INSERT INTO retail.role_permissions SELECT r,p FROM unnest(ARRAY['owner','admin']) r CROSS JOIN unnest(ARRAY['sales.read','sales.create']) p;

CREATE TABLE retail.sales (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES retail.tenants,
  location_id uuid NOT NULL, status text NOT NULL CHECK(status='completed'),
  currency text NOT NULL DEFAULT 'MXN' CHECK(currency='MXN'),
  total_minor_units bigint NOT NULL CHECK(total_minor_units>=0),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
  command_payload text NOT NULL CHECK(octet_length(command_payload) BETWEEN 1 AND 65536),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id)
);
ALTER TABLE retail.inventory_movements ADD COLUMN sale_id uuid;
ALTER TABLE retail.inventory_movements ADD CONSTRAINT movement_sale_fk FOREIGN KEY(tenant_id,sale_id)
  REFERENCES retail.sales(tenant_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE retail.inventory_movements ADD CONSTRAINT sale_issue_only CHECK(sale_id IS NULL OR type='issue');
CREATE INDEX movement_sale ON retail.inventory_movements(tenant_id,sale_id) WHERE sale_id IS NOT NULL;
CREATE TABLE retail.sale_lines (
  tenant_id uuid NOT NULL, sale_id uuid NOT NULL, product_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal>=0), sku text NOT NULL, product_name text NOT NULL,
  unit text NOT NULL, quantity_milli_units bigint NOT NULL CHECK(quantity_milli_units>0),
  unit_price_minor_units bigint NOT NULL CHECK(unit_price_minor_units>=0),
  line_total_minor_units bigint NOT NULL CHECK(line_total_minor_units>=0),
  movement_id uuid NOT NULL UNIQUE,
  PRIMARY KEY(tenant_id,sale_id,product_id), UNIQUE(tenant_id,sale_id,ordinal),
  FOREIGN KEY(tenant_id,sale_id) REFERENCES retail.sales(tenant_id,id),
  FOREIGN KEY(tenant_id,product_id,unit) REFERENCES retail.products(tenant_id,id,unit),
  FOREIGN KEY(tenant_id,movement_id) REFERENCES retail.inventory_movements(tenant_id,id),
  CHECK(line_total_minor_units::numeric=div(unit_price_minor_units::numeric*quantity_milli_units::numeric+500,1000))
);
CREATE TABLE retail.sale_payments (
  tenant_id uuid NOT NULL, sale_id uuid NOT NULL, method text NOT NULL CHECK(method IN ('cash','card')),
  currency text NOT NULL DEFAULT 'MXN' CHECK(currency='MXN'), amount_minor_units bigint NOT NULL CHECK(amount_minor_units>0),
  PRIMARY KEY(tenant_id,sale_id,method), FOREIGN KEY(tenant_id,sale_id) REFERENCES retail.sales(tenant_id,id)
);
DO $$ DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['sales','sale_lines','sale_payments'] LOOP
    EXECUTE format('ALTER TABLE retail.%I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('ALTER TABLE retail.%I FORCE ROW LEVEL SECURITY',tbl);
    EXECUTE format('CREATE POLICY sale_tenant ON retail.%I AS RESTRICTIVE USING
      (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member())
      WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member())',tbl);
    EXECUTE format('CREATE POLICY sale_read ON retail.%I FOR SELECT USING(retail.has_permission(''sales.read''))',tbl);
    EXECUTE format('CREATE POLICY sale_insert ON retail.%I FOR INSERT WITH CHECK(retail.has_permission(''sales.create''))',tbl);
    EXECUTE format('GRANT SELECT ON retail.%I TO smartretail_app',tbl);
  END LOOP;
END $$;
GRANT INSERT(id,tenant_id,location_id,status,currency,total_minor_units,created_by,command_payload) ON retail.sales TO smartretail_app;
GRANT INSERT ON retail.sale_lines,retail.sale_payments TO smartretail_app;

CREATE FUNCTION retail.sale_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,retail AS $$
BEGIN RAISE EXCEPTION 'Recorded sale is immutable' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION retail.sale_immutable() FROM PUBLIC;
CREATE TRIGGER immutable_sale BEFORE UPDATE OR DELETE ON retail.sales FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE TRIGGER immutable_sale_line BEFORE UPDATE OR DELETE ON retail.sale_lines FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE TRIGGER immutable_sale_payment BEFORE UPDATE OR DELETE ON retail.sale_payments FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();

CREATE FUNCTION retail.validate_sale_header() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid OR
     NOT EXISTS(SELECT 1 FROM retail.inventory_locations l WHERE l.tenant_id=NEW.tenant_id AND l.id=NEW.location_id AND l.status='active')
  THEN RAISE EXCEPTION 'Invalid sale context' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.validate_sale_header() FROM PUBLIC;
CREATE TRIGGER sale_context BEFORE INSERT ON retail.sales FOR EACH ROW EXECUTE FUNCTION retail.validate_sale_header();

-- No child may be appended to a sale committed by an earlier transaction.
CREATE FUNCTION retail.validate_sale_child() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM retail.sales s WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.sale_id AND s.created_tx=pg_current_xact_id())
  THEN RAISE EXCEPTION 'Sale transaction is closed' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='sale_lines' THEN
    PERFORM 1 FROM retail.products p WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.product_id
      AND p.status='active' AND p.unit=NEW.unit AND p.sale_price=NEW.unit_price_minor_units AND p.sku=NEW.sku AND p.name=NEW.product_name FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid trusted sale snapshot' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.validate_sale_child() FROM PUBLIC;
CREATE TRIGGER sale_line_context BEFORE INSERT ON retail.sale_lines FOR EACH ROW EXECUTE FUNCTION retail.validate_sale_child();
CREATE TRIGGER sale_payment_context BEFORE INSERT ON retail.sale_payments FOR EACH ROW EXECUTE FUNCTION retail.validate_sale_child();

CREATE FUNCTION retail.check_sale_complete() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
DECLARE sid uuid; tid uuid; expected bigint; location uuid; line_count bigint;
BEGIN
  IF TG_TABLE_NAME='sales' THEN sid:=NEW.id; ELSE sid:=NEW.sale_id; END IF;
  tid:=NEW.tenant_id;
  IF sid IS NULL THEN RETURN NEW; END IF;
  SELECT s.total_minor_units,s.location_id INTO expected,location FROM retail.sales s WHERE s.tenant_id=tid AND s.id=sid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing sale' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO line_count FROM retail.sale_lines l WHERE l.tenant_id=tid AND l.sale_id=sid;
  IF line_count=0 OR
    (SELECT coalesce(sum(l.line_total_minor_units),0) FROM retail.sale_lines l WHERE l.tenant_id=tid AND l.sale_id=sid)<>expected OR
    (SELECT coalesce(sum(p.amount_minor_units),0) FROM retail.sale_payments p WHERE p.tenant_id=tid AND p.sale_id=sid)<>expected OR
    (SELECT count(*) FROM retail.inventory_movements m WHERE m.tenant_id=tid AND m.sale_id=sid)<>line_count OR
    EXISTS(SELECT 1 FROM retail.sale_lines l LEFT JOIN retail.inventory_movements m ON m.tenant_id=l.tenant_id AND m.id=l.movement_id
      WHERE l.tenant_id=tid AND l.sale_id=sid AND (m.id IS NULL OR m.sale_id IS DISTINCT FROM sid OR m.type<>'issue' OR
        m.product_id<>l.product_id OR m.location_id<>location OR m.unit<>l.unit OR m.amount<>l.quantity_milli_units))
  THEN RAISE EXCEPTION 'Incomplete sale transaction' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.check_sale_complete() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER sale_complete AFTER INSERT ON retail.sales DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_sale_complete();
CREATE CONSTRAINT TRIGGER sale_line_complete AFTER INSERT ON retail.sale_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_sale_complete();
CREATE CONSTRAINT TRIGGER sale_payment_complete AFTER INSERT ON retail.sale_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_sale_complete();
CREATE CONSTRAINT TRIGGER sale_movement_complete AFTER INSERT ON retail.inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_sale_complete();
COMMIT;
