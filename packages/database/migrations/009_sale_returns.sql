BEGIN;
SET LOCAL ROLE smartretail_owner;
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_permission_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_permission_check CHECK(permission IN ('products.read','products.write','locations.read','locations.write','inventory.read','inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage','sales.read','sales.create','sales.return','cash.read','cash.open','cash.move','cash.close'));
INSERT INTO retail.role_permissions VALUES('owner','sales.return'),('admin','sales.return');
CREATE POLICY sale_return_lock ON retail.sales FOR UPDATE USING(retail.has_permission('sales.return')) WITH CHECK(retail.has_permission('sales.return'));
CREATE FUNCTION retail.lock_sale_for_return(sid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NOT retail.has_permission('sales.return') THEN RAISE EXCEPTION 'Return permission denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM retail.sales WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND id=sid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found' USING ERRCODE='P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION retail.lock_sale_for_return(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.lock_sale_for_return(uuid) TO smartretail_app;
CREATE TABLE retail.sale_returns (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,sale_id uuid NOT NULL,location_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'completed' CHECK(status='completed'),created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
 total_minor_units bigint NOT NULL CHECK(total_minor_units>=0),cash_refund_minor_units bigint NOT NULL CHECK(cash_refund_minor_units>=0),
 shift_id uuid,cash_movement_id uuid UNIQUE,command_payload text NOT NULL CHECK(octet_length(command_payload) BETWEEN 1 AND 65536),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,id,sale_id),
 FOREIGN KEY(tenant_id,sale_id) REFERENCES retail.sales(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id),
 FOREIGN KEY(tenant_id,shift_id,location_id) REFERENCES retail.cash_register_shifts(tenant_id,id,location_id),
 CHECK((cash_refund_minor_units=0 AND shift_id IS NULL AND cash_movement_id IS NULL) OR (cash_refund_minor_units>0 AND shift_id IS NOT NULL AND cash_movement_id IS NOT NULL))
);
CREATE TABLE retail.sale_return_lines (
 tenant_id uuid NOT NULL,return_id uuid NOT NULL,sale_id uuid NOT NULL,product_id uuid NOT NULL,
 unit text NOT NULL,quantity_milli_units bigint NOT NULL CHECK(quantity_milli_units>0 AND (unit<>'piece' OR quantity_milli_units%1000=0)),
 returned_before bigint NOT NULL CHECK(returned_before>=0),refunded_minor_units bigint NOT NULL CHECK(refunded_minor_units>=0),movement_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(tenant_id,return_id,product_id),FOREIGN KEY(tenant_id,return_id,sale_id) REFERENCES retail.sale_returns(tenant_id,id,sale_id),
 FOREIGN KEY(tenant_id,sale_id,product_id) REFERENCES retail.sale_lines(tenant_id,sale_id,product_id),
 FOREIGN KEY(tenant_id,movement_id) REFERENCES retail.inventory_movements(tenant_id,id)
);
CREATE TABLE retail.sale_return_refunds (
 tenant_id uuid NOT NULL,return_id uuid NOT NULL,sale_id uuid NOT NULL,
 method text NOT NULL CHECK(method IN ('cash','card')),amount_minor_units bigint NOT NULL CHECK(amount_minor_units>0),
 PRIMARY KEY(tenant_id,return_id,method),FOREIGN KEY(tenant_id,return_id,sale_id) REFERENCES retail.sale_returns(tenant_id,id,sale_id),
 FOREIGN KEY(tenant_id,sale_id,method) REFERENCES retail.sale_payments(tenant_id,sale_id,method)
);
ALTER TABLE retail.inventory_movements ADD COLUMN sale_return_id uuid;
ALTER TABLE retail.inventory_movements ADD CONSTRAINT movement_return_fk FOREIGN KEY(tenant_id,sale_return_id) REFERENCES retail.sale_returns(tenant_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE retail.inventory_movements ADD CONSTRAINT return_receipt_only CHECK(sale_return_id IS NULL OR (type='receipt' AND sale_id IS NULL));
ALTER TABLE retail.cash_movements ADD COLUMN sale_return_id uuid UNIQUE;
ALTER TABLE retail.cash_movements ADD CONSTRAINT cash_return_fk FOREIGN KEY(tenant_id,sale_return_id) REFERENCES retail.sale_returns(tenant_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE retail.cash_movements ADD CONSTRAINT return_cash_out CHECK(sale_return_id IS NULL OR type='cash_out');
ALTER TABLE retail.sale_returns ADD CONSTRAINT return_cash_movement_fk FOREIGN KEY(cash_movement_id) REFERENCES retail.cash_movements(id) DEFERRABLE INITIALLY DEFERRED;
GRANT INSERT(sale_return_id) ON retail.cash_movements TO smartretail_app;
CREATE INDEX returns_sale ON retail.sale_returns(tenant_id,sale_id,created_at,id);
CREATE INDEX return_lines_original ON retail.sale_return_lines(tenant_id,sale_id,product_id);
CREATE INDEX return_refunds_original ON retail.sale_return_refunds(tenant_id,sale_id,method);
CREATE INDEX return_movements ON retail.inventory_movements(tenant_id,sale_return_id) WHERE sale_return_id IS NOT NULL;
DO $$ DECLARE tbl text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['sale_returns','sale_return_lines','sale_return_refunds'] LOOP
  EXECUTE format('ALTER TABLE retail.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE retail.%I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY return_tenant ON retail.%I AS RESTRICTIVE USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member())',tbl);
  EXECUTE format('CREATE POLICY return_read ON retail.%I FOR SELECT USING(retail.has_permission(''sales.read'') OR retail.has_permission(''sales.return''))',tbl);
  EXECUTE format('CREATE POLICY return_insert ON retail.%I FOR INSERT WITH CHECK(retail.has_permission(''sales.return''))',tbl);
  EXECUTE format('GRANT SELECT ON retail.%I TO smartretail_app',tbl);
  EXECUTE format('CREATE TRIGGER immutable_return BEFORE UPDATE OR DELETE ON retail.%I FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable()',tbl);
 END LOOP;
END $$;
GRANT INSERT(id,tenant_id,sale_id,location_id,created_by,total_minor_units,cash_refund_minor_units,shift_id,cash_movement_id,command_payload) ON retail.sale_returns TO smartretail_app;
GRANT INSERT ON retail.sale_return_lines,retail.sale_return_refunds TO smartretail_app;
CREATE FUNCTION retail.guard_return_header() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
 PERFORM retail.lock_sale_for_return(NEW.sale_id);
 IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid OR NOT EXISTS(SELECT 1 FROM retail.sales s WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.sale_id AND s.location_id=NEW.location_id) THEN RAISE EXCEPTION 'Invalid return context' USING ERRCODE='23514'; END IF;
 IF NEW.shift_id IS NOT NULL THEN PERFORM retail.lock_cash_shift(NEW.shift_id); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_return_header() FROM PUBLIC;
CREATE TRIGGER return_header BEFORE INSERT ON retail.sale_returns FOR EACH ROW EXECUTE FUNCTION retail.guard_return_header();
CREATE FUNCTION retail.guard_return_child() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
DECLARE header retail.sale_returns; original retail.sale_lines; prior numeric; paid bigint;
BEGIN
 SELECT * INTO header FROM retail.sale_returns WHERE tenant_id=NEW.tenant_id AND id=NEW.return_id AND sale_id=NEW.sale_id AND created_tx=pg_current_xact_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Closed return transaction' USING ERRCODE='23514'; END IF;
 PERFORM retail.lock_sale_for_return(NEW.sale_id);
 IF header.shift_id IS NOT NULL THEN PERFORM retail.lock_cash_shift(header.shift_id); END IF;
 IF TG_TABLE_NAME='sale_return_lines' THEN
  SELECT * INTO original FROM retail.sale_lines WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id AND product_id=NEW.product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original line required' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(quantity_milli_units),0) INTO prior FROM retail.sale_return_lines WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id AND product_id=NEW.product_id;
  IF NEW.unit<>original.unit OR prior<>NEW.returned_before OR prior+NEW.quantity_milli_units>original.quantity_milli_units THEN RAISE EXCEPTION 'Return quantity exceeded' USING ERRCODE='P0001'; END IF;
  IF NEW.refunded_minor_units::numeric <> div(original.unit_price_minor_units::numeric*(prior+NEW.quantity_milli_units)+500,1000)-div(original.unit_price_minor_units::numeric*prior+500,1000) THEN RAISE EXCEPTION 'Historical refund mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT amount_minor_units INTO paid FROM retail.sale_payments WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id AND method=NEW.method;
  SELECT coalesce(sum(amount_minor_units),0) INTO prior FROM retail.sale_return_refunds WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id AND method=NEW.method;
  IF paid IS NULL OR prior+NEW.amount_minor_units>paid THEN RAISE EXCEPTION 'Refund method exceeded' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_return_child() FROM PUBLIC;
CREATE TRIGGER return_line_guard BEFORE INSERT ON retail.sale_return_lines FOR EACH ROW EXECUTE FUNCTION retail.guard_return_child();
CREATE TRIGGER return_refund_guard BEFORE INSERT ON retail.sale_return_refunds FOR EACH ROW EXECUTE FUNCTION retail.guard_return_child();
CREATE FUNCTION retail.guard_return_cash() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NEW.sale_return_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM retail.sale_returns r WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.sale_return_id AND r.created_tx=pg_current_xact_id() AND r.shift_id=NEW.shift_id AND r.cash_movement_id=NEW.id AND r.cash_refund_minor_units=NEW.amount AND NEW.type='cash_out') THEN RAISE EXCEPTION 'Invalid return cash ledger' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_return_cash() FROM PUBLIC;
CREATE TRIGGER return_cash_guard BEFORE INSERT ON retail.cash_movements FOR EACH ROW EXECUTE FUNCTION retail.guard_return_cash();
CREATE FUNCTION retail.check_return_complete() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
DECLARE rid uuid; r retail.sale_returns; n bigint;
BEGIN
 IF TG_TABLE_NAME='sale_returns' THEN rid:=NEW.id;
 ELSIF TG_TABLE_NAME IN ('inventory_movements','cash_movements') THEN rid:=NEW.sale_return_id;
 ELSE rid:=NEW.return_id; END IF;
 IF rid IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO r FROM retail.sale_returns WHERE tenant_id=NEW.tenant_id AND id=rid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing return' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO n FROM retail.sale_return_lines WHERE tenant_id=r.tenant_id AND return_id=rid;
 IF n<1 OR n>1000 OR (SELECT coalesce(sum(refunded_minor_units),0) FROM retail.sale_return_lines WHERE tenant_id=r.tenant_id AND return_id=rid)<>r.total_minor_units
 OR (SELECT coalesce(sum(amount_minor_units),0) FROM retail.sale_return_refunds WHERE tenant_id=r.tenant_id AND return_id=rid)<>r.total_minor_units
 OR (SELECT coalesce(sum(amount_minor_units),0) FROM retail.sale_return_refunds WHERE tenant_id=r.tenant_id AND return_id=rid AND method='cash')<>r.cash_refund_minor_units
 OR (SELECT count(*) FROM retail.inventory_movements WHERE tenant_id=r.tenant_id AND sale_return_id=rid)<>n
 OR EXISTS(SELECT 1 FROM retail.sale_return_lines l LEFT JOIN retail.inventory_movements m ON m.tenant_id=l.tenant_id AND m.id=l.movement_id WHERE l.tenant_id=r.tenant_id AND l.return_id=rid AND (m.id IS NULL OR m.sale_return_id IS DISTINCT FROM rid OR m.type<>'receipt' OR m.product_id<>l.product_id OR m.unit<>l.unit OR m.location_id<>r.location_id OR m.amount<>l.quantity_milli_units))
 OR (r.cash_refund_minor_units>0 AND NOT EXISTS(SELECT 1 FROM retail.cash_movements c WHERE c.tenant_id=r.tenant_id AND c.id=r.cash_movement_id AND c.sale_return_id=rid AND c.shift_id=r.shift_id AND c.type='cash_out' AND c.amount=r.cash_refund_minor_units))
 OR (r.cash_refund_minor_units=0 AND EXISTS(SELECT 1 FROM retail.cash_movements c WHERE c.tenant_id=r.tenant_id AND c.sale_return_id=rid))
 THEN RAISE EXCEPTION 'Incomplete return transaction' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.check_return_complete() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER return_complete AFTER INSERT ON retail.sale_returns DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_return_complete();
CREATE CONSTRAINT TRIGGER return_lines_complete AFTER INSERT ON retail.sale_return_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_return_complete();
CREATE CONSTRAINT TRIGGER return_refunds_complete AFTER INSERT ON retail.sale_return_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_return_complete();
CREATE CONSTRAINT TRIGGER return_inventory_complete AFTER INSERT ON retail.inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_return_complete();
CREATE CONSTRAINT TRIGGER return_cash_complete AFTER INSERT ON retail.cash_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_return_complete();
COMMIT;
