BEGIN;
CREATE ROLE smartretail_payables_guard NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT smartretail_payables_guard TO smartretail_owner;
SET LOCAL ROLE smartretail_owner;
GRANT USAGE,CREATE ON SCHEMA retail TO smartretail_payables_guard;
GRANT SELECT ON retail.tenant_memberships,retail.role_permissions,retail.purchase_orders,retail.purchase_order_lines,retail.suppliers,retail.inventory_locations,retail.cash_register_shifts,retail.cash_movements,retail.sales,retail.sale_payments,retail.sale_returns TO smartretail_payables_guard;
GRANT EXECUTE ON FUNCTION retail.has_permission(text),retail.is_active_member(),retail.has_location_access(uuid),retail.lock_cash_shift(uuid),retail.cash_expected(uuid) TO smartretail_payables_guard;
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_permission_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_permission_check CHECK(permission IN (
'products.read','products.write','locations.read','locations.write','inventory.read','inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage',
'sales.read','sales.create','sales.return','cash.read','cash.open','cash.move','cash.close','suppliers.read','suppliers.write','purchases.read','purchases.write','purchases.receive','customers.read','customers.write','reports.read','inventory.minimum.write','sales.discount','promotions.read','promotions.write','taxes.manage','credit.manage','receivables.read','receivables.pay','payables.read','payables.pay','expenses.read','expenses.write'));

INSERT INTO retail.role_permissions SELECT r,p FROM unnest(ARRAY['owner','admin']) r CROSS JOIN unnest(ARRAY['payables.read','payables.pay','expenses.read','expenses.write']) p;
INSERT INTO retail.role_permissions VALUES('cashier','expenses.read');
CREATE TABLE retail.payables(
 tenant_id uuid NOT NULL REFERENCES retail.tenants,id uuid NOT NULL,purchase_order_id uuid NOT NULL,supplier_id uuid NOT NULL,location_id uuid NOT NULL,
 supplier_name text NOT NULL CHECK(length(supplier_name) BETWEEN 1 AND 200),
 original_minor_units bigint NOT NULL CHECK(original_minor_units>=0),outstanding_minor_units bigint NOT NULL CHECK(outstanding_minor_units BETWEEN 0 AND original_minor_units),
 status text NOT NULL CHECK(status IN('open','partially_paid','paid')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,purchase_order_id),CHECK(id=purchase_order_id),
 FOREIGN KEY(tenant_id,purchase_order_id) REFERENCES retail.purchase_orders(tenant_id,id),
 FOREIGN KEY(tenant_id,supplier_id) REFERENCES retail.suppliers(tenant_id,id),FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id)
);
CREATE INDEX payable_supplier ON retail.payables(tenant_id,supplier_id,created_at DESC,id DESC);
CREATE TABLE retail.payable_payments(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL, payable_id uuid NOT NULL, location_id uuid NOT NULL,
 method text NOT NULL CHECK(method IN('cash','card','bank')),amount_minor_units bigint NOT NULL CHECK(amount_minor_units>0),
 shift_id uuid,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
 command_payload jsonb NOT NULL,UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,payable_id) REFERENCES retail.payables(tenant_id,id),FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id),
 FOREIGN KEY(tenant_id,shift_id,location_id) REFERENCES retail.cash_register_shifts(tenant_id,id,location_id),CHECK((method='cash')=(shift_id IS NOT NULL))
);
CREATE INDEX payable_payment_history ON retail.payable_payments(tenant_id,payable_id,created_at DESC,id DESC);
CREATE TABLE retail.expenses(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES retail.tenants,
 category text NOT NULL CHECK(category IN('renta','servicios','transporte','mantenimiento','insumos','otros')),
 description text NOT NULL CHECK(length(description) BETWEEN 1 AND 500 AND btrim(description)=description AND description !~ '[[:cntrl:]]'),
 amount_minor_units bigint NOT NULL CHECK(amount_minor_units>0),method text NOT NULL CHECK(method IN('cash','card','bank')),location_id uuid,
 shift_id uuid,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
 command_payload jsonb NOT NULL,UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id),
 FOREIGN KEY(tenant_id,shift_id,location_id) REFERENCES retail.cash_register_shifts(tenant_id,id,location_id),
 CHECK((method='cash')=(shift_id IS NOT NULL)),CHECK(method<>'cash' OR location_id IS NOT NULL)
);
CREATE INDEX expense_history ON retail.expenses(tenant_id,created_at DESC,id DESC);
CREATE TABLE retail.payables_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES retail.tenants,actor_user_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('payables.create','payables.pay','expenses.create')),entity_id uuid NOT NULL,correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),metadata jsonb NOT NULL
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['payables','payable_payments','expenses','payables_audit'] LOOP
 EXECUTE format('ALTER TABLE retail.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE retail.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY financial_tenant ON retail.%I AS RESTRICTIVE USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member())',t);
 EXECUTE format('CREATE POLICY financial_guard ON retail.%I TO smartretail_payables_guard USING(true) WITH CHECK(true)',t);
 EXECUTE format('GRANT SELECT ON retail.%I TO smartretail_app',t);
 END LOOP;
