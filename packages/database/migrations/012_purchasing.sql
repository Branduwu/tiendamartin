BEGIN;
SET LOCAL ROLE smartretail_owner;
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_permission_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_permission_check CHECK(permission IN (
 'products.read','products.write','locations.read','locations.write','inventory.read','inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage',
 'sales.read','sales.create','sales.return','cash.read','cash.open','cash.move','cash.close',
 'suppliers.read','suppliers.write','purchases.read','purchases.write','purchases.receive'));
INSERT INTO retail.role_permissions SELECT r,p FROM unnest(ARRAY['owner','admin']) r CROSS JOIN unnest(ARRAY['suppliers.read','suppliers.write','purchases.read','purchases.write','purchases.receive']) p;
INSERT INTO retail.role_permissions SELECT 'inventory_clerk',p FROM unnest(ARRAY['suppliers.read','purchases.read','purchases.receive']) p;

CREATE TABLE retail.suppliers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES retail.tenants,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200 AND length(btrim(name))>0),
 contact_name text CHECK(length(contact_name) BETWEEN 1 AND 200), phone text CHECK(length(phone) BETWEEN 1 AND 50),
 email text CHECK(length(email) BETWEEN 1 AND 254), notes text CHECK(length(notes) BETWEEN 1 AND 2000),
 status text NOT NULL CHECK(status IN ('active','inactive')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(tenant_id,id)
);
CREATE TABLE retail.purchase_orders (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES retail.tenants,
 supplier_id uuid NOT NULL, location_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ordered','partially_received','received','cancelled')),
 notes text CHECK(length(notes)<=2000), created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), ordered_at timestamptz,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,id,location_id),
 FOREIGN KEY(tenant_id,supplier_id) REFERENCES retail.suppliers(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id),
 CHECK((status='draft' AND ordered_at IS NULL) OR (status IN ('ordered','partially_received','received') AND ordered_at IS NOT NULL) OR status='cancelled')
);
CREATE TABLE retail.purchase_order_lines (
 tenant_id uuid NOT NULL, purchase_id uuid NOT NULL, product_id uuid NOT NULL, unit text NOT NULL,
 quantity_ordered bigint NOT NULL CHECK(quantity_ordered>0 AND (unit<>'piece' OR quantity_ordered%1000=0)),
 quantity_received bigint NOT NULL DEFAULT 0 CHECK(quantity_received>=0 AND quantity_received<=quantity_ordered AND (unit<>'piece' OR quantity_received%1000=0)),
 unit_cost bigint NOT NULL CHECK(unit_cost>=0), currency text NOT NULL DEFAULT 'MXN' CHECK(currency='MXN'),
 PRIMARY KEY(tenant_id,purchase_id,product_id), UNIQUE(tenant_id,purchase_id,product_id,unit),
 FOREIGN KEY(tenant_id,purchase_id) REFERENCES retail.purchase_orders(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id,unit) REFERENCES retail.products(tenant_id,id,unit)
);
CREATE TABLE retail.purchase_receipts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, purchase_id uuid NOT NULL, location_id uuid NOT NULL,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
 command_payload text NOT NULL CHECK(octet_length(command_payload) BETWEEN 1 AND 16384),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,id,purchase_id),
 FOREIGN KEY(tenant_id,purchase_id,location_id) REFERENCES retail.purchase_orders(tenant_id,id,location_id)
);
ALTER TABLE retail.inventory_movements ADD COLUMN purchase_receipt_id uuid;
ALTER TABLE retail.inventory_movements ADD CONSTRAINT movement_purchase_receipt_fk FOREIGN KEY(tenant_id,purchase_receipt_id) REFERENCES retail.purchase_receipts(tenant_id,id);
ALTER TABLE retail.inventory_movements ADD CONSTRAINT purchase_receipt_only CHECK(purchase_receipt_id IS NULL OR (type='receipt' AND sale_id IS NULL AND sale_return_id IS NULL));
CREATE TABLE retail.purchase_receipt_lines (
 tenant_id uuid NOT NULL, receipt_id uuid NOT NULL, purchase_id uuid NOT NULL, product_id uuid NOT NULL, unit text NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>0 AND (unit<>'piece' OR quantity%1000=0)), movement_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(tenant_id,receipt_id,product_id),
 FOREIGN KEY(tenant_id,receipt_id,purchase_id) REFERENCES retail.purchase_receipts(tenant_id,id,purchase_id),
 FOREIGN KEY(tenant_id,purchase_id,product_id,unit) REFERENCES retail.purchase_order_lines(tenant_id,purchase_id,product_id,unit),
 FOREIGN KEY(tenant_id,movement_id) REFERENCES retail.inventory_movements(tenant_id,id)
);
CREATE TABLE retail.purchasing_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES retail.tenants,
 actor_user_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('suppliers.create','suppliers.update','purchases.create','purchases.update','purchases.order','purchases.cancel','purchases.receive')),
 entity_id uuid NOT NULL,correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX supplier_list ON retail.suppliers(tenant_id,name,id);
