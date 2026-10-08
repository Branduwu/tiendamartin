BEGIN;
CREATE ROLE smartretail_settings_guard NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT smartretail_settings_guard TO smartretail_owner;
SET LOCAL ROLE smartretail_owner;
GRANT USAGE,CREATE ON SCHEMA retail TO smartretail_settings_guard;
GRANT SELECT ON retail.tenant_memberships,retail.role_permissions,retail.inventory_locations TO smartretail_settings_guard;
GRANT UPDATE(status) ON retail.inventory_locations TO smartretail_settings_guard;
GRANT EXECUTE ON FUNCTION retail.has_permission(text),retail.is_active_member(),retail.has_location_access(uuid) TO smartretail_settings_guard;
CREATE POLICY settings_guard_location ON retail.inventory_locations TO smartretail_settings_guard USING(retail.has_location_access(id)) WITH CHECK(false);
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_permission_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_permission_check CHECK(permission IN (
'products.read','products.write','locations.read','locations.write','inventory.read','inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage',
'sales.read','sales.create','sales.return','cash.read','cash.open','cash.move','cash.close','suppliers.read','suppliers.write','purchases.read','purchases.write','purchases.receive','customers.read','customers.write','reports.read','inventory.minimum.write','sales.discount','promotions.read','promotions.write','taxes.manage','credit.manage','receivables.read','receivables.pay','payables.read','payables.pay','expenses.read','expenses.write','settings.manage'));
INSERT INTO retail.role_permissions VALUES('owner','settings.manage'),('admin','settings.manage');
CREATE FUNCTION retail.settings_text(value text, maximum integer) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT value IS NULL OR (length(value) BETWEEN 1 AND maximum AND btrim(value)=value AND value !~ '[[:cntrl:]]' AND value !~ U&'[\200B-\200F\202A-\202E\2060-\206F]');
$$;
REVOKE ALL ON FUNCTION retail.settings_text(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.settings_text(text,integer) TO smartretail_app;
CREATE TABLE retail.business_profiles(
 tenant_id uuid PRIMARY KEY REFERENCES retail.tenants,
 business_name text NOT NULL CHECK(retail.settings_text(business_name,120)),
 trade_name text CHECK(retail.settings_text(trade_name,120)),phone text CHECK(retail.settings_text(phone,50)),
 email text CHECK(retail.settings_text(email,254) AND (email IS NULL OR email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
 website text CHECK(retail.settings_text(website,500) AND (website IS NULL OR website ~ '^https?://[^/@[:space:]]+([/?#]|$)')),
 ticket_footer text CHECK(retail.settings_text(ticket_footer,500)),logo_url text CHECK(logo_url IS NULL),
 timezone text NOT NULL DEFAULT 'America/Mexico_City' CHECK(timezone IN('America/Mexico_City','America/Tijuana','America/Cancun','America/Hermosillo')),
 locale text NOT NULL DEFAULT 'es-MX' CHECK(locale IN('es-MX','en-US')),currency text NOT NULL DEFAULT 'MXN' CHECK(currency='MXN')
);
ALTER TABLE retail.business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.business_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_tenant ON retail.business_profiles AS RESTRICTIVE USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member());
CREATE POLICY profile_read ON retail.business_profiles FOR SELECT USING(retail.is_active_member());
CREATE POLICY profile_insert ON retail.business_profiles FOR INSERT WITH CHECK(retail.has_permission('settings.manage'));
CREATE POLICY profile_update ON retail.business_profiles FOR UPDATE USING(retail.has_permission('settings.manage')) WITH CHECK(retail.has_permission('settings.manage'));
GRANT SELECT,INSERT,UPDATE ON retail.business_profiles TO smartretail_app;
ALTER TABLE retail.inventory_locations
 ADD COLUMN display_name text CHECK(retail.settings_text(display_name,100)),
 ADD COLUMN address text CHECK(retail.settings_text(address,300)),
 ADD COLUMN phone text CHECK(retail.settings_text(phone,50)),
 ADD COLUMN receipt_header text CHECK(retail.settings_text(receipt_header,300));
CREATE POLICY location_settings_update ON retail.inventory_locations FOR UPDATE USING(retail.has_permission('settings.manage')) WITH CHECK(retail.has_permission('settings.manage'));
GRANT UPDATE(display_name,address,phone,receipt_header,status) ON retail.inventory_locations TO smartretail_app;
CREATE TABLE retail.settings_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES retail.tenants,
 actor_user_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN('business.settings','branch.settings')),
 entity_id uuid NOT NULL,correlation_id uuid NOT NULL,fields jsonb NOT NULL CHECK(jsonb_typeof(fields)='array'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
 FOREIGN KEY(tenant_id,actor_user_id) REFERENCES retail.tenant_memberships(tenant_id,user_id)
);
ALTER TABLE retail.settings_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.settings_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY settings_audit_tenant ON retail.settings_audit AS RESTRICTIVE USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member());
CREATE POLICY settings_audit_read ON retail.settings_audit FOR SELECT USING(retail.has_permission('settings.manage'));
CREATE POLICY settings_audit_insert ON retail.settings_audit FOR INSERT WITH CHECK(retail.has_permission('settings.manage') AND actor_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND correlation_id=nullif(current_setting('app.correlation_id',true),'')::uuid AND created_tx=pg_current_xact_id());
GRANT SELECT ON retail.settings_audit TO smartretail_app;
GRANT INSERT ON retail.settings_audit TO smartretail_settings_guard;
GRANT USAGE ON SEQUENCE retail.settings_audit_id_seq TO smartretail_settings_guard;
CREATE POLICY settings_audit_guard ON retail.settings_audit FOR INSERT TO smartretail_settings_guard WITH CHECK(retail.has_permission('settings.manage') AND actor_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND correlation_id=nullif(current_setting('app.correlation_id',true),'')::uuid AND created_tx=pg_current_xact_id());
CREATE FUNCTION retail.audit_business_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE changes jsonb; before_row jsonb;
BEGIN
 -- Trusted superuser maintenance/fixture sessions are outside the runtime path.
 -- Application logins are NOSUPERUSER and cannot set session_user to a superuser.
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper) THEN RETURN NEW; END IF;
 before_row=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
 SELECT coalesce(jsonb_agg(key ORDER BY key),'[]'::jsonb) INTO changes FROM jsonb_each(to_jsonb(NEW)) WHERE key<>'tenant_id' AND value IS DISTINCT FROM before_row->key;
 IF changes='[]'::jsonb THEN RETURN NEW; END IF;
 INSERT INTO retail.settings_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,fields)
 VALUES(NEW.tenant_id,nullif(current_setting('app.user_id',true),'')::uuid,CASE WHEN TG_TABLE_NAME='business_profiles' THEN 'business.settings' ELSE 'branch.settings' END,CASE WHEN TG_TABLE_NAME='business_profiles' THEN NEW.tenant_id ELSE (to_jsonb(NEW)->>'id')::uuid END,nullif(current_setting('app.correlation_id',true),'')::uuid,changes);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.audit_business_settings() FROM PUBLIC;
