BEGIN;
SET LOCAL ROLE smartretail_owner;
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_permission_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_permission_check CHECK(permission IN (
 'products.read','products.write','locations.read','locations.write','inventory.read','inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage','sales.read','sales.create','cash.read','cash.open','cash.move','cash.close'));
INSERT INTO retail.role_permissions SELECT r,p FROM unnest(ARRAY['owner','admin']) r CROSS JOIN unnest(ARRAY['cash.read','cash.open','cash.move','cash.close']) p;
CREATE TABLE retail.cash_register_shifts (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES retail.tenants,location_id uuid NOT NULL,
 opened_by uuid NOT NULL,opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),opening_cash bigint NOT NULL CHECK(opening_cash>=0),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 closed_by uuid,closed_at timestamptz,counted_cash bigint CHECK(counted_cash>=0),expected_cash bigint CHECK(expected_cash>=0),difference bigint,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,id,location_id),FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id),
 CHECK((status='open' AND closed_by IS NULL AND closed_at IS NULL AND counted_cash IS NULL AND expected_cash IS NULL AND difference IS NULL)
 OR (status='closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL AND counted_cash IS NOT NULL AND expected_cash IS NOT NULL AND difference=counted_cash::numeric-expected_cash::numeric))
);
CREATE UNIQUE INDEX cash_one_open_location ON retail.cash_register_shifts(tenant_id,location_id) WHERE status='open';
CREATE TABLE retail.cash_movements (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,shift_id uuid NOT NULL,type text NOT NULL CHECK(type IN ('cash_in','cash_out')),
 amount bigint NOT NULL CHECK(amount>0),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 200 AND btrim(reason)=reason AND reason !~ '[[:cntrl:]]'),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,shift_id) REFERENCES retail.cash_register_shifts(tenant_id,id)
);
ALTER TABLE retail.sales ADD COLUMN shift_id uuid;
ALTER TABLE retail.sales ADD CONSTRAINT sale_shift_location_fk FOREIGN KEY(tenant_id,shift_id,location_id) REFERENCES retail.cash_register_shifts(tenant_id,id,location_id);
CREATE INDEX sale_shift ON retail.sales(tenant_id,shift_id);
CREATE INDEX cash_movement_shift ON retail.cash_movements(tenant_id,shift_id);
CREATE INDEX sales_history ON retail.sales(tenant_id,created_at DESC,id DESC);
ALTER TABLE retail.cash_register_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.cash_register_shifts FORCE ROW LEVEL SECURITY;
ALTER TABLE retail.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.cash_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_shift_tenant ON retail.cash_register_shifts AS RESTRICTIVE USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member());
CREATE POLICY cash_shift_read ON retail.cash_register_shifts FOR SELECT USING(retail.has_permission('cash.read') OR retail.has_permission('sales.read') OR retail.has_permission('sales.create'));
CREATE POLICY cash_shift_open ON retail.cash_register_shifts FOR INSERT WITH CHECK(retail.has_permission('cash.open'));
-- UPDATE is reserved to scoped owner functions; the runtime has no UPDATE grant.
CREATE POLICY cash_shift_lock_close ON retail.cash_register_shifts FOR UPDATE USING(retail.has_permission('cash.close') OR retail.has_permission('cash.move') OR retail.has_permission('sales.create')) WITH CHECK(retail.has_permission('cash.close') OR retail.has_permission('cash.move') OR retail.has_permission('sales.create'));
CREATE POLICY cash_movement_tenant ON retail.cash_movements AS RESTRICTIVE USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member());
CREATE POLICY cash_movement_read ON retail.cash_movements FOR SELECT USING(retail.has_permission('cash.read'));
CREATE POLICY cash_movement_insert ON retail.cash_movements FOR INSERT WITH CHECK(retail.has_permission('cash.move'));
GRANT SELECT ON retail.cash_register_shifts,retail.cash_movements TO smartretail_app;
GRANT INSERT(id,tenant_id,location_id,opened_by,opening_cash) ON retail.cash_register_shifts TO smartretail_app;
GRANT INSERT(id,tenant_id,shift_id,type,amount,reason,created_by) ON retail.cash_movements TO smartretail_app;
GRANT INSERT(shift_id) ON retail.sales TO smartretail_app;