CREATE INDEX purchase_list ON retail.purchase_orders(tenant_id,created_at DESC,id);
CREATE INDEX purchase_supplier ON retail.purchase_orders(tenant_id,supplier_id);
CREATE INDEX purchase_product ON retail.purchase_order_lines(tenant_id,product_id);
CREATE INDEX purchase_receipt_history ON retail.purchase_receipts(tenant_id,purchase_id,created_at);
CREATE INDEX receipt_line_order ON retail.purchase_receipt_lines(tenant_id,purchase_id,product_id);
CREATE INDEX movement_purchase_receipt ON retail.inventory_movements(tenant_id,purchase_receipt_id) WHERE purchase_receipt_id IS NOT NULL;
CREATE INDEX purchase_audit_history ON retail.purchasing_audit(tenant_id,entity_id,created_at);

DO $$ DECLARE tbl text; perm text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['suppliers','purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','purchasing_audit'] LOOP
  perm:=CASE WHEN tbl='suppliers' THEN 'suppliers.read' ELSE 'purchases.read' END;
  EXECUTE format('ALTER TABLE retail.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE retail.%I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY purchasing_tenant ON retail.%I AS RESTRICTIVE USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member())',tbl);
  EXECUTE format('CREATE POLICY purchasing_read ON retail.%I FOR SELECT USING(retail.has_permission(%L))',tbl,perm);
  EXECUTE format('GRANT SELECT ON retail.%I TO smartretail_app',tbl);
 END LOOP;
