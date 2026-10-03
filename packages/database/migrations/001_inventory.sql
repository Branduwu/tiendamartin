-- Apply once to a dedicated database as migration administrator, never the app login.
BEGIN;
CREATE ROLE smartretail_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE smartretail_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
-- CREATEROLE administrators on PostgreSQL16+ do not automatically get SET.
-- This grants the migration executor access to its owner role, never the app.
GRANT smartretail_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
CREATE SCHEMA retail AUTHORIZATION smartretail_owner;
SET LOCAL ROLE smartretail_owner;
REVOKE ALL ON SCHEMA retail FROM PUBLIC;

CREATE TABLE retail.tenants (
  tenant_id uuid PRIMARY KEY
);
CREATE TABLE retail.products (
  tenant_id uuid NOT NULL REFERENCES retail.tenants,
  id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  sku text NOT NULL CHECK (char_length(sku) BETWEEN 1 AND 64 AND sku ~ '^[A-Z0-9]([A-Z0-9._-]*[A-Z0-9])?$'),
  barcode text CHECK (char_length(barcode) BETWEEN 1 AND 128 AND barcode ~ '^[!-~]+$'),
  unit text NOT NULL CHECK (unit IN ('piece','kg','g','l','ml','m','cm')),
  currency text NOT NULL CHECK (currency = 'MXN'),
  purchase_cost bigint NOT NULL CHECK (purchase_cost >= 0),
  sale_price bigint NOT NULL CHECK (sale_price >= 0),
  status text NOT NULL CHECK (status IN ('active','inactive')),
  PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,sku), UNIQUE (tenant_id,barcode),
  UNIQUE (tenant_id,id,unit)
);
CREATE TABLE retail.inventory_locations (
  tenant_id uuid NOT NULL REFERENCES retail.tenants,
  id uuid NOT NULL,
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 32 AND code ~ '^[A-Z0-9][A-Z0-9_-]*$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('active','inactive')),
  PRIMARY KEY (tenant_id,id)
);
CREATE TABLE retail.stock_balances (
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  unit text NOT NULL,
  milli_units bigint NOT NULL DEFAULT 0 CHECK (milli_units >= 0),
  PRIMARY KEY (tenant_id,product_id,location_id),
  FOREIGN KEY (tenant_id,product_id,unit) REFERENCES retail.products(tenant_id,id,unit),
  FOREIGN KEY (tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id)
);
CREATE TABLE retail.inventory_movements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('receipt','issue','adjustment')),
  unit text NOT NULL,
  amount bigint NOT NULL,
  reason text,
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,product_id,unit) REFERENCES retail.products(tenant_id,id,unit),
  FOREIGN KEY (tenant_id,location_id) REFERENCES retail.inventory_locations(tenant_id,id),
  CHECK ((type IN ('receipt','issue') AND amount > 0 AND reason IS NULL) OR
    (type = 'adjustment' AND amount <> 0 AND reason IS NOT NULL AND char_length(reason) BETWEEN 1 AND 200))
);
CREATE TABLE retail.inventory_transfers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  issue_movement_id uuid NOT NULL,
  receipt_movement_id uuid NOT NULL,
  product_id uuid NOT NULL,
  source_location_id uuid NOT NULL,
  destination_location_id uuid NOT NULL,
  unit text NOT NULL,
  milli_units bigint NOT NULL CHECK (milli_units > 0),
  source_after bigint NOT NULL CHECK (source_after >= 0),
  destination_after bigint NOT NULL CHECK (destination_after >= 0),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (issue_movement_id <> receipt_movement_id),
  CHECK (source_location_id <> destination_location_id),
  FOREIGN KEY (tenant_id,product_id,unit) REFERENCES retail.products(tenant_id,id,unit),
  FOREIGN KEY (tenant_id,source_location_id) REFERENCES retail.inventory_locations(tenant_id,id),
  FOREIGN KEY (tenant_id,destination_location_id) REFERENCES retail.inventory_locations(tenant_id,id),
  FOREIGN KEY (tenant_id,issue_movement_id) REFERENCES retail.inventory_movements(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id,receipt_movement_id) REFERENCES retail.inventory_movements(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (tenant_id,issue_movement_id), UNIQUE (tenant_id,receipt_movement_id)
);

