BEGIN;
CREATE ROLE smartretail_discounts_guard NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT smartretail_discounts_guard TO smartretail_owner;
SET LOCAL ROLE smartretail_owner;
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_permission_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_permission_check CHECK(permission IN (
'products.read','products.write','locations.read','locations.write','inventory.read','inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage',
'sales.read','sales.create','sales.return','cash.read','cash.open','cash.move','cash.close','suppliers.read','suppliers.write','purchases.read','purchases.write','purchases.receive','customers.read','customers.write','reports.read','inventory.minimum.write','sales.discount','promotions.read','promotions.write'));
INSERT INTO retail.role_permissions SELECT r,p FROM unnest(ARRAY['owner','admin']) r CROSS JOIN unnest(ARRAY['sales.discount','promotions.read','promotions.write']) p;
INSERT INTO retail.role_permissions VALUES('cashier','sales.discount');
CREATE TABLE retail.coupons(
 tenant_id uuid NOT NULL REFERENCES retail.tenants,id uuid NOT NULL,code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
 discount_type text NOT NULL CHECK(discount_type IN('amount','percentage')),discount_value bigint NOT NULL CHECK(discount_value>=0),
 active boolean NOT NULL,starts_at timestamptz,ends_at timestamptz,usage_limit bigint CHECK(usage_limit>0),created_by uuid NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,code),CHECK(discount_type<>'percentage' OR discount_value<=10000),CHECK(starts_at IS NULL OR ends_at IS NULL OR starts_at<ends_at)
);
CREATE TABLE retail.promotions(
 tenant_id uuid NOT NULL REFERENCES retail.tenants,id uuid NOT NULL,product_id uuid NOT NULL,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 discount_type text NOT NULL CHECK(discount_type IN('amount','percentage')),discount_value bigint NOT NULL CHECK(discount_value>=0),
 active boolean NOT NULL,starts_at timestamptz,ends_at timestamptz,created_by uuid NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,product_id) REFERENCES retail.products(tenant_id,id),
 CHECK(discount_type<>'percentage' OR discount_value<=10000),CHECK(starts_at IS NULL OR ends_at IS NULL OR starts_at<ends_at)
);
CREATE INDEX promotions_product ON retail.promotions(tenant_id,product_id) WHERE active;
CREATE TABLE retail.coupon_redemptions(
 tenant_id uuid NOT NULL,coupon_id uuid NOT NULL,sale_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,sale_id),FOREIGN KEY(tenant_id,coupon_id) REFERENCES retail.coupons(tenant_id,id),
 FOREIGN KEY(tenant_id,sale_id) REFERENCES retail.sales(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX coupon_redemptions_count ON retail.coupon_redemptions(tenant_id,coupon_id);
CREATE TABLE retail.promotion_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES retail.tenants,actor_user_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('coupons.create','coupons.update','promotions.create','promotions.update')),
 entity_id uuid NOT NULL,correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 metadata jsonb NOT NULL CHECK(octet_length(metadata::text)<=4096)
);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['coupons','promotions','coupon_redemptions','promotion_audit'] LOOP
  EXECUTE format('ALTER TABLE retail.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE retail.%I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY discount_tenant ON retail.%I AS RESTRICTIVE USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND retail.is_active_member())',tbl);
 END LOOP;
 FOREACH tbl IN ARRAY ARRAY['coupons','promotions'] LOOP
  EXECUTE format('CREATE POLICY catalog_read ON retail.%I FOR SELECT USING(retail.has_permission(''promotions.read'') OR retail.has_permission(''sales.create''))',tbl);
  EXECUTE format('CREATE POLICY catalog_create ON retail.%I FOR INSERT WITH CHECK(retail.has_permission(''promotions.write''))',tbl);
  EXECUTE format('CREATE POLICY catalog_update ON retail.%I FOR UPDATE USING(retail.has_permission(''promotions.write'')) WITH CHECK(retail.has_permission(''promotions.write''))',tbl);
  EXECUTE format('CREATE POLICY catalog_lock ON retail.%I FOR UPDATE USING(retail.has_permission(''sales.create'')) WITH CHECK(false)',tbl);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON retail.%I TO smartretail_app',tbl);
 END LOOP;