END $$;
CREATE POLICY supplier_insert ON retail.suppliers FOR INSERT WITH CHECK(retail.has_permission('suppliers.write'));
CREATE POLICY supplier_update ON retail.suppliers FOR UPDATE USING(retail.has_permission('suppliers.write')) WITH CHECK(retail.has_permission('suppliers.write'));
GRANT INSERT(id,tenant_id,name,contact_name,phone,email,notes,status), UPDATE(name,contact_name,phone,email,notes,status) ON retail.suppliers TO smartretail_app;
CREATE POLICY purchase_insert ON retail.purchase_orders FOR INSERT WITH CHECK(retail.has_permission('purchases.write'));
CREATE POLICY purchase_update ON retail.purchase_orders FOR UPDATE USING(retail.has_permission('purchases.write') OR retail.has_permission('purchases.receive')) WITH CHECK(retail.has_permission('purchases.write') OR retail.has_permission('purchases.receive'));
GRANT INSERT(id,tenant_id,supplier_id,location_id,notes,created_by), UPDATE(supplier_id,location_id,notes,status,ordered_at) ON retail.purchase_orders TO smartretail_app;
CREATE POLICY purchase_line_insert ON retail.purchase_order_lines FOR INSERT WITH CHECK(retail.has_permission('purchases.write'));
CREATE POLICY purchase_line_delete ON retail.purchase_order_lines FOR DELETE USING(retail.has_permission('purchases.write'));
CREATE POLICY purchase_line_update ON retail.purchase_order_lines FOR UPDATE USING(retail.has_permission('purchases.receive')) WITH CHECK(retail.has_permission('purchases.receive'));
GRANT INSERT(tenant_id,purchase_id,product_id,unit,quantity_ordered,unit_cost),DELETE,UPDATE(quantity_received) ON retail.purchase_order_lines TO smartretail_app;
CREATE POLICY receipt_insert ON retail.purchase_receipts FOR INSERT WITH CHECK(retail.has_permission('purchases.receive'));
CREATE POLICY receipt_line_insert ON retail.purchase_receipt_lines FOR INSERT WITH CHECK(retail.has_permission('purchases.receive'));
GRANT INSERT(id,tenant_id,purchase_id,location_id,created_by,command_payload) ON retail.purchase_receipts TO smartretail_app;
GRANT INSERT ON retail.purchase_receipt_lines TO smartretail_app;
CREATE POLICY purchasing_audit_insert ON retail.purchasing_audit FOR INSERT WITH CHECK(retail.has_permission('suppliers.write') OR retail.has_permission('purchases.write') OR retail.has_permission('purchases.receive'));
-- Audit is written only by the constrained table triggers, not by the runtime.
CREATE FUNCTION retail.audit_purchasing() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE act text; entity uuid; tenant uuid;
BEGIN
 IF TG_TABLE_NAME='purchase_order_lines' THEN
  IF TG_OP='DELETE' THEN entity:=OLD.purchase_id;tenant:=OLD.tenant_id; ELSE entity:=NEW.purchase_id;tenant:=NEW.tenant_id; END IF;
  act:='purchases.update';
 ELSE
  entity:=NEW.id;tenant:=NEW.tenant_id;
 IF TG_TABLE_NAME='suppliers' THEN
  act:=CASE WHEN TG_OP='INSERT' THEN 'suppliers.create' ELSE 'suppliers.update' END;
 ELSIF TG_TABLE_NAME='purchase_receipts' THEN act:='purchases.receive';
 ELSIF TG_OP='INSERT' THEN act:='purchases.create';
 ELSIF NEW.status='ordered' AND OLD.status='draft' THEN act:='purchases.order';
 ELSIF NEW.status='cancelled' AND OLD.status<>'cancelled' THEN act:='purchases.cancel';
 ELSE act:='purchases.update'; END IF;
 END IF;
 INSERT INTO retail.purchasing_audit(tenant_id,actor_user_id,action,entity_id,correlation_id)
 VALUES(tenant,nullif(current_setting('app.user_id',true),'')::uuid,act,entity,nullif(current_setting('app.correlation_id',true),'')::uuid);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.audit_purchasing() FROM PUBLIC;
CREATE TRIGGER supplier_audit AFTER INSERT OR UPDATE ON retail.suppliers FOR EACH ROW EXECUTE FUNCTION retail.audit_purchasing();
CREATE TRIGGER purchase_audit AFTER INSERT OR UPDATE ON retail.purchase_orders FOR EACH ROW EXECUTE FUNCTION retail.audit_purchasing();
CREATE TRIGGER purchase_line_audit AFTER INSERT OR UPDATE OR DELETE ON retail.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION retail.audit_purchasing();
CREATE TRIGGER receipt_audit AFTER INSERT ON retail.purchase_receipts FOR EACH ROW EXECUTE FUNCTION retail.audit_purchasing();
CREATE TRIGGER purchasing_audit_immutable BEFORE UPDATE OR DELETE ON retail.purchasing_audit FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE TRIGGER purchase_receipt_immutable BEFORE UPDATE OR DELETE ON retail.purchase_receipts FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE TRIGGER purchase_receipt_line_immutable BEFORE UPDATE OR DELETE ON retail.purchase_receipt_lines FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();

CREATE FUNCTION retail.guard_purchase() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid THEN RAISE EXCEPTION 'Invalid purchase creator' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.tenant_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Immutable purchase identity' USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('received','cancelled') OR
   (OLD.status<>'draft' AND ROW(NEW.supplier_id,NEW.location_id,NEW.notes,NEW.ordered_at) IS DISTINCT FROM ROW(OLD.supplier_id,OLD.location_id,OLD.notes,OLD.ordered_at)) OR
   NOT ((OLD.status='draft' AND NEW.status IN ('draft','ordered','cancelled') AND retail.has_permission('purchases.write')) OR
    (OLD.status IN ('ordered','partially_received') AND NEW.status='cancelled' AND retail.has_permission('purchases.write')) OR
    (OLD.status IN ('ordered','partially_received') AND NEW.status IN ('partially_received','received') AND retail.has_permission('purchases.receive')))
   THEN RAISE EXCEPTION 'Invalid purchase transition' USING ERRCODE='P0001'; END IF;
 END IF;
 IF NEW.status IN ('draft','ordered') AND (NOT EXISTS(SELECT 1 FROM retail.suppliers WHERE tenant_id=NEW.tenant_id AND id=NEW.supplier_id AND status='active') OR NOT EXISTS(SELECT 1 FROM retail.inventory_locations WHERE tenant_id=NEW.tenant_id AND id=NEW.location_id AND status='active')) THEN RAISE EXCEPTION 'Inactive purchase reference' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_purchase() FROM PUBLIC;
