BEGIN;
CREATE ROLE smartretail_credit_guard NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT smartretail_credit_guard TO smartretail_owner;
SET LOCAL ROLE smartretail_owner;
GRANT USAGE,CREATE ON SCHEMA retail TO smartretail_credit_guard;
GRANT SELECT ON retail.tenant_memberships,retail.role_permissions TO smartretail_credit_guard;
GRANT EXECUTE ON FUNCTION retail.has_permission(text),retail.is_active_member(),retail.has_location_access(uuid),retail.lock_cash_shift(uuid),retail.lock_sale_for_return(uuid),retail.cash_expected(uuid) TO smartretail_credit_guard;
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_permission_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_permission_check CHECK(permission IN (
'products.read','products.write','locations.read','locations.write','inventory.read','inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage',
'sales.read','sales.create','sales.return','cash.read','cash.open','cash.move','cash.close','suppliers.read','suppliers.write','purchases.read','purchases.write','purchases.receive','customers.read','customers.write','reports.read','inventory.minimum.write','sales.discount','promotions.read','promotions.write','taxes.manage','credit.manage','receivables.read','receivables.pay'));
INSERT INTO retail.role_permissions VALUES('owner','credit.manage'),('admin','credit.manage'),('owner','receivables.read'),('admin','receivables.read'),('cashier','receivables.read'),('owner','receivables.pay'),('admin','receivables.pay'),('cashier','receivables.pay');
ALTER TABLE retail.customers ADD COLUMN credit_enabled boolean NOT NULL DEFAULT false,ADD COLUMN credit_limit_minor_units bigint CHECK(credit_limit_minor_units>=0);
GRANT UPDATE(credit_enabled,credit_limit_minor_units) ON retail.customers TO smartretail_app;
GRANT SELECT,UPDATE ON retail.customers TO smartretail_credit_guard;
CREATE POLICY credit_customer_read ON retail.customers FOR SELECT TO smartretail_credit_guard USING(true);
CREATE POLICY credit_customer_lock ON retail.customers FOR UPDATE TO smartretail_credit_guard USING(true) WITH CHECK(false);
CREATE TABLE retail.receivables(
 tenant_id uuid NOT NULL REFERENCES retail.tenants,id uuid NOT NULL,sale_id uuid NOT NULL,customer_id uuid NOT NULL,location_id uuid NOT NULL,
 customer_name text NOT NULL CHECK(length(customer_name) BETWEEN 1 AND 200),
 original_minor_units bigint NOT NULL CHECK(original_minor_units>0),outstanding_minor_units bigint NOT NULL CHECK(outstanding_minor_units BETWEEN 0 AND original_minor_units),
 status text NOT NULL CHECK(status IN('open','partially_paid','paid')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,sale_id),FOREIGN KEY(tenant_id,sale_id) REFERENCES retail.sales(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES retail.customers(tenant_id,id),FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id),CHECK(id=sale_id)
);
CREATE INDEX receivable_customer ON retail.receivables(tenant_id,customer_id,status,created_at,id);
CREATE TABLE retail.receivable_payments(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,receivable_id uuid NOT NULL,location_id uuid NOT NULL,method text NOT NULL CHECK(method IN('cash','card')),
 amount_minor_units bigint NOT NULL CHECK(amount_minor_units>0),shift_id uuid,created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),command_payload jsonb NOT NULL CHECK(octet_length(command_payload::text)<=2048),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,receivable_id) REFERENCES retail.receivables(tenant_id,id),
 FOREIGN KEY(tenant_id,shift_id,location_id) REFERENCES retail.cash_register_shifts(tenant_id,id,location_id),
 CHECK((method='cash' AND shift_id IS NOT NULL) OR (method='card' AND shift_id IS NULL))
);
CREATE INDEX receivable_payment_account ON retail.receivable_payments(tenant_id,receivable_id,created_at,id);
CREATE TABLE retail.receivable_adjustments(
 tenant_id uuid NOT NULL,return_id uuid NOT NULL,receivable_id uuid NOT NULL,location_id uuid NOT NULL,amount_minor_units bigint NOT NULL CHECK(amount_minor_units>0),created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
 PRIMARY KEY(tenant_id,return_id),FOREIGN KEY(tenant_id,receivable_id) REFERENCES retail.receivables(tenant_id,id),FOREIGN KEY(tenant_id,return_id) REFERENCES retail.sale_returns(tenant_id,id)
);
CREATE INDEX receivable_adjustment_account ON retail.receivable_adjustments(tenant_id,receivable_id);
CREATE TABLE retail.credit_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES retail.tenants,actor_user_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('credit.configure','credit.sale','receivables.pay','credit.return')),entity_id uuid NOT NULL,correlation_id uuid NOT NULL,
 metadata jsonb NOT NULL CHECK(octet_length(metadata::text)<=2048),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_tx xid8 NOT NULL DEFAULT pg_current_xact_id()
);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['receivables','receivable_payments','receivable_adjustments','credit_audit'] LOOP
  EXECUTE format('ALTER TABLE retail.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE retail.%I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY credit_tenant ON retail.%I AS RESTRICTIVE USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member())',tbl);
  EXECUTE format('CREATE POLICY credit_guard ON retail.%I TO smartretail_credit_guard USING(true) WITH CHECK(true)',tbl);
  EXECUTE format('CREATE POLICY credit_read ON retail.%I FOR SELECT USING(retail.has_permission(''receivables.read'') OR retail.has_permission(''sales.return'') OR retail.has_permission(''reports.read''))',tbl);
  EXECUTE format('GRANT SELECT ON retail.%I TO smartretail_app,smartretail_credit_guard',tbl);
  IF tbl<>'receivables' THEN EXECUTE format('CREATE TRIGGER credit_immutable BEFORE UPDATE OR DELETE ON retail.%I FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable()',tbl); END IF;
  IF tbl<>'credit_audit' THEN
   -- Entire-customer limit is visible to the guard; runtime rows remain branch-scoped.
   EXECUTE format('CREATE POLICY credit_location ON retail.%I AS RESTRICTIVE USING(current_user=''smartretail_credit_guard'' OR retail.has_location_access(location_id)) WITH CHECK(current_user=''smartretail_credit_guard'' OR retail.has_location_access(location_id))',tbl);
  END IF;
 END LOOP;