CREATE FUNCTION retail.lock_cash_shift(sid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE state text;
BEGIN
 IF NOT (retail.has_permission('sales.create') OR retail.has_permission('cash.move') OR retail.has_permission('cash.close')) THEN RAISE EXCEPTION 'Cash permission denied' USING ERRCODE='42501'; END IF;
 SELECT status INTO state FROM retail.cash_register_shifts WHERE id=sid AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid FOR UPDATE;
 IF state IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'Open cash shift required' USING ERRCODE='P0001'; END IF;
END $$;
REVOKE ALL ON FUNCTION retail.lock_cash_shift(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.lock_cash_shift(uuid) TO smartretail_app;
CREATE FUNCTION retail.cash_expected(sid uuid) RETURNS numeric LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
 SELECT opening_cash::numeric
 + coalesce((SELECT sum(p.amount_minor_units) FROM retail.sales s JOIN retail.sale_payments p ON p.tenant_id=s.tenant_id AND p.sale_id=s.id WHERE s.tenant_id=c.tenant_id AND s.shift_id=c.id AND p.method='cash'),0)
 + coalesce((SELECT sum(CASE WHEN m.type='cash_in' THEN m.amount::numeric ELSE -m.amount::numeric END) FROM retail.cash_movements m WHERE m.tenant_id=c.tenant_id AND m.shift_id=c.id),0)
 FROM retail.cash_register_shifts c WHERE c.id=sid;
$$;
REVOKE ALL ON FUNCTION retail.cash_expected(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.cash_expected(uuid) TO smartretail_app;
CREATE FUNCTION retail.guard_cash_shift() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Immutable cash shift' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.opened_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid OR NEW.status<>'open' OR NOT EXISTS(SELECT 1 FROM retail.inventory_locations l WHERE l.tenant_id=NEW.tenant_id AND l.id=NEW.location_id AND l.status='active') THEN RAISE EXCEPTION 'Invalid cash opening' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.status<>'open' OR NEW.status<>'closed' OR NOT retail.has_permission('cash.close') OR
   ROW(NEW.id,NEW.tenant_id,NEW.location_id,NEW.opened_by,NEW.opened_at,NEW.opening_cash) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.location_id,OLD.opened_by,OLD.opened_at,OLD.opening_cash) OR
   NEW.closed_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid OR NEW.expected_cash IS DISTINCT FROM retail.cash_expected(OLD.id)
  THEN RAISE EXCEPTION 'Invalid cash close' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_cash_shift() FROM PUBLIC;
CREATE TRIGGER cash_shift_guard BEFORE INSERT OR UPDATE OR DELETE ON retail.cash_register_shifts FOR EACH ROW EXECUTE FUNCTION retail.guard_cash_shift();
CREATE FUNCTION retail.close_cash_shift(sid uuid,counted bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE expected numeric;
BEGIN
 IF NOT retail.has_permission('cash.close') THEN RAISE EXCEPTION 'Cash close denied' USING ERRCODE='42501'; END IF;
 IF counted IS NULL OR counted<0 THEN RAISE EXCEPTION 'Invalid counted cash' USING ERRCODE='23514'; END IF;
 PERFORM retail.lock_cash_shift(sid);
 expected:=retail.cash_expected(sid);
 UPDATE retail.cash_register_shifts SET status='closed',closed_by=nullif(current_setting('app.user_id',true),'')::uuid,closed_at=clock_timestamp(),counted_cash=counted,expected_cash=expected,difference=counted::numeric-expected WHERE id=sid;
END $$;
REVOKE ALL ON FUNCTION retail.close_cash_shift(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.close_cash_shift(uuid,bigint) TO smartretail_app;
CREATE FUNCTION retail.guard_cash_movement() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
 PERFORM retail.lock_cash_shift(NEW.shift_id);
 IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid THEN RAISE EXCEPTION 'Invalid cash actor' USING ERRCODE='23514'; END IF;
 IF NEW.type='cash_out' AND retail.cash_expected(NEW.shift_id)<NEW.amount THEN RAISE EXCEPTION 'Insufficient cash' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_cash_movement() FROM PUBLIC;
CREATE TRIGGER cash_movement_guard BEFORE INSERT ON retail.cash_movements FOR EACH ROW EXECUTE FUNCTION retail.guard_cash_movement();
CREATE TRIGGER cash_movement_immutable BEFORE UPDATE OR DELETE ON retail.cash_movements FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE FUNCTION retail.guard_sale_shift() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NEW.shift_id IS NULL THEN RAISE EXCEPTION 'Open cash shift required' USING ERRCODE='P0001'; END IF;
 PERFORM retail.lock_cash_shift(NEW.shift_id);
 IF NOT EXISTS(SELECT 1 FROM retail.cash_register_shifts c WHERE c.id=NEW.shift_id AND c.tenant_id=NEW.tenant_id AND c.location_id=NEW.location_id) THEN RAISE EXCEPTION 'Invalid sale shift location' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_sale_shift() FROM PUBLIC;
CREATE TRIGGER sale_shift_guard BEFORE INSERT ON retail.sales FOR EACH ROW EXECUTE FUNCTION retail.guard_sale_shift();
-- Even inside one transaction, sale children may not be appended after closing.
CREATE FUNCTION retail.guard_sale_child_shift() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
DECLARE sid uuid;
BEGIN
 SELECT shift_id INTO sid FROM retail.sales WHERE tenant_id=NEW.tenant_id AND id=NEW.sale_id;
 IF sid IS NOT NULL THEN PERFORM retail.lock_cash_shift(sid); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_sale_child_shift() FROM PUBLIC;
CREATE TRIGGER sale_line_shift BEFORE INSERT ON retail.sale_lines FOR EACH ROW EXECUTE FUNCTION retail.guard_sale_child_shift();
CREATE TRIGGER sale_payment_shift BEFORE INSERT ON retail.sale_payments FOR EACH ROW EXECUTE FUNCTION retail.guard_sale_child_shift();
-- Reject an unclosable accumulated balance and recheck the frozen snapshot at
-- COMMIT, after every sale/payment/movement in this transaction is complete.
CREATE FUNCTION retail.check_cash_complete() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
DECLARE sid uuid; expected numeric; frozen bigint; state text;
BEGIN
 IF TG_TABLE_NAME='cash_register_shifts' THEN sid:=NEW.id;
 ELSIF TG_TABLE_NAME='cash_movements' THEN sid:=NEW.shift_id;
 ELSE SELECT shift_id INTO sid FROM retail.sales WHERE tenant_id=NEW.tenant_id AND id=NEW.sale_id;
 END IF;
 IF sid IS NULL THEN RETURN NEW; END IF;
 expected:=retail.cash_expected(sid);
 IF expected IS NULL OR expected<0 OR expected>9223372036854775807 THEN RAISE EXCEPTION 'Cash exceeds storage range' USING ERRCODE='22003'; END IF;
 SELECT status,expected_cash INTO state,frozen FROM retail.cash_register_shifts WHERE tenant_id=NEW.tenant_id AND id=sid;
 IF state='closed' AND frozen::numeric IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Cash close does not match ledger' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.check_cash_complete() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER cash_shift_complete AFTER INSERT OR UPDATE ON retail.cash_register_shifts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_cash_complete();
CREATE CONSTRAINT TRIGGER cash_movement_complete AFTER INSERT ON retail.cash_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_cash_complete();
CREATE CONSTRAINT TRIGGER cash_payment_complete AFTER INSERT ON retail.sale_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_cash_complete();
COMMIT;