END $$;
CREATE POLICY payable_read ON retail.payables FOR SELECT TO smartretail_app USING(retail.has_permission('payables.read') OR retail.has_permission('reports.read'));
CREATE POLICY payment_read ON retail.payable_payments FOR SELECT TO smartretail_app USING(retail.has_permission('payables.read') OR retail.has_permission('reports.read'));
CREATE POLICY expense_read ON retail.expenses FOR SELECT TO smartretail_app USING(retail.has_permission('expenses.read') OR retail.has_permission('reports.read'));
CREATE POLICY financial_audit_read ON retail.payables_audit FOR SELECT TO smartretail_app USING(retail.has_permission('payables.read'));
CREATE POLICY payable_location ON retail.payables AS RESTRICTIVE USING(retail.has_location_access(location_id)) WITH CHECK(retail.has_location_access(location_id));
CREATE POLICY payment_location ON retail.payable_payments AS RESTRICTIVE USING(retail.has_location_access(location_id)) WITH CHECK(retail.has_location_access(location_id));
CREATE POLICY expense_location ON retail.expenses AS RESTRICTIVE USING((location_id IS NULL AND retail.has_permission('expenses.write')) OR retail.has_location_access(location_id)) WITH CHECK((location_id IS NULL AND retail.has_permission('expenses.write')) OR retail.has_location_access(location_id));
GRANT SELECT,INSERT ON retail.payables,retail.payable_payments,retail.expenses,retail.payables_audit TO smartretail_payables_guard;
GRANT UPDATE(outstanding_minor_units,status) ON retail.payables TO smartretail_payables_guard;
GRANT USAGE ON SEQUENCE retail.payables_audit_id_seq TO smartretail_payables_guard;
ALTER TABLE retail.cash_movements ADD COLUMN payable_payment_id uuid,ADD COLUMN expense_id uuid;
ALTER TABLE retail.cash_movements ADD CONSTRAINT cash_payable_fk FOREIGN KEY(tenant_id,payable_payment_id) REFERENCES retail.payable_payments(tenant_id,id),
 ADD CONSTRAINT cash_expense_fk FOREIGN KEY(tenant_id,expense_id) REFERENCES retail.expenses(tenant_id,id),
 ADD CONSTRAINT cash_financial_single_source CHECK(num_nonnulls(payable_payment_id,expense_id,receivable_payment_id,sale_return_id)<=1),
 ADD CONSTRAINT cash_financial_out CHECK((payable_payment_id IS NULL AND expense_id IS NULL) OR type='cash_out');
CREATE UNIQUE INDEX cash_payable_once ON retail.cash_movements(tenant_id,payable_payment_id) WHERE payable_payment_id IS NOT NULL;
CREATE UNIQUE INDEX cash_expense_once ON retail.cash_movements(tenant_id,expense_id) WHERE expense_id IS NOT NULL;
GRANT INSERT(id,tenant_id,shift_id,type,amount,reason,created_by,payable_payment_id,expense_id) ON retail.cash_movements TO smartretail_payables_guard;