ALTER FUNCTION retail.audit_business_settings() OWNER TO smartretail_settings_guard;
CREATE TRIGGER business_settings_audit AFTER INSERT OR UPDATE ON retail.business_profiles FOR EACH ROW EXECUTE FUNCTION retail.audit_business_settings();
CREATE TRIGGER branch_settings_audit AFTER UPDATE ON retail.inventory_locations FOR EACH ROW EXECUTE FUNCTION retail.audit_business_settings();
CREATE TRIGGER settings_audit_immutable BEFORE UPDATE OR DELETE ON retail.settings_audit FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
-- Share locks serialize new operations with branch deactivation. Updates of
-- historical sales/shifts and cancellation/closure remain available.
CREATE FUNCTION retail.require_active_operation_location() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.status<>'ordered' THEN RETURN NEW; END IF;
 END IF;
 PERFORM 1 FROM retail.inventory_locations WHERE tenant_id=NEW.tenant_id AND id=NEW.location_id AND status='active' AND retail.has_location_access(id) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operational branch unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.require_active_operation_location() FROM PUBLIC;
ALTER FUNCTION retail.require_active_operation_location() OWNER TO smartretail_settings_guard;
CREATE TRIGGER active_branch_sale BEFORE INSERT ON retail.sales FOR EACH ROW EXECUTE FUNCTION retail.require_active_operation_location();
CREATE TRIGGER active_branch_cash BEFORE INSERT ON retail.cash_register_shifts FOR EACH ROW EXECUTE FUNCTION retail.require_active_operation_location();
CREATE TRIGGER active_branch_purchase BEFORE INSERT OR UPDATE OF status ON retail.purchase_orders FOR EACH ROW EXECUTE FUNCTION retail.require_active_operation_location();
CREATE TRIGGER active_branch_receipt BEFORE INSERT ON retail.purchase_receipts FOR EACH ROW EXECUTE FUNCTION retail.require_active_operation_location();
REVOKE CREATE ON SCHEMA retail FROM smartretail_settings_guard;
COMMIT;