CREATE TRIGGER purchase_guard BEFORE INSERT OR UPDATE ON retail.purchase_orders FOR EACH ROW EXECUTE FUNCTION retail.guard_purchase();

CREATE FUNCTION retail.guard_purchase_line() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
DECLARE p uuid; t uuid; state text; expected numeric;
BEGIN
 IF TG_OP='DELETE' THEN p:=OLD.purchase_id;t:=OLD.tenant_id; ELSE p:=NEW.purchase_id;t:=NEW.tenant_id; END IF;
 SELECT status INTO state FROM retail.purchase_orders WHERE tenant_id=t AND id=p FOR UPDATE;
 IF TG_OP IN ('INSERT','DELETE') THEN
  IF state IS DISTINCT FROM 'draft' OR NOT retail.has_permission('purchases.write') THEN RAISE EXCEPTION 'Draft lines only' USING ERRCODE='P0001'; END IF;
  IF TG_OP='INSERT' AND (NEW.quantity_received<>0 OR NOT EXISTS(SELECT 1 FROM retail.products WHERE tenant_id=t AND id=NEW.product_id AND unit=NEW.unit AND status='active')) THEN RAISE EXCEPTION 'Invalid purchase line' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT coalesce(sum(quantity),0) INTO expected FROM retail.purchase_receipt_lines WHERE tenant_id=t AND purchase_id=p AND product_id=NEW.product_id;
  IF state NOT IN ('ordered','partially_received') OR NOT retail.has_permission('purchases.receive') OR
   ROW(NEW.tenant_id,NEW.purchase_id,NEW.product_id,NEW.unit,NEW.quantity_ordered,NEW.unit_cost,NEW.currency) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.purchase_id,OLD.product_id,OLD.unit,OLD.quantity_ordered,OLD.unit_cost,OLD.currency)
   OR NEW.quantity_received<=OLD.quantity_received OR NEW.quantity_received<>expected THEN RAISE EXCEPTION 'Receipt ledger required' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_purchase_line() FROM PUBLIC;
CREATE TRIGGER purchase_line_guard BEFORE INSERT OR UPDATE OR DELETE ON retail.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION retail.guard_purchase_line();

CREATE FUNCTION retail.guard_purchase_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
DECLARE p retail.purchase_orders;
BEGIN
 SELECT * INTO p FROM retail.purchase_orders WHERE tenant_id=NEW.tenant_id AND id=NEW.purchase_id FOR UPDATE;
 IF p.status NOT IN ('ordered','partially_received') OR p.status IS NULL OR p.location_id<>NEW.location_id OR NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid OR NOT EXISTS(SELECT 1 FROM retail.inventory_locations WHERE tenant_id=NEW.tenant_id AND id=NEW.location_id AND status='active') THEN RAISE EXCEPTION 'Purchase cannot receive' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_purchase_receipt() FROM PUBLIC;
CREATE TRIGGER purchase_receipt_guard BEFORE INSERT ON retail.purchase_receipts FOR EACH ROW EXECUTE FUNCTION retail.guard_purchase_receipt();