END $$;
ALTER POLICY credit_read ON retail.credit_audit USING(retail.has_permission('credit.manage'));
GRANT INSERT ON retail.receivables,retail.receivable_payments,retail.receivable_adjustments,retail.credit_audit TO smartretail_credit_guard;
GRANT UPDATE(outstanding_minor_units,status) ON retail.receivables TO smartretail_credit_guard;
GRANT SELECT ON retail.sales,retail.sale_payments,retail.sale_returns,retail.cash_register_shifts,retail.cash_movements TO smartretail_credit_guard;
ALTER TABLE retail.sale_payments DROP CONSTRAINT sale_payments_method_check;
ALTER TABLE retail.sale_payments ADD CONSTRAINT sale_payments_method_check CHECK(method IN('cash','card','credit'));
ALTER TABLE retail.sale_returns ADD COLUMN debt_reduction_minor_units bigint NOT NULL DEFAULT 0 CHECK(debt_reduction_minor_units BETWEEN 0 AND total_minor_units);
GRANT INSERT(debt_reduction_minor_units) ON retail.sale_returns TO smartretail_app;
ALTER TABLE retail.sale_return_refunds DROP CONSTRAINT sale_return_refunds_tenant_id_sale_id_method_fkey;
ALTER TABLE retail.sale_return_refunds ADD CONSTRAINT refund_settled_sale FOREIGN KEY(tenant_id,sale_id) REFERENCES retail.sales(tenant_id,id);
ALTER TABLE retail.cash_movements ADD COLUMN created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),ADD COLUMN receivable_payment_id uuid UNIQUE,
 ADD CONSTRAINT cash_receivable_fk FOREIGN KEY(tenant_id,receivable_payment_id) REFERENCES retail.receivable_payments(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT cash_receivable_only CHECK(receivable_payment_id IS NULL OR (type='cash_in' AND sale_return_id IS NULL));
GRANT INSERT(id,tenant_id,shift_id,type,amount,reason,created_by,receivable_payment_id) ON retail.cash_movements TO smartretail_credit_guard;
CREATE FUNCTION retail.guard_customer_credit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF (TG_OP='INSERT' AND (NEW.credit_enabled OR NEW.credit_limit_minor_units IS NOT NULL)) OR
    (TG_OP='UPDATE' AND (NEW.credit_enabled IS DISTINCT FROM OLD.credit_enabled OR NEW.credit_limit_minor_units IS DISTINCT FROM OLD.credit_limit_minor_units)) THEN
  IF NOT retail.has_permission('credit.manage') OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'Credit permission denied' USING ERRCODE='42501'; END IF;
  INSERT INTO retail.credit_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,metadata)
   VALUES(NEW.tenant_id,nullif(current_setting('app.user_id',true),'')::uuid,'credit.configure',NEW.id,coalesce(nullif(current_setting('app.correlation_id',true),'')::uuid,gen_random_uuid()),jsonb_build_object('enabled',NEW.credit_enabled,'limit',NEW.credit_limit_minor_units::text));
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION retail.guard_customer_credit() OWNER TO smartretail_credit_guard;
REVOKE ALL ON FUNCTION retail.guard_customer_credit() FROM PUBLIC;
CREATE TRIGGER customer_credit_guard BEFORE INSERT OR UPDATE ON retail.customers FOR EACH ROW EXECUTE FUNCTION retail.guard_customer_credit();
CREATE OR REPLACE FUNCTION retail.lock_sale_customer(cid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NOT retail.has_permission('sales.create') THEN RAISE EXCEPTION 'Sale access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM retail.customers WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND id=cid AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='P0001'; END IF;
END $$;

CREATE FUNCTION retail.validate_customer_credit(cid uuid,amount bigint) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE c retail.customers; debt numeric;
BEGIN
 IF NOT retail.has_permission('sales.create') THEN RAISE EXCEPTION 'Credit sale permission denied' USING ERRCODE='42501'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Credit requires read committed' USING ERRCODE='P0001'; END IF;
 SELECT * INTO c FROM retail.customers WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND id=cid FOR UPDATE;
 IF NOT FOUND OR c.status<>'active' OR NOT c.credit_enabled OR amount IS NULL OR amount<=0 THEN RAISE EXCEPTION 'Credit unavailable' USING ERRCODE='P0001'; END IF;
 SELECT coalesce(sum(outstanding_minor_units),0) INTO debt FROM retail.receivables WHERE tenant_id=c.tenant_id AND customer_id=cid;
 IF c.credit_limit_minor_units IS NOT NULL AND debt+amount>c.credit_limit_minor_units THEN RAISE EXCEPTION 'Credit limit exceeded' USING ERRCODE='P0001'; END IF;
END $$;
ALTER FUNCTION retail.validate_customer_credit(uuid,bigint) OWNER TO smartretail_credit_guard;
REVOKE ALL ON FUNCTION retail.validate_customer_credit(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.validate_customer_credit(uuid,bigint) TO smartretail_app;
CREATE FUNCTION retail.customer_credit_summary(cid uuid) RETURNS TABLE(outstanding text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NOT retail.has_permission('customers.read') THEN RAISE EXCEPTION 'Customer permission denied' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM retail.customers WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND id=cid) THEN RAISE EXCEPTION 'Customer not found' USING ERRCODE='P0002'; END IF;
 RETURN QUERY SELECT coalesce(sum(outstanding_minor_units),0)::text FROM retail.receivables WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND customer_id=cid;
END $$;
ALTER FUNCTION retail.customer_credit_summary(uuid) OWNER TO smartretail_credit_guard;
REVOKE ALL ON FUNCTION retail.customer_credit_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.customer_credit_summary(uuid) TO smartretail_app;
CREATE FUNCTION retail.lock_return_receivable(sid uuid) RETURNS TABLE(outstanding_minor_units text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE r retail.receivables;
BEGIN
 IF NOT retail.has_permission('sales.return') THEN RAISE EXCEPTION 'Return permission denied' USING ERRCODE='42501'; END IF;
 PERFORM retail.lock_sale_for_return(sid);
 SELECT * INTO r FROM retail.receivables WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND sale_id=sid FOR UPDATE;
 IF FOUND THEN
  IF NOT retail.has_location_access(r.location_id) THEN RAISE EXCEPTION 'Return location denied' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT r.outstanding_minor_units::text;
 END IF;
END $$;
ALTER FUNCTION retail.lock_return_receivable(uuid) OWNER TO smartretail_credit_guard;
REVOKE ALL ON FUNCTION retail.lock_return_receivable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.lock_return_receivable(uuid) TO smartretail_app;
CREATE FUNCTION retail.open_sale_receivable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE s retail.sales;
BEGIN
 IF NEW.method<>'credit' THEN RETURN NEW; END IF;
 SELECT * INTO s FROM retail.sales WHERE tenant_id=NEW.tenant_id AND id=NEW.sale_id AND created_tx=pg_current_xact_id();
 IF NOT FOUND OR s.customer_id IS NULL OR NOT retail.has_location_access(s.location_id) THEN RAISE EXCEPTION 'Invalid credit sale' USING ERRCODE='23514'; END IF;
 PERFORM retail.validate_customer_credit(s.customer_id,NEW.amount_minor_units);
 INSERT INTO retail.receivables(tenant_id,id,sale_id,customer_id,location_id,customer_name,original_minor_units,outstanding_minor_units,status)
 VALUES(s.tenant_id,s.id,s.id,s.customer_id,s.location_id,s.customer_name,NEW.amount_minor_units,NEW.amount_minor_units,'open');
 INSERT INTO retail.credit_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,metadata)
 VALUES(s.tenant_id,s.created_by,'credit.sale',s.id,coalesce(nullif(current_setting('app.correlation_id',true),'')::uuid,s.id),jsonb_build_object('amount',NEW.amount_minor_units::text));
 RETURN NEW;
END $$;
ALTER FUNCTION retail.open_sale_receivable() OWNER TO smartretail_credit_guard;
REVOKE ALL ON FUNCTION retail.open_sale_receivable() FROM PUBLIC;
CREATE TRIGGER sale_receivable AFTER INSERT ON retail.sale_payments FOR EACH ROW EXECUTE FUNCTION retail.open_sale_receivable();
CREATE FUNCTION retail.collect_receivable(pid uuid,rid uuid,method text,amount bigint,shift uuid,correlation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE r retail.receivables; p retail.receivable_payments; intent jsonb; remaining bigint; tenant uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid; actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid;
BEGIN
 IF NOT retail.has_permission('receivables.pay') THEN RAISE EXCEPTION 'Collection permission denied' USING ERRCODE='42501'; END IF;
 IF pid IS NULL OR rid IS NULL OR method IS NULL OR method NOT IN('cash','card') OR amount IS NULL OR amount<=0 OR (method='cash' AND shift IS NULL) OR (method='card' AND shift IS NOT NULL) THEN RAISE EXCEPTION 'Invalid collection' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Collection requires read committed' USING ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('smartretail.receivable/'||pid::text,0));
 SELECT * INTO r FROM retail.receivables WHERE tenant_id=tenant AND id=rid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Receivable not found' USING ERRCODE='P0002'; END IF;
 IF NOT retail.has_location_access(r.location_id) THEN RAISE EXCEPTION 'Collection location denied' USING ERRCODE='42501'; END IF;
 intent:=jsonb_build_object('id',pid,'receivableId',rid,'method',method,'amount',amount::text,'shiftId',shift);
 SELECT * INTO p FROM retail.receivable_payments WHERE id=pid;
 IF FOUND THEN
  IF p.command_payload<>intent OR p.tenant_id<>tenant OR p.created_by<>actor THEN RAISE EXCEPTION 'Payment ID conflict' USING ERRCODE='P0001'; END IF;
  RETURN true;
 END IF;
 IF amount>r.outstanding_minor_units THEN RAISE EXCEPTION 'Collection exceeds outstanding' USING ERRCODE='P0001'; END IF;
 IF method='cash' THEN
  IF NOT retail.has_permission('cash.move') THEN RAISE EXCEPTION 'Cash permission denied' USING ERRCODE='42501'; END IF;
  PERFORM retail.lock_cash_shift(shift);
  IF NOT EXISTS(SELECT 1 FROM retail.cash_register_shifts s WHERE s.tenant_id=tenant AND s.id=shift AND s.location_id=r.location_id) THEN RAISE EXCEPTION 'Collection shift mismatch' USING ERRCODE='P0001'; END IF;
 END IF;
 INSERT INTO retail.receivable_payments(id,tenant_id,receivable_id,location_id,method,amount_minor_units,shift_id,created_by,command_payload)
 VALUES(pid,tenant,rid,r.location_id,method,amount,shift,actor,intent);
 IF method='cash' THEN INSERT INTO retail.cash_movements(id,tenant_id,shift_id,type,amount,reason,created_by,receivable_payment_id) VALUES(pid,tenant,shift,'cash_in',amount,'Abono a cuenta por cobrar',actor,pid); END IF;
 remaining:=r.outstanding_minor_units-amount;
 UPDATE retail.receivables SET outstanding_minor_units=remaining,status=CASE WHEN remaining=0 THEN 'paid' ELSE 'partially_paid' END WHERE tenant_id=tenant AND id=rid;
 INSERT INTO retail.credit_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,metadata)
 VALUES(tenant,actor,'receivables.pay',pid,coalesce(correlation,pid),jsonb_build_object('receivableId',rid,'method',method,'amount',amount::text));
 RETURN false;
END $$;
ALTER FUNCTION retail.collect_receivable(uuid,uuid,text,bigint,uuid,uuid) OWNER TO smartretail_credit_guard;
REVOKE ALL ON FUNCTION retail.collect_receivable(uuid,uuid,text,bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.collect_receivable(uuid,uuid,text,bigint,uuid,uuid) TO smartretail_app;
CREATE FUNCTION retail.guard_credit_return() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE r retail.receivables; reduction bigint;
BEGIN
 IF NOT retail.has_permission('sales.return') OR NOT retail.has_location_access(NEW.location_id) THEN RAISE EXCEPTION 'Return permission denied' USING ERRCODE='42501'; END IF;
 -- Order: sale, receivable, shift, stock. Collections never subsequently lock a sale.
 PERFORM retail.lock_sale_for_return(NEW.sale_id);
 SELECT * INTO r FROM retail.receivables WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id FOR UPDATE;
 reduction:=CASE WHEN FOUND THEN least(NEW.total_minor_units,r.outstanding_minor_units) ELSE 0 END;
 IF NEW.debt_reduction_minor_units<>reduction THEN RAISE EXCEPTION 'Debt reduction mismatch' USING ERRCODE='P0001'; END IF;
 IF TG_WHEN='AFTER' AND reduction>0 THEN
  INSERT INTO retail.receivable_adjustments(tenant_id,return_id,receivable_id,location_id,amount_minor_units) VALUES(NEW.tenant_id,NEW.id,r.id,r.location_id,reduction);
  UPDATE retail.receivables SET outstanding_minor_units=outstanding_minor_units-reduction,status=CASE WHEN outstanding_minor_units=reduction THEN 'paid' ELSE 'partially_paid' END WHERE tenant_id=r.tenant_id AND id=r.id;
  INSERT INTO retail.credit_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,metadata) VALUES(NEW.tenant_id,NEW.created_by,'credit.return',NEW.id,coalesce(nullif(current_setting('app.correlation_id',true),'')::uuid,NEW.id),jsonb_build_object('receivableId',r.id,'amount',reduction::text));
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION retail.guard_credit_return() OWNER TO smartretail_credit_guard;
REVOKE ALL ON FUNCTION retail.guard_credit_return() FROM PUBLIC;
CREATE TRIGGER a_return_credit BEFORE INSERT ON retail.sale_returns FOR EACH ROW EXECUTE FUNCTION retail.guard_credit_return();
CREATE TRIGGER b_return_credit AFTER INSERT ON retail.sale_returns FOR EACH ROW EXECUTE FUNCTION retail.guard_credit_return();
CREATE FUNCTION retail.check_receivable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE r retail.receivables; rid uuid; paid numeric; adjusted numeric; expected numeric; p retail.receivable_payments;
BEGIN
 IF TG_TABLE_NAME='receivables' THEN rid:=NEW.id;
 ELSIF TG_TABLE_NAME='cash_movements' THEN
  IF NEW.receivable_payment_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO p FROM retail.receivable_payments WHERE tenant_id=NEW.tenant_id AND id=NEW.receivable_payment_id;
  IF NOT FOUND OR NEW.sale_return_id IS NOT NULL OR NEW.id<>p.id OR NEW.type<>'cash_in' OR NEW.amount<>p.amount_minor_units OR NEW.shift_id IS DISTINCT FROM p.shift_id OR NEW.created_by<>p.created_by OR p.method<>'cash' OR p.created_tx<>pg_current_xact_id() THEN RAISE EXCEPTION 'Invalid collection cash ledger' USING ERRCODE='23514'; END IF;
  rid:=p.receivable_id;
 ELSE rid:=NEW.receivable_id; END IF;
 SELECT * INTO r FROM retail.receivables WHERE tenant_id=NEW.tenant_id AND id=rid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing receivable' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount_minor_units),0) INTO paid FROM retail.receivable_payments WHERE tenant_id=r.tenant_id AND receivable_id=rid;
 SELECT coalesce(sum(amount_minor_units),0) INTO adjusted FROM retail.receivable_adjustments WHERE tenant_id=r.tenant_id AND receivable_id=rid;
 expected:=r.original_minor_units::numeric-paid-adjusted;
 IF expected<0 OR expected<>r.outstanding_minor_units OR r.status<>(CASE WHEN expected=0 THEN 'paid' WHEN expected=r.original_minor_units THEN 'open' ELSE 'partially_paid' END)
 OR NOT EXISTS(SELECT 1 FROM retail.sale_payments sp JOIN retail.sales s ON s.tenant_id=sp.tenant_id AND s.id=sp.sale_id WHERE sp.tenant_id=r.tenant_id AND sp.sale_id=r.sale_id AND sp.method='credit' AND sp.amount_minor_units=r.original_minor_units AND s.customer_id=r.customer_id AND s.location_id=r.location_id AND s.created_tx=r.created_tx)
 OR EXISTS(SELECT 1 FROM retail.receivable_payments rp WHERE rp.tenant_id=r.tenant_id AND rp.receivable_id=rid AND (rp.location_id<>r.location_id OR (rp.method='cash' AND NOT EXISTS(SELECT 1 FROM retail.cash_movements cm WHERE cm.tenant_id=rp.tenant_id AND cm.id=rp.id AND cm.receivable_payment_id=rp.id AND cm.amount=rp.amount_minor_units AND cm.type='cash_in' AND cm.shift_id=rp.shift_id AND cm.created_by=rp.created_by AND cm.created_tx=rp.created_tx)) OR (rp.method='card' AND EXISTS(SELECT 1 FROM retail.cash_movements cm WHERE cm.tenant_id=rp.tenant_id AND cm.receivable_payment_id=rp.id)) OR NOT EXISTS(SELECT 1 FROM retail.credit_audit a WHERE a.tenant_id=rp.tenant_id AND a.operation='receivables.pay' AND a.entity_id=rp.id AND a.actor_user_id=rp.created_by AND a.created_tx=rp.created_tx)))
 OR EXISTS(SELECT 1 FROM retail.receivable_adjustments ra JOIN retail.sale_returns sr ON sr.tenant_id=ra.tenant_id AND sr.id=ra.return_id WHERE ra.tenant_id=r.tenant_id AND ra.receivable_id=rid AND (ra.location_id<>r.location_id OR sr.sale_id<>r.sale_id OR sr.debt_reduction_minor_units<>ra.amount_minor_units OR sr.created_tx<>ra.created_tx)) THEN RAISE EXCEPTION 'Incomplete receivable transaction' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION retail.check_receivable() OWNER TO smartretail_credit_guard;
REVOKE ALL ON FUNCTION retail.check_receivable() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER receivable_complete AFTER INSERT OR UPDATE ON retail.receivables DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_receivable();
CREATE CONSTRAINT TRIGGER collection_complete AFTER INSERT ON retail.receivable_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_receivable();
CREATE CONSTRAINT TRIGGER adjustment_complete AFTER INSERT ON retail.receivable_adjustments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_receivable();
CREATE CONSTRAINT TRIGGER collection_cash_complete AFTER INSERT ON retail.cash_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_receivable();
CREATE OR REPLACE FUNCTION retail.guard_return_child() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
DECLARE header retail.sale_returns; original retail.sale_lines; prior numeric; paid numeric;
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
  IF original.tax_profile_id IS NOT NULL THEN
   IF NEW.refunded_tax_minor_units::numeric<>div(original.tax_amount_minor_units::numeric*(prior+NEW.quantity_milli_units)*2+original.quantity_milli_units,original.quantity_milli_units::numeric*2)-div(original.tax_amount_minor_units::numeric*prior*2+original.quantity_milli_units,original.quantity_milli_units::numeric*2)
    OR NEW.refunded_minor_units::numeric<>NEW.refunded_tax_minor_units::numeric+div((original.line_total_minor_units::numeric-original.tax_amount_minor_units::numeric)*(prior+NEW.quantity_milli_units)*2+original.quantity_milli_units,original.quantity_milli_units::numeric*2)-div((original.line_total_minor_units::numeric-original.tax_amount_minor_units::numeric)*prior*2+original.quantity_milli_units,original.quantity_milli_units::numeric*2) THEN RAISE EXCEPTION 'Historical tax refund mismatch' USING ERRCODE='23514'; END IF;
  ELSIF NEW.refunded_tax_minor_units<>0 THEN RAISE EXCEPTION 'Unexpected refunded tax' USING ERRCODE='23514';
  ELSIF (SELECT pricing_version FROM retail.sales WHERE tenant_id=NEW.tenant_id AND id=NEW.sale_id)=1 THEN
   IF NEW.refunded_minor_units::numeric<>div(original.line_total_minor_units::numeric*(prior+NEW.quantity_milli_units)*2+original.quantity_milli_units,original.quantity_milli_units::numeric*2)-div(original.line_total_minor_units::numeric*prior*2+original.quantity_milli_units,original.quantity_milli_units::numeric*2) THEN RAISE EXCEPTION 'Historical paid refund mismatch' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.refunded_minor_units::numeric <> div(original.unit_price_minor_units::numeric*(prior+NEW.quantity_milli_units)+500,1000)-div(original.unit_price_minor_units::numeric*prior+500,1000) THEN RAISE EXCEPTION 'Historical refund mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  SELECT coalesce((SELECT amount_minor_units FROM retail.sale_payments WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id AND method=NEW.method),0)::numeric+coalesce((SELECT sum(p.amount_minor_units) FROM retail.receivable_payments p JOIN retail.receivables r ON r.tenant_id=p.tenant_id AND r.id=p.receivable_id WHERE r.tenant_id=NEW.tenant_id AND r.sale_id=NEW.sale_id AND p.method=NEW.method),0) INTO paid;
  SELECT coalesce(sum(amount_minor_units),0) INTO prior FROM retail.sale_return_refunds WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id AND method=NEW.method;
  IF paid IS NULL OR prior+NEW.amount_minor_units>paid THEN RAISE EXCEPTION 'Refund method exceeded' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NEW;
END $$;



CREATE OR REPLACE FUNCTION retail.check_return_complete() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
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
 OR (SELECT coalesce(sum(amount_minor_units),0) FROM retail.sale_return_refunds WHERE tenant_id=r.tenant_id AND return_id=rid)+r.debt_reduction_minor_units<>r.total_minor_units
 OR (SELECT coalesce(sum(amount_minor_units),0) FROM retail.sale_return_refunds WHERE tenant_id=r.tenant_id AND return_id=rid AND method='cash')<>r.cash_refund_minor_units
 OR (SELECT count(*) FROM retail.inventory_movements WHERE tenant_id=r.tenant_id AND sale_return_id=rid)<>n
 OR EXISTS(SELECT 1 FROM retail.sale_return_lines l LEFT JOIN retail.inventory_movements m ON m.tenant_id=l.tenant_id AND m.id=l.movement_id WHERE l.tenant_id=r.tenant_id AND l.return_id=rid AND (m.id IS NULL OR m.sale_return_id IS DISTINCT FROM rid OR m.type<>'receipt' OR m.product_id<>l.product_id OR m.unit<>l.unit OR m.location_id<>r.location_id OR m.amount<>l.quantity_milli_units))
 OR (r.cash_refund_minor_units>0 AND NOT EXISTS(SELECT 1 FROM retail.cash_movements c WHERE c.tenant_id=r.tenant_id AND c.id=r.cash_movement_id AND c.sale_return_id=rid AND c.shift_id=r.shift_id AND c.type='cash_out' AND c.amount=r.cash_refund_minor_units))
 OR (r.cash_refund_minor_units=0 AND EXISTS(SELECT 1 FROM retail.cash_movements c WHERE c.tenant_id=r.tenant_id AND c.sale_return_id=rid))
 THEN RAISE EXCEPTION 'Incomplete return transaction' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

REVOKE CREATE ON SCHEMA retail FROM smartretail_credit_guard;
COMMIT;