END $$;
CREATE POLICY redemption_insert ON retail.coupon_redemptions FOR INSERT WITH CHECK(retail.has_permission('sales.create'));
GRANT INSERT ON retail.coupon_redemptions TO smartretail_app;
CREATE POLICY discounts_audit_read ON retail.promotion_audit FOR SELECT USING(retail.has_permission('promotions.read'));
GRANT SELECT ON retail.promotion_audit TO smartretail_app;
CREATE TRIGGER immutable_redemption BEFORE UPDATE OR DELETE ON retail.coupon_redemptions FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE TRIGGER immutable_promotion_audit BEFORE UPDATE OR DELETE ON retail.promotion_audit FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
GRANT USAGE,CREATE ON SCHEMA retail TO smartretail_discounts_guard;
GRANT EXECUTE ON FUNCTION retail.has_permission(text),retail.is_active_member(),retail.has_location_access(uuid) TO smartretail_discounts_guard;
GRANT SELECT ON retail.tenant_memberships,retail.role_permissions,retail.sales,retail.coupons,retail.coupon_redemptions TO smartretail_discounts_guard;
GRANT UPDATE ON retail.coupons TO smartretail_discounts_guard;
GRANT INSERT ON retail.promotion_audit TO smartretail_discounts_guard;
CREATE POLICY redemption_count ON retail.coupon_redemptions FOR SELECT TO smartretail_discounts_guard USING(true);
CREATE POLICY coupon_guard_read ON retail.coupons FOR SELECT TO smartretail_discounts_guard USING(true);
CREATE POLICY coupon_guard_lock ON retail.coupons FOR UPDATE TO smartretail_discounts_guard USING(true) WITH CHECK(false);
CREATE POLICY sale_coupon_guard ON retail.sales FOR SELECT TO smartretail_discounts_guard USING(true);
CREATE POLICY discounts_audit_guard ON retail.promotion_audit FOR INSERT TO smartretail_discounts_guard WITH CHECK(true);