CREATE FUNCTION retail.open_purchase_payable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE amount numeric; label text;
BEGIN
 IF OLD.status='received' OR NEW.status<>'received' THEN RETURN NEW; END IF;
 IF NOT retail.has_permission('purchases.receive') OR NOT retail.has_location_access(NEW.location_id) THEN RAISE EXCEPTION 'Purchase denied' USING ERRCODE='42501'; END IF;
 SELECT coalesce(sum(div(quantity_ordered::numeric*unit_cost+500,1000)),0) INTO amount FROM retail.purchase_order_lines WHERE tenant_id=NEW.tenant_id AND purchase_id=NEW.id;
 IF amount>9223372036854775807 THEN RAISE EXCEPTION 'Purchase amount range' USING ERRCODE='22003'; END IF;
 SELECT name INTO label FROM retail.suppliers WHERE tenant_id=NEW.tenant_id AND id=NEW.supplier_id;
 INSERT INTO retail.payables(tenant_id,id,purchase_order_id,supplier_id,location_id,supplier_name,original_minor_units,outstanding_minor_units,status)
 VALUES(NEW.tenant_id,NEW.id,NEW.id,NEW.supplier_id,NEW.location_id,label,amount,amount,CASE WHEN amount=0 THEN 'paid' ELSE 'open' END);
 INSERT INTO retail.payables_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,metadata)
 VALUES(NEW.tenant_id,nullif(current_setting('app.user_id',true),'')::uuid,'payables.create',NEW.id,coalesce(nullif(current_setting('app.correlation_id',true),'')::uuid,NEW.id),jsonb_build_object('amount',amount::text));
 RETURN NEW;
END $$;
CREATE TRIGGER purchase_payable AFTER UPDATE OF status ON retail.purchase_orders FOR EACH ROW EXECUTE FUNCTION retail.open_purchase_payable();

CREATE FUNCTION retail.pay_supplier(pid uuid,aid uuid,method text,amount bigint,shift uuid,correlation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE tenant uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid; actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid;
 a retail.payables;p retail.payable_payments;intent jsonb;
BEGIN
 IF NOT retail.has_permission('payables.pay') THEN RAISE EXCEPTION 'Payment denied' USING ERRCODE='42501'; END IF;
 IF pid IS NULL OR aid IS NULL OR correlation IS NULL OR amount IS NULL OR amount<=0 OR method IS NULL OR method NOT IN('cash','card','bank') OR (method='cash')<>(shift IS NOT NULL) THEN RAISE EXCEPTION 'Invalid payment' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('smartretail.payable-payment/'||pid::text,0));
 SELECT * INTO a FROM retail.payables WHERE tenant_id=tenant AND id=aid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found' USING ERRCODE='P0002'; END IF;
 IF NOT retail.has_location_access(a.location_id) THEN RAISE EXCEPTION 'Location denied' USING ERRCODE='42501'; END IF;
 intent:=jsonb_build_object('account',aid,'method',method,'amount',amount::text,'shift',shift);
 SELECT * INTO p FROM retail.payable_payments WHERE id=pid;
 IF FOUND THEN
 IF p.tenant_id<>tenant OR p.created_by<>actor OR p.command_payload<>intent THEN RAISE EXCEPTION 'Payment conflict' USING ERRCODE='P0001'; END IF;
 RETURN true; END IF;
 IF amount>a.outstanding_minor_units THEN RAISE EXCEPTION 'Outstanding exceeded' USING ERRCODE='P0001'; END IF;
 IF method='cash' THEN
 IF NOT retail.has_permission('cash.move') THEN RAISE EXCEPTION 'Cash denied' USING ERRCODE='42501'; END IF;
 PERFORM retail.lock_cash_shift(shift);
 IF NOT EXISTS(SELECT 1 FROM retail.cash_register_shifts WHERE tenant_id=tenant AND id=shift AND location_id=a.location_id) THEN RAISE EXCEPTION 'Shift conflict' USING ERRCODE='P0001'; END IF;
 IF retail.cash_expected(shift)<amount THEN RAISE EXCEPTION 'Insufficient cash' USING ERRCODE='P0001'; END IF;
 END IF;
 INSERT INTO retail.payable_payments(id,tenant_id,payable_id,location_id,method,amount_minor_units,shift_id,created_by,command_payload)
 VALUES(pid,tenant,aid,a.location_id,method,amount,shift,actor,intent);
 IF method='cash' THEN INSERT INTO retail.cash_movements(id,tenant_id,shift_id,type,amount,reason,created_by,payable_payment_id) VALUES(pid,tenant,shift,'cash_out',amount,'Pago a proveedor',actor,pid); END IF;
 UPDATE retail.payables SET outstanding_minor_units=outstanding_minor_units-amount,status=CASE WHEN outstanding_minor_units=amount THEN 'paid' ELSE 'partially_paid' END WHERE tenant_id=tenant AND id=aid;
 INSERT INTO retail.payables_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,metadata) VALUES(tenant,actor,'payables.pay',pid,correlation,jsonb_build_object('account',aid,'amount',amount::text,'method',method));
 RETURN false;
