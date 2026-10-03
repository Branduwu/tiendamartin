BEGIN;
SET LOCAL ROLE smartretail_owner;
CREATE TABLE retail.inventory_commands (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES retail.tenants(tenant_id),
  kind text NOT NULL CHECK(kind IN ('receipt','issue','adjustment','count'))
);
-- Existing ledger IDs retain their original kind; past counts lacked a receipt
-- and cannot safely be distinguished from independent adjustments.
-- Transactional owner-only backfill; application RLS stays enabled throughout.
ALTER TABLE retail.inventory_movements NO FORCE ROW LEVEL SECURITY;
INSERT INTO retail.inventory_commands(id,tenant_id,kind) SELECT id,tenant_id,type FROM retail.inventory_movements;
ALTER TABLE retail.inventory_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE retail.inventory_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.inventory_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY command_tenant ON retail.inventory_commands AS RESTRICTIVE
USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member())
WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member());
CREATE POLICY command_read ON retail.inventory_commands FOR SELECT USING(retail.has_permission('inventory.read'));
CREATE POLICY command_insert ON retail.inventory_commands FOR INSERT WITH CHECK(
  (kind='count' AND retail.has_permission('inventory.adjust')) OR
  (kind='adjustment' AND retail.has_permission('inventory.adjust')) OR
  (kind='receipt' AND (retail.has_permission('inventory.receive') OR retail.has_permission('inventory.transfer'))) OR
  (kind='issue' AND (retail.has_permission('inventory.issue') OR retail.has_permission('inventory.transfer')))
);
GRANT SELECT,INSERT ON retail.inventory_commands TO smartretail_app;
CREATE TABLE retail.inventory_counts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  product_id uuid NOT NULL, location_id uuid NOT NULL, unit text NOT NULL,
  counted bigint NOT NULL CHECK(counted>=0), reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 200),
  status text NOT NULL CHECK(status IN ('no-change','adjusted')),
  delta bigint, movement_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(tenant_id,product_id,unit) REFERENCES retail.products(tenant_id,id,unit),
  FOREIGN KEY(tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id),
  FOREIGN KEY(tenant_id,movement_id) REFERENCES retail.inventory_movements(tenant_id,id),
  CHECK ((status='no-change' AND delta IS NULL AND movement_id IS NULL) OR
    (status='adjusted' AND delta IS NOT NULL AND delta<>0 AND movement_id IS NOT NULL AND movement_id=id))
);
ALTER TABLE retail.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.inventory_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY count_tenant ON retail.inventory_counts AS RESTRICTIVE
USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member())
WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member());
CREATE POLICY count_read ON retail.inventory_counts FOR SELECT USING(retail.has_permission('inventory.read'));
CREATE POLICY count_insert ON retail.inventory_counts FOR INSERT WITH CHECK(retail.has_permission('inventory.adjust'));
GRANT SELECT,INSERT ON retail.inventory_counts TO smartretail_app;
CREATE FUNCTION retail.check_count_result() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM retail.stock_balances b WHERE b.tenant_id=NEW.tenant_id AND b.product_id=NEW.product_id AND b.location_id=NEW.location_id AND b.unit=NEW.unit AND b.milli_units=NEW.counted) THEN
    RAISE EXCEPTION 'Invalid count snapshot' USING ERRCODE='23514';
  END IF;
  IF NEW.status='adjusted' AND NOT EXISTS(SELECT 1 FROM retail.inventory_movements m WHERE m.tenant_id=NEW.tenant_id AND m.id=NEW.movement_id AND m.type='adjustment' AND m.product_id=NEW.product_id AND m.location_id=NEW.location_id AND m.unit=NEW.unit AND m.amount=NEW.delta AND m.balance_after=NEW.counted AND m.reason=NEW.reason) THEN
    RAISE EXCEPTION 'Invalid count movement' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.check_count_result() FROM PUBLIC;
CREATE TRIGGER count_result BEFORE INSERT ON retail.inventory_counts FOR EACH ROW EXECUTE FUNCTION retail.check_count_result();
COMMIT;