CREATE FUNCTION retail.coupon_uses(cid uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE result bigint; BEGIN
 IF NOT (retail.has_permission('promotions.read') OR retail.has_permission('sales.create')) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO result FROM retail.coupon_redemptions WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND coupon_id=cid;
 RETURN result;
END $$;
ALTER FUNCTION retail.coupon_uses(uuid) OWNER TO smartretail_discounts_guard;
REVOKE ALL ON FUNCTION retail.coupon_uses(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.coupon_uses(uuid) TO smartretail_app;
CREATE FUNCTION retail.lock_coupon(cid uuid) RETURNS retail.coupons LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE result retail.coupons; BEGIN
 IF NOT retail.has_permission('sales.create') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO result FROM retail.coupons WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND id=cid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Coupon unavailable' USING ERRCODE='P0001'; END IF;
 RETURN result;
END $$;
ALTER FUNCTION retail.lock_coupon(uuid) OWNER TO smartretail_discounts_guard;
REVOKE ALL ON FUNCTION retail.lock_coupon(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.lock_coupon(uuid) TO smartretail_app;
CREATE FUNCTION retail.guard_coupon_redemption() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE c retail.coupons; s retail.sales; BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Coupon redemption requires read committed' USING ERRCODE='42501'; END IF;
 c:=retail.lock_coupon(NEW.coupon_id);
 SELECT * INTO s FROM retail.sales WHERE tenant_id=NEW.tenant_id AND id=NEW.sale_id;
 IF NOT FOUND OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR s.created_tx<>pg_current_xact_id() OR s.created_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid THEN RAISE EXCEPTION 'Closed coupon sale' USING ERRCODE='23514'; END IF;
 IF NOT c.active OR (c.starts_at IS NOT NULL AND c.starts_at>clock_timestamp()) OR (c.ends_at IS NOT NULL AND c.ends_at<=clock_timestamp()) OR (c.usage_limit IS NOT NULL AND retail.coupon_uses(c.id)>=c.usage_limit) THEN RAISE EXCEPTION 'Coupon unavailable' USING ERRCODE='P0001'; END IF;
 IF s.discount_intent->>'couponCode' IS DISTINCT FROM c.code OR s.discount_details->'coupon'->>'id' IS DISTINCT FROM c.id::text THEN RAISE EXCEPTION 'Coupon sale mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

ALTER TABLE retail.sales ADD COLUMN pricing_version integer NOT NULL DEFAULT 0 CHECK(pricing_version IN(0,1)),
 ADD COLUMN discount_intent jsonb CHECK(discount_intent IS NULL OR (jsonb_typeof(discount_intent)='object' AND octet_length(discount_intent::text)<=65536)),
 ADD COLUMN discount_details jsonb CHECK(discount_details IS NULL OR (jsonb_typeof(discount_details)='object' AND octet_length(discount_details::text)<=262144));
ALTER TABLE retail.sale_lines ADD COLUMN discount_minor_units bigint NOT NULL DEFAULT 0 CHECK(discount_minor_units>=0);
DO $$ DECLARE cname text; BEGIN
 SELECT conname INTO cname FROM pg_constraint WHERE conrelid='retail.sale_lines'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%div(%';
 IF cname IS NULL THEN RAISE EXCEPTION 'Expected sale price constraint missing'; END IF;
 EXECUTE format('ALTER TABLE retail.sale_lines DROP CONSTRAINT %I',cname);
END $$;
ALTER TABLE retail.sale_lines ADD CONSTRAINT sale_paid_line CHECK(line_total_minor_units::numeric+discount_minor_units::numeric=div(unit_price_minor_units::numeric*quantity_milli_units::numeric+500,1000));
GRANT INSERT(pricing_version,discount_intent,discount_details) ON retail.sales TO smartretail_app;
ALTER FUNCTION retail.guard_coupon_redemption() OWNER TO smartretail_discounts_guard;
REVOKE ALL ON FUNCTION retail.guard_coupon_redemption() FROM PUBLIC;
CREATE TRIGGER coupon_redemption_guard BEFORE INSERT ON retail.coupon_redemptions FOR EACH ROW EXECUTE FUNCTION retail.guard_coupon_redemption();

CREATE FUNCTION retail.audit_promotion_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NOT retail.has_permission('promotions.write') OR (TG_OP='INSERT' AND NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid) OR (TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_by<>OLD.created_by)) THEN RAISE EXCEPTION 'Invalid catalog actor' USING ERRCODE='42501'; END IF;
 INSERT INTO retail.promotion_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,metadata) VALUES(NEW.tenant_id,nullif(current_setting('app.user_id',true),'')::uuid,TG_TABLE_NAME||CASE WHEN TG_OP='INSERT' THEN '.create' ELSE '.update' END,NEW.id,coalesce(nullif(current_setting('app.correlation_id',true),'')::uuid,gen_random_uuid()),jsonb_build_object('active',NEW.active,'type',NEW.discount_type,'value',NEW.discount_value::text));
 RETURN NEW;
END $$;
ALTER FUNCTION retail.audit_promotion_change() OWNER TO smartretail_discounts_guard;
REVOKE ALL ON FUNCTION retail.audit_promotion_change() FROM PUBLIC;
CREATE TRIGGER coupon_audit BEFORE INSERT OR UPDATE ON retail.coupons FOR EACH ROW EXECUTE FUNCTION retail.audit_promotion_change();
CREATE TRIGGER promotion_audit BEFORE INSERT OR UPDATE ON retail.promotions FOR EACH ROW EXECUTE FUNCTION retail.audit_promotion_change();

CREATE FUNCTION retail.discount_amount(base numeric,kind text,value text) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,retail AS $$
DECLARE val numeric; BEGIN
 IF base<0 OR kind IS NULL OR kind NOT IN('amount','percentage') OR value IS NULL OR length(value)>19 OR value !~ '^(0|[1-9][0-9]*)$' THEN RAISE EXCEPTION 'Invalid discount' USING ERRCODE='23514'; END IF;
 val:=value::numeric;
 IF val>9223372036854775807 OR (kind='percentage' AND val>10000) THEN RAISE EXCEPTION 'Invalid discount range' USING ERRCODE='23514'; END IF;
 RETURN least(base,CASE WHEN kind='amount' THEN val ELSE div(base*val+5000,10000) END);
END $$;
REVOKE ALL ON FUNCTION retail.discount_amount(numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.discount_amount(numeric,text,text) TO smartretail_app;

CREATE FUNCTION retail.validate_sale_discounts() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
DECLARE s retail.sales; l retail.sale_lines; d jsonb; intent jsonb; spec jsonb; promo retail.promotions; c retail.coupons;
 base numeric; expected numeric; subtotal numeric:=0; gross numeric:=0; line_sum numeric:=0; manual_sum numeric:=0; sale_sum numeric:=0; coupon_sum numeric:=0; manual_count integer:=0; cashier boolean; stage text;
BEGIN
 IF TG_TABLE_NAME='sale_lines' THEN SELECT * INTO s FROM retail.sales WHERE tenant_id=NEW.tenant_id AND id=NEW.sale_id;
 ELSE SELECT * INTO s FROM retail.sales WHERE tenant_id=NEW.tenant_id AND id=NEW.id; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Discount header required' USING ERRCODE='23514'; END IF;
 IF s.pricing_version=0 THEN
  IF s.discount_intent IS NOT NULL OR s.discount_details IS NOT NULL OR EXISTS(SELECT 1 FROM retail.sale_lines WHERE tenant_id=s.tenant_id AND sale_id=s.id AND discount_minor_units<>0) THEN RAISE EXCEPTION 'Legacy discount forbidden' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 intent:=coalesce(s.discount_intent,'{}'::jsonb);
 IF s.discount_details IS NULL OR jsonb_typeof(s.discount_details->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(s.discount_details->'lines')<>(SELECT count(*) FROM retail.sale_lines WHERE tenant_id=s.tenant_id AND sale_id=s.id) THEN RAISE EXCEPTION 'Discount snapshot required' USING ERRCODE='23514'; END IF;
 SELECT role='cashier' INTO cashier FROM retail.tenant_memberships WHERE tenant_id=s.tenant_id AND user_id=s.created_by;
 IF (intent ? 'sale' OR jsonb_array_length(coalesce(intent->'lines','[]'::jsonb))>0) AND NOT retail.has_permission('sales.discount') THEN RAISE EXCEPTION 'Discount permission denied' USING ERRCODE='42501'; END IF;
 FOR l IN SELECT * FROM retail.sale_lines WHERE tenant_id=s.tenant_id AND sale_id=s.id ORDER BY product_id LOOP
  SELECT item INTO d FROM jsonb_array_elements(s.discount_details->'lines') item WHERE item->>'productId'=l.product_id::text;
  IF d IS NULL OR jsonb_typeof(d->'type') IS DISTINCT FROM 'string' OR d->>'type' NOT IN('amount','percentage') OR jsonb_typeof(d->'value') IS DISTINCT FROM 'string' OR coalesce(d->>'value','') !~ '^(0|[1-9][0-9]*)$' OR length(d->>'value')>19 OR jsonb_typeof(d->'lineDiscount') IS DISTINCT FROM 'string' OR jsonb_typeof(d->'saleAllocation') IS DISTINCT FROM 'string' OR jsonb_typeof(d->'couponAllocation') IS DISTINCT FROM 'string' OR (SELECT count(*) FROM jsonb_array_elements(s.discount_details->'lines') item WHERE item->>'productId'=l.product_id::text)<>1 OR d->>'lineDiscount' !~ '^(0|[1-9][0-9]*)$' OR d->>'saleAllocation' !~ '^(0|[1-9][0-9]*)$' OR d->>'couponAllocation' !~ '^(0|[1-9][0-9]*)$' OR d->>'lineDiscount' IS NULL OR d->>'saleAllocation' IS NULL OR d->>'couponAllocation' IS NULL THEN RAISE EXCEPTION 'Invalid line snapshot' USING ERRCODE='23514'; END IF;
  base:=div(l.unit_price_minor_units::numeric*l.quantity_milli_units::numeric+500,1000);
  SELECT item->'discount' INTO spec FROM jsonb_array_elements(coalesce(intent->'lines','[]'::jsonb)) item WHERE lower(item->>'productId')=l.product_id::text;
  IF spec IS NOT NULL THEN
   manual_count:=manual_count+1; expected:=retail.discount_amount(base,spec->>'type',spec->>'value');
   IF (spec->>'type'='amount' AND (spec->>'value')::numeric>base) OR d->>'source' IS DISTINCT FROM 'manual' OR d->>'type' IS DISTINCT FROM spec->>'type' OR d->>'value' IS DISTINCT FROM spec->>'value' OR d ? 'promotionId' THEN RAISE EXCEPTION 'Invalid manual snapshot' USING ERRCODE='23514'; END IF;
   IF cashier AND expected*10000>base*2000 THEN RAISE EXCEPTION 'Cashier discount limit' USING ERRCODE='42501'; END IF;
   manual_sum:=manual_sum+expected;
  ELSE
   SELECT * INTO promo FROM retail.promotions p WHERE p.tenant_id=s.tenant_id AND p.product_id=l.product_id AND p.active AND (p.starts_at IS NULL OR p.starts_at<=transaction_timestamp()) AND (p.ends_at IS NULL OR p.ends_at>transaction_timestamp())
    ORDER BY least(base,CASE WHEN p.discount_type='amount' THEN div(p.discount_value::numeric*l.quantity_milli_units::numeric+500,1000) ELSE retail.discount_amount(base,p.discount_type,p.discount_value::text) END) DESC,p.id LIMIT 1 FOR SHARE;
   IF FOUND THEN
    expected:=least(base,CASE WHEN promo.discount_type='amount' THEN div(promo.discount_value::numeric*l.quantity_milli_units::numeric+500,1000) ELSE retail.discount_amount(base,promo.discount_type,promo.discount_value::text) END);
    IF d->>'source' IS DISTINCT FROM 'promotion' OR d->>'promotionId' IS DISTINCT FROM promo.id::text OR d->>'promotionName' IS DISTINCT FROM promo.name OR d->>'type' IS DISTINCT FROM promo.discount_type OR d->>'value' IS DISTINCT FROM promo.discount_value::text THEN RAISE EXCEPTION 'Unapproved promotion' USING ERRCODE='23514'; END IF;
   ELSE expected:=0;
    IF d->>'source' IS DISTINCT FROM 'none' OR d->>'type' IS DISTINCT FROM 'amount' OR d->>'value' IS DISTINCT FROM '0' OR d ? 'promotionId' THEN RAISE EXCEPTION 'Unapproved discount' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
  IF (d->>'lineDiscount')::numeric<>expected OR l.discount_minor_units::numeric<>(d->>'lineDiscount')::numeric+(d->>'saleAllocation')::numeric+(d->>'couponAllocation')::numeric THEN RAISE EXCEPTION 'Line discount mismatch' USING ERRCODE='23514'; END IF;
  gross:=gross+base; subtotal:=subtotal+base-expected; line_sum:=line_sum+expected;
  sale_sum:=sale_sum+(d->>'saleAllocation')::numeric; coupon_sum:=coupon_sum+(d->>'couponAllocation')::numeric;
 END LOOP;
 IF manual_count<>jsonb_array_length(coalesce(intent->'lines','[]'::jsonb)) THEN RAISE EXCEPTION 'Invalid manual mapping' USING ERRCODE='23514'; END IF;
 expected:=0;
 IF intent ? 'sale' THEN spec:=intent->'sale'; IF jsonb_typeof(spec->'value') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid sale discount snapshot' USING ERRCODE='23514'; END IF; expected:=retail.discount_amount(subtotal,spec->>'type',spec->>'value');
  IF (spec->>'type'='amount' AND (spec->>'value')::numeric>subtotal) OR s.discount_details->'manualSale' IS DISTINCT FROM spec THEN RAISE EXCEPTION 'Sale discount mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF expected<>sale_sum OR (cashier AND (sale_sum*10000>subtotal*2000 OR (manual_sum+sale_sum)*10000>gross*2000)) THEN RAISE EXCEPTION 'Manual discount limit' USING ERRCODE='42501'; END IF;
 expected:=0;
 IF intent ? 'couponCode' THEN
  c:=retail.lock_coupon((s.discount_details->'coupon'->>'id')::uuid);
  IF NOT EXISTS(SELECT 1 FROM retail.coupons WHERE tenant_id=s.tenant_id AND id=c.id) OR intent->>'couponCode' IS DISTINCT FROM c.code OR s.discount_details->'coupon'->>'code' IS DISTINCT FROM c.code OR s.discount_details->'coupon'->>'type' IS DISTINCT FROM c.discount_type OR s.discount_details->'coupon'->>'value' IS DISTINCT FROM c.discount_value::text OR jsonb_typeof(s.discount_details->'coupon'->'value') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Coupon snapshot mismatch' USING ERRCODE='23514'; END IF;
  IF NOT retail.has_coupon_redemption(s.id,c.id) THEN RAISE EXCEPTION 'Coupon use missing' USING ERRCODE='23514'; END IF;
  expected:=retail.discount_amount(subtotal-sale_sum,c.discount_type,c.discount_value::text);
 ELSE IF s.discount_details ? 'coupon' THEN RAISE EXCEPTION 'Unrequested coupon' USING ERRCODE='23514'; END IF; END IF;
 IF jsonb_typeof(s.discount_details->'lineDiscountTotal') IS DISTINCT FROM 'string' OR jsonb_typeof(s.discount_details->'saleDiscountTotal') IS DISTINCT FROM 'string' OR jsonb_typeof(s.discount_details->'couponDiscountTotal') IS DISTINCT FROM 'string' OR coalesce(s.discount_details->>'lineDiscountTotal','') !~ '^(0|[1-9][0-9]*)$' OR coalesce(s.discount_details->>'saleDiscountTotal','') !~ '^(0|[1-9][0-9]*)$' OR coalesce(s.discount_details->>'couponDiscountTotal','') !~ '^(0|[1-9][0-9]*)$' THEN RAISE EXCEPTION 'Invalid discount totals snapshot' USING ERRCODE='23514'; END IF;
 IF coupon_sum<>expected OR (s.discount_details->>'lineDiscountTotal')::numeric<>line_sum OR (s.discount_details->>'saleDiscountTotal')::numeric<>sale_sum OR (s.discount_details->>'couponDiscountTotal')::numeric<>coupon_sum THEN RAISE EXCEPTION 'Discount totals mismatch' USING ERRCODE='23514'; END IF;
 FOR stage IN SELECT unnest(ARRAY['saleAllocation','couponAllocation']) LOOP
  IF EXISTS(
   WITH weights AS(SELECT sl.product_id,CASE WHEN stage='saleAllocation' THEN sl.line_total_minor_units::numeric+(j->>'saleAllocation')::numeric+(j->>'couponAllocation')::numeric ELSE sl.line_total_minor_units::numeric+(j->>'couponAllocation')::numeric END w,(j->>stage)::numeric actual FROM retail.sale_lines sl JOIN LATERAL jsonb_array_elements(s.discount_details->'lines') j ON j->>'productId'=sl.product_id::text WHERE sl.tenant_id=s.tenant_id AND sl.sale_id=s.id),
   shares AS(SELECT *,coalesce(div(sum(actual) OVER()*w,nullif(sum(w) OVER(),0)),0) share,coalesce(mod(sum(actual) OVER()*w,nullif(sum(w) OVER(),0)),0) remainder,sum(actual) OVER() amount FROM weights),
   ordered AS(SELECT *,row_number() OVER(ORDER BY remainder DESC,product_id) rank,sum(share) OVER() allocated FROM shares)
   SELECT 1 FROM ordered WHERE actual<>share+CASE WHEN rank<=amount-allocated THEN 1 ELSE 0 END
  ) THEN RAISE EXCEPTION 'Discount allocation mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE FUNCTION retail.has_coupon_redemption(sid uuid,cid uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NOT retail.has_permission('sales.create') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 RETURN EXISTS(SELECT 1 FROM retail.coupon_redemptions WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND sale_id=sid AND coupon_id=cid);
END $$;
ALTER FUNCTION retail.has_coupon_redemption(uuid,uuid) OWNER TO smartretail_discounts_guard;
REVOKE ALL ON FUNCTION retail.has_coupon_redemption(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.has_coupon_redemption(uuid,uuid) TO smartretail_app;
REVOKE ALL ON FUNCTION retail.validate_sale_discounts() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER sale_discount_complete AFTER INSERT ON retail.sales DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.validate_sale_discounts();
CREATE CONSTRAINT TRIGGER sale_line_discount_complete AFTER INSERT ON retail.sale_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.validate_sale_discounts();
CREATE OR REPLACE FUNCTION retail.guard_return_child() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
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
  IF (SELECT pricing_version FROM retail.sales WHERE tenant_id=NEW.tenant_id AND id=NEW.sale_id)=1 THEN
   IF NEW.refunded_minor_units::numeric<>div(original.line_total_minor_units::numeric*(prior+NEW.quantity_milli_units)*2+original.quantity_milli_units,original.quantity_milli_units::numeric*2)-div(original.line_total_minor_units::numeric*prior*2+original.quantity_milli_units,original.quantity_milli_units::numeric*2) THEN RAISE EXCEPTION 'Historical paid refund mismatch' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.refunded_minor_units::numeric <> div(original.unit_price_minor_units::numeric*(prior+NEW.quantity_milli_units)+500,1000)-div(original.unit_price_minor_units::numeric*prior+500,1000) THEN RAISE EXCEPTION 'Historical refund mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  SELECT amount_minor_units INTO paid FROM retail.sale_payments WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id AND method=NEW.method;
  SELECT coalesce(sum(amount_minor_units),0) INTO prior FROM retail.sale_return_refunds WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id AND method=NEW.method;
  IF paid IS NULL OR prior+NEW.amount_minor_units>paid THEN RAISE EXCEPTION 'Refund method exceeded' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NEW;
END $$;

REVOKE CREATE ON SCHEMA retail FROM smartretail_discounts_guard;
COMMIT;