END $$;

CREATE FUNCTION retail.create_expense(eid uuid,category text,description text,amount bigint,method text,location uuid,shift uuid,correlation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE tenant uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid;actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid;e retail.expenses;intent jsonb;
BEGIN
 IF NOT retail.has_permission('expenses.write') THEN RAISE EXCEPTION 'Expense denied' USING ERRCODE='42501'; END IF;
 IF eid IS NULL OR correlation IS NULL OR amount IS NULL OR amount<=0 OR method IS NULL OR method NOT IN('cash','card','bank') OR (method='cash')<>(shift IS NOT NULL) OR (method='cash' AND location IS NULL) OR category IS NULL OR category NOT IN('renta','servicios','transporte','mantenimiento','insumos','otros') OR description IS NULL OR length(description) NOT BETWEEN 1 AND 500 OR btrim(description)<>description OR description ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid expense' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('smartretail.expense/'||eid::text,0));
 intent:=jsonb_build_object('category',category,'description',description,'amount',amount::text,'method',method,'location',location,'shift',shift);
 SELECT * INTO e FROM retail.expenses WHERE id=eid;
 IF FOUND THEN IF e.tenant_id<>tenant OR e.created_by<>actor OR e.command_payload<>intent THEN RAISE EXCEPTION 'Expense conflict' USING ERRCODE='P0001'; END IF; RETURN true; END IF;
 IF location IS NOT NULL AND NOT EXISTS(SELECT 1 FROM retail.inventory_locations WHERE tenant_id=tenant AND id=location AND status='active' AND retail.has_location_access(id)) THEN RAISE EXCEPTION 'Location denied' USING ERRCODE='42501'; END IF;
 IF method='cash' THEN
 PERFORM retail.lock_cash_shift(shift);
 IF NOT EXISTS(SELECT 1 FROM retail.cash_register_shifts WHERE tenant_id=tenant AND id=shift AND location_id=location) THEN RAISE EXCEPTION 'Shift conflict' USING ERRCODE='P0001'; END IF;
 IF retail.cash_expected(shift)<amount THEN RAISE EXCEPTION 'Insufficient cash' USING ERRCODE='P0001'; END IF;
 END IF;
 INSERT INTO retail.expenses(id,tenant_id,category,description,amount_minor_units,method,location_id,shift_id,created_by,command_payload) VALUES(eid,tenant,category,description,amount,method,location,shift,actor,intent);
 IF method='cash' THEN INSERT INTO retail.cash_movements(id,tenant_id,shift_id,type,amount,reason,created_by,expense_id) VALUES(eid,tenant,shift,'cash_out',amount,'Gasto operativo',actor,eid); END IF;
 INSERT INTO retail.payables_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,metadata) VALUES(tenant,actor,'expenses.create',eid,correlation,jsonb_build_object('amount',amount::text,'method',method,'category',category));
 RETURN false;
END $$;