-- Missing/empty context sees no rows; malformed UUID fails closed. Context is
-- supplied only by trusted server composition, never accepted as authorization.
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['tenants','products','inventory_locations','stock_balances','inventory_movements','inventory_transfers'] LOOP
    EXECUTE format('ALTER TABLE retail.%I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('ALTER TABLE retail.%I FORCE ROW LEVEL SECURITY',tbl);
    EXECUTE format('CREATE POLICY tenant_scope ON retail.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',tbl);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA retail TO smartretail_app;
GRANT SELECT ON ALL TABLES IN SCHEMA retail TO smartretail_app;
GRANT INSERT ON retail.products, retail.inventory_locations, retail.stock_balances, retail.inventory_movements, retail.inventory_transfers TO smartretail_app;
CREATE FUNCTION retail.zero_initial_balance() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, retail AS $$
BEGIN
  IF NEW.milli_units <> 0 THEN RAISE EXCEPTION 'Initial balance must be zero'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER initial_balance BEFORE INSERT ON retail.stock_balances
FOR EACH ROW EXECUTE FUNCTION retail.zero_initial_balance();

-- SELECT FOR UPDATE requires UPDATE privileges. Expose only row locking, not
-- UPDATE privileges, through this context-bound function subject to FORCE RLS.
CREATE FUNCTION retail.lock_balance(product uuid, location uuid)
RETURNS SETOF retail.stock_balances LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, retail AS $$
  SELECT * FROM retail.stock_balances
  WHERE tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid
    AND product_id = product AND location_id = location FOR UPDATE;
$$;
REVOKE ALL ON FUNCTION retail.lock_balance(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.lock_balance(uuid,uuid) TO smartretail_app;

-- The app cannot UPDATE balances. Only an inserted immutable ledger entry can
-- apply its delta. This narrowly scoped definer remains subject to FORCE RLS.
CREATE FUNCTION retail.apply_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, retail AS $$
DECLARE resulting bigint;
BEGIN
  UPDATE retail.stock_balances SET milli_units = milli_units +
    CASE WHEN NEW.type = 'issue' THEN -NEW.amount ELSE NEW.amount END
  WHERE tenant_id = NEW.tenant_id AND product_id = NEW.product_id
    AND location_id = NEW.location_id AND unit = NEW.unit
  RETURNING milli_units INTO resulting;
  IF NOT FOUND OR resulting <> NEW.balance_after THEN
    RAISE EXCEPTION 'Ledger balance mismatch';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.apply_ledger() FROM PUBLIC;
CREATE TRIGGER apply_ledger AFTER INSERT ON retail.inventory_movements
FOR EACH ROW EXECUTE FUNCTION retail.apply_ledger();

CREATE FUNCTION retail.check_transfer_children() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, retail AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM retail.inventory_movements i, retail.inventory_movements r
    WHERE i.tenant_id=NEW.tenant_id AND r.tenant_id=NEW.tenant_id
      AND i.id=NEW.issue_movement_id AND r.id=NEW.receipt_movement_id
      AND i.type='issue' AND r.type='receipt'
      AND i.product_id=NEW.product_id AND r.product_id=NEW.product_id
      AND i.location_id=NEW.source_location_id AND r.location_id=NEW.destination_location_id
      AND i.unit=NEW.unit AND r.unit=NEW.unit
      AND i.amount=NEW.milli_units AND r.amount=NEW.milli_units
      AND i.balance_after=NEW.source_after AND r.balance_after=NEW.destination_after)
  THEN RAISE EXCEPTION 'Transfer children mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER transfer_children AFTER INSERT ON retail.inventory_transfers
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.check_transfer_children();
-- No DELETE/TRUNCATE, ledger UPDATE, tenant provisioning or owner membership.
COMMIT;
