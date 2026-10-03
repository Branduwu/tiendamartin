BEGIN;
SET LOCAL ROLE smartretail_owner;

CREATE TABLE retail.tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES retail.tenants(tenant_id),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','admin','inventory_clerk')),
  status text NOT NULL CHECK (status IN ('active','inactive')),
  PRIMARY KEY (tenant_id,user_id)
);
-- External UUID subject; deliberately no dependency on auth.users or email.
ALTER TABLE retail.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY own_membership ON retail.tenant_memberships FOR SELECT
USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND user_id=nullif(current_setting('app.user_id',true),'')::uuid AND status='active');

CREATE TABLE retail.role_permissions (
  role text NOT NULL CHECK (role IN ('owner','admin','inventory_clerk')),
  permission text NOT NULL CHECK (permission IN (
    'products.read','products.write','locations.read','locations.write','inventory.read',
    'inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage')),
  PRIMARY KEY (role,permission)
);
INSERT INTO retail.role_permissions
SELECT r,p FROM unnest(ARRAY['owner','admin']) r CROSS JOIN unnest(ARRAY[
  'products.read','products.write','locations.read','locations.write','inventory.read',
  'inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage']) p;
INSERT INTO retail.role_permissions SELECT 'inventory_clerk',p FROM unnest(ARRAY[
  'products.read','locations.read','inventory.read','inventory.receive','inventory.issue','inventory.transfer']) p;
GRANT SELECT ON retail.tenant_memberships,retail.role_permissions TO smartretail_app;
-- No INSERT/UPDATE/DELETE/TRUNCATE: even owner/admin app users cannot bootstrap
-- memberships or edit the fixed matrix through this database login.

CREATE FUNCTION retail.is_active_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
  SELECT EXISTS (SELECT 1 FROM retail.tenant_memberships m
    WHERE m.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
      AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.status='active');
$$;
CREATE FUNCTION retail.has_permission(requested text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
  SELECT EXISTS (SELECT 1 FROM retail.tenant_memberships m JOIN retail.role_permissions p ON p.role=m.role
    WHERE m.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
      AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid
      AND m.status='active' AND p.permission=requested);
$$;
REVOKE ALL ON FUNCTION retail.is_active_member(),retail.has_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.is_active_member(),retail.has_permission(text) TO smartretail_app;

DO $$ DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['tenants','products','inventory_locations','stock_balances','inventory_movements','inventory_transfers'] LOOP
    EXECUTE format('DROP POLICY tenant_scope ON retail.%I',tbl);
    EXECUTE format('CREATE POLICY tenant_member ON retail.%I AS RESTRICTIVE USING
      (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member())
      WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member())',tbl);
  END LOOP;
END $$;
CREATE POLICY tenant_read ON retail.tenants FOR SELECT USING (retail.is_active_member());
CREATE POLICY product_read ON retail.products FOR SELECT USING (retail.has_permission('products.read'));
CREATE POLICY product_insert ON retail.products FOR INSERT WITH CHECK (retail.has_permission('products.write'));
CREATE POLICY location_read ON retail.inventory_locations FOR SELECT USING (retail.has_permission('locations.read'));
CREATE POLICY location_insert ON retail.inventory_locations FOR INSERT WITH CHECK (retail.has_permission('locations.write'));
CREATE POLICY balance_read ON retail.stock_balances FOR SELECT USING (retail.has_permission('inventory.read'));
CREATE POLICY balance_insert ON retail.stock_balances FOR INSERT WITH CHECK (
  retail.has_permission('inventory.receive') OR retail.has_permission('inventory.issue') OR
  retail.has_permission('inventory.adjust') OR retail.has_permission('inventory.transfer'));
-- Only the existing ledger trigger has UPDATE privileges, still constrained by
-- membership and permissions of the original GUC subject under FORCE RLS.
CREATE POLICY balance_ledger_update ON retail.stock_balances FOR UPDATE USING (
  retail.has_permission('inventory.receive') OR retail.has_permission('inventory.issue') OR
  retail.has_permission('inventory.adjust') OR retail.has_permission('inventory.transfer'));
CREATE POLICY movement_read ON retail.inventory_movements FOR SELECT USING (retail.has_permission('inventory.read'));
CREATE POLICY movement_insert ON retail.inventory_movements FOR INSERT WITH CHECK (
  (type='receipt' AND retail.has_permission('inventory.receive')) OR
  (type='issue' AND retail.has_permission('inventory.issue')) OR
  (type='adjustment' AND retail.has_permission('inventory.adjust')));
CREATE POLICY transfer_read ON retail.inventory_transfers FOR SELECT USING (retail.has_permission('inventory.read'));
CREATE POLICY transfer_insert ON retail.inventory_transfers FOR INSERT WITH CHECK (retail.has_permission('inventory.transfer'));
COMMIT;