CREATE FUNCTION retail.check_purchase_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE p uuid; state text; n bigint; remaining bigint; delivered bigint;
BEGIN
 IF TG_TABLE_NAME='purchase_orders' THEN p:=NEW.id;
 ELSIF TG_OP='DELETE' THEN p:=OLD.purchase_id; ELSE p:=NEW.purchase_id; END IF;
 SELECT status INTO state FROM retail.purchase_orders WHERE tenant_id=coalesce(NEW.tenant_id,OLD.tenant_id) AND id=p;
 SELECT count(*),count(*) FILTER(WHERE quantity_received<quantity_ordered),count(*) FILTER(WHERE quantity_received>0) INTO n,remaining,delivered FROM retail.purchase_order_lines WHERE tenant_id=coalesce(NEW.tenant_id,OLD.tenant_id) AND purchase_id=p;
 IF n<1 OR n>50 OR (state IN ('draft','ordered') AND delivered<>0) OR (state='partially_received' AND (delivered=0 OR remaining=0)) OR (state='received' AND remaining<>0)
 OR EXISTS(SELECT 1 FROM retail.purchase_order_lines l WHERE l.tenant_id=coalesce(NEW.tenant_id,OLD.tenant_id) AND l.purchase_id=p AND l.quantity_received<>(SELECT coalesce(sum(r.quantity),0) FROM retail.purchase_receipt_lines r WHERE r.tenant_id=l.tenant_id AND r.purchase_id=l.purchase_id AND r.product_id=l.product_id)) THEN RAISE EXCEPTION 'Incomplete purchase transaction' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION retail.check_purchase_complete() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER purchase_complete AFTER INSERT OR UPDATE ON retail.purchase_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_purchase_complete();
CREATE CONSTRAINT TRIGGER purchase_lines_complete AFTER INSERT OR UPDATE OR DELETE ON retail.purchase_order_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_purchase_complete();

CREATE FUNCTION retail.check_purchase_receipt_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE rid uuid; r retail.purchase_receipts; n bigint;
BEGIN
 IF TG_TABLE_NAME='purchase_receipts' THEN rid:=NEW.id; ELSIF TG_TABLE_NAME='inventory_movements' THEN rid:=NEW.purchase_receipt_id; ELSE rid:=NEW.receipt_id; END IF;
 IF rid IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO r FROM retail.purchase_receipts WHERE tenant_id=NEW.tenant_id AND id=rid;
 SELECT count(*) INTO n FROM retail.purchase_receipt_lines WHERE tenant_id=NEW.tenant_id AND receipt_id=rid;
 IF r.id IS NULL OR r.created_tx<>pg_current_xact_id() OR n<1 OR n>50 OR (SELECT count(*) FROM retail.inventory_movements WHERE tenant_id=NEW.tenant_id AND purchase_receipt_id=rid)<>n OR
 EXISTS(SELECT 1 FROM retail.purchase_receipt_lines l LEFT JOIN retail.inventory_movements m ON m.tenant_id=l.tenant_id AND m.id=l.movement_id WHERE l.tenant_id=NEW.tenant_id AND l.receipt_id=rid AND (m.id IS NULL OR m.purchase_receipt_id IS DISTINCT FROM rid OR m.type<>'receipt' OR m.product_id<>l.product_id OR m.location_id<>r.location_id OR m.unit<>l.unit OR m.amount<>l.quantity)) OR
 EXISTS(SELECT 1 FROM retail.purchase_receipt_lines l WHERE l.tenant_id=NEW.tenant_id AND l.receipt_id=rid AND (l.purchase_id<>r.purchase_id OR NOT EXISTS(SELECT 1 FROM retail.purchase_order_lines o WHERE o.tenant_id=l.tenant_id AND o.purchase_id=l.purchase_id AND o.product_id=l.product_id AND o.quantity_received=(SELECT sum(q.quantity) FROM retail.purchase_receipt_lines q WHERE q.tenant_id=l.tenant_id AND q.purchase_id=l.purchase_id AND q.product_id=l.product_id))))
 THEN RAISE EXCEPTION 'Incomplete purchase receipt ledger' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION retail.check_purchase_receipt_complete() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER purchase_receipt_complete AFTER INSERT ON retail.purchase_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_purchase_receipt_complete();
CREATE CONSTRAINT TRIGGER purchase_receipt_lines_complete AFTER INSERT ON retail.purchase_receipt_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_purchase_receipt_complete();
CREATE CONSTRAINT TRIGGER purchase_inventory_complete AFTER INSERT ON retail.inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_purchase_receipt_complete();
COMMIT;
