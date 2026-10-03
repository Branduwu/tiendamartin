BEGIN;
SET LOCAL ROLE smartretail_owner;
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_permission_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_permission_check CHECK(permission IN (
'products.read','products.write','locations.read','locations.write','inventory.read','inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage',
'sales.read','sales.create','sales.return','cash.read','cash.open','cash.move','cash.close','suppliers.read','suppliers.write','purchases.read','purchases.write','purchases.receive','customers.read','customers.write'));
INSERT INTO retail.role_permissions SELECT r,p FROM unnest(ARRAY['owner','admin']) r CROSS JOIN unnest(ARRAY['customers.read','customers.write']) p;

CREATE TABLE retail.customers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES retail.tenants,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200 AND length(btrim(name))>0),
 phone text CHECK(length(phone) BETWEEN 1 AND 50), email text CHECK(length(email) BETWEEN 1 AND 254),
 notes text CHECK(length(notes) BETWEEN 1 AND 2000),
 status text NOT NULL CHECK(status IN ('active','inactive')), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id)
);
CREATE TABLE retail.customer_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES retail.tenants,
 actor_user_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('customers.create','customers.update')),
 customer_id uuid NOT NULL, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES retail.customers(tenant_id,id)
);
ALTER TABLE retail.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE retail.customer_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.customer_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_tenant ON retail.customers AS RESTRICTIVE USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member());
CREATE POLICY customer_read ON retail.customers FOR SELECT USING(retail.has_permission('customers.read'));
CREATE POLICY customer_insert ON retail.customers FOR INSERT WITH CHECK(retail.has_permission('customers.write'));
CREATE POLICY customer_update ON retail.customers FOR UPDATE USING(retail.has_permission('customers.write')) WITH CHECK(retail.has_permission('customers.write'));
CREATE POLICY customer_audit_tenant ON retail.customer_audit AS RESTRICTIVE USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member());
CREATE POLICY customer_audit_read ON retail.customer_audit FOR SELECT USING(retail.has_permission('customers.read'));
CREATE POLICY customer_audit_insert ON retail.customer_audit FOR INSERT WITH CHECK(retail.has_permission('customers.write'));
GRANT SELECT,INSERT ON retail.customers TO smartretail_app;
GRANT UPDATE(name,phone,email,notes,status) ON retail.customers TO smartretail_app;
GRANT SELECT ON retail.customer_audit TO smartretail_app;
CREATE INDEX customers_directory ON retail.customers(tenant_id,name,id);
CREATE INDEX customer_audit_history ON retail.customer_audit(tenant_id,customer_id,created_at);
CREATE TRIGGER customer_audit_immutable BEFORE UPDATE OR DELETE ON retail.customer_audit FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE FUNCTION retail.audit_customer() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NOT retail.has_permission('customers.write') OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'Customer access denied' USING ERRCODE='42501'; END IF;
 INSERT INTO retail.customer_audit(tenant_id,actor_user_id,action,customer_id,correlation_id)
 VALUES(NEW.tenant_id,nullif(current_setting('app.user_id',true),'')::uuid,CASE WHEN TG_OP='INSERT' THEN 'customers.create' ELSE 'customers.update' END,NEW.id,nullif(current_setting('app.correlation_id',true),'')::uuid);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.audit_customer() FROM PUBLIC;
CREATE TRIGGER customer_audit AFTER INSERT OR UPDATE ON retail.customers FOR EACH ROW EXECUTE FUNCTION retail.audit_customer();

ALTER TABLE retail.sales ADD COLUMN customer_id uuid, ADD COLUMN customer_name text;
GRANT INSERT(customer_id) ON retail.sales TO smartretail_app;
ALTER TABLE retail.sales ADD CONSTRAINT sale_customer_fk FOREIGN KEY(tenant_id,customer_id) REFERENCES retail.customers(tenant_id,id);
ALTER TABLE retail.sales ADD CONSTRAINT sale_customer_name CHECK((customer_id IS NULL AND customer_name IS NULL) OR (customer_id IS NOT NULL AND customer_name IS NOT NULL AND length(customer_name) BETWEEN 1 AND 200));
CREATE INDEX sales_customer_history ON retail.sales(tenant_id,customer_id,created_at DESC,id DESC) WHERE customer_id IS NOT NULL;

CREATE FUNCTION retail.lock_sale_customer(cid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NOT retail.has_permission('sales.create') THEN RAISE EXCEPTION 'Sale access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM retail.customers WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND id=cid AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='P0001'; END IF;
END $$;
REVOKE ALL ON FUNCTION retail.lock_sale_customer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.lock_sale_customer(uuid) TO smartretail_app;
CREATE FUNCTION retail.validate_sale_customer() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'Sale access denied' USING ERRCODE='42501'; END IF;
 IF NEW.customer_id IS NULL THEN NEW.customer_name:=NULL;
 ELSE
  PERFORM retail.lock_sale_customer(NEW.customer_id);
  SELECT name INTO NEW.customer_name FROM retail.customers WHERE tenant_id=NEW.tenant_id AND id=NEW.customer_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.validate_sale_customer() FROM PUBLIC;
CREATE TRIGGER sale_customer_context BEFORE INSERT ON retail.sales FOR EACH ROW EXECUTE FUNCTION retail.validate_sale_customer();
COMMIT;