CREATE FUNCTION retail.check_payables_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE a retail.payables; total numeric; source_id uuid; expected_method text; expected_amount bigint;expected_actor uuid;expected_shift uuid;expected_tx xid8;
BEGIN
 IF TG_TABLE_NAME='payables' THEN
 SELECT * INTO a FROM retail.payables WHERE tenant_id=NEW.tenant_id AND id=NEW.id;
 SELECT coalesce(sum(amount_minor_units),0) INTO total FROM retail.payable_payments WHERE tenant_id=a.tenant_id AND payable_id=a.id;
 IF a.outstanding_minor_units::numeric<>a.original_minor_units::numeric-total OR a.status<>(CASE WHEN a.outstanding_minor_units=0 THEN 'paid' WHEN total=0 THEN 'open' ELSE 'partially_paid' END) THEN RAISE EXCEPTION 'Invalid payable projection' USING ERRCODE='23514'; END IF;
 RETURN NEW;
 ELSIF TG_TABLE_NAME='cash_movements' THEN
 IF NEW.payable_payment_id IS NOT NULL THEN
 SELECT id,method,amount_minor_units,created_by,shift_id,created_tx INTO source_id,expected_method,expected_amount,expected_actor,expected_shift,expected_tx FROM retail.payable_payments WHERE tenant_id=NEW.tenant_id AND id=NEW.payable_payment_id;
 ELSIF NEW.expense_id IS NOT NULL THEN
 SELECT id,method,amount_minor_units,created_by,shift_id,created_tx INTO source_id,expected_method,expected_amount,expected_actor,expected_shift,expected_tx FROM retail.expenses WHERE tenant_id=NEW.tenant_id AND id=NEW.expense_id;
 ELSE RETURN NEW; END IF;
 IF source_id IS NULL OR NEW.id<>source_id OR expected_method<>'cash' OR NEW.type<>'cash_out' OR NEW.amount<>expected_amount OR NEW.created_by<>expected_actor OR NEW.shift_id<>expected_shift OR NEW.created_tx<>expected_tx THEN RAISE EXCEPTION 'Invalid financial cash movement' USING ERRCODE='23514'; END IF;
 RETURN NEW;
 ELSE
 IF NOT EXISTS(SELECT 1 FROM retail.payables_audit WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.id AND created_tx=NEW.created_tx AND actor_user_id=NEW.created_by) THEN RAISE EXCEPTION 'Missing financial audit' USING ERRCODE='23514'; END IF;
 IF NEW.method='cash' AND NOT EXISTS(SELECT 1 FROM retail.cash_movements WHERE tenant_id=NEW.tenant_id AND id=NEW.id AND amount=NEW.amount_minor_units AND created_tx=NEW.created_tx AND ((TG_TABLE_NAME='expenses' AND expense_id=NEW.id) OR (TG_TABLE_NAME='payable_payments' AND payable_payment_id=NEW.id))) THEN RAISE EXCEPTION 'Missing cash ledger' USING ERRCODE='23514'; END IF;
 IF NEW.method<>'cash' AND EXISTS(SELECT 1 FROM retail.cash_movements WHERE tenant_id=NEW.tenant_id AND id=NEW.id) THEN RAISE EXCEPTION 'Noncash ledger conflict' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER payable_complete AFTER INSERT OR UPDATE ON retail.payables DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_payables_complete();
CREATE CONSTRAINT TRIGGER payable_payment_complete AFTER INSERT ON retail.payable_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_payables_complete();
CREATE CONSTRAINT TRIGGER expense_complete AFTER INSERT ON retail.expenses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_payables_complete();
CREATE CONSTRAINT TRIGGER financial_cash_complete AFTER INSERT ON retail.cash_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_payables_complete();
CREATE TRIGGER payable_payment_immutable BEFORE UPDATE OR DELETE ON retail.payable_payments FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE TRIGGER expense_immutable BEFORE UPDATE OR DELETE ON retail.expenses FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE TRIGGER financial_audit_immutable BEFORE UPDATE OR DELETE ON retail.payables_audit FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['open_purchase_payable()','pay_supplier(uuid,uuid,text,bigint,uuid,uuid)','create_expense(uuid,text,text,bigint,text,uuid,uuid,uuid)','check_payables_complete()'] LOOP
 EXECUTE 'ALTER FUNCTION retail.'||signature||' OWNER TO smartretail_payables_guard';
 EXECUTE 'REVOKE ALL ON FUNCTION retail.'||signature||' FROM PUBLIC';
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION retail.pay_supplier(uuid,uuid,text,bigint,uuid,uuid),retail.create_expense(uuid,text,text,bigint,text,uuid,uuid,uuid) TO smartretail_app;
REVOKE CREATE ON SCHEMA retail FROM smartretail_payables_guard;
COMMIT;
