BEGIN;
SET LOCAL ROLE smartretail_owner;
GRANT CREATE ON SCHEMA retail TO smartretail_discounts_guard;
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_permission_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_permission_check CHECK(permission IN (
'products.read','products.write','locations.read','locations.write','inventory.read','inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage',
'sales.read','sales.create','sales.return','cash.read','cash.open','cash.move','cash.close','suppliers.read','suppliers.write','purchases.read','purchases.write','purchases.receive','customers.read','customers.write','reports.read','inventory.minimum.write','sales.discount','promotions.read','promotions.write','taxes.manage'));
INSERT INTO retail.role_permissions VALUES('owner','taxes.manage'),('admin','taxes.manage');
CREATE TABLE retail.tax_profiles(
 tenant_id uuid NOT NULL REFERENCES retail.tenants,id uuid NOT NULL,name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 rate bigint NOT NULL CHECK(rate BETWEEN 0 AND 1000000),active boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,
 PRIMARY KEY(tenant_id,id)
);
ALTER TABLE retail.tax_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.tax_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_tenant ON retail.tax_profiles AS RESTRICTIVE
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member())
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member());
CREATE POLICY tax_read ON retail.tax_profiles FOR SELECT USING(retail.has_permission('products.read') OR retail.has_permission('sales.create') OR retail.has_permission('taxes.manage'));
CREATE POLICY tax_create ON retail.tax_profiles FOR INSERT WITH CHECK(retail.has_permission('taxes.manage'));
CREATE POLICY tax_update ON retail.tax_profiles FOR UPDATE USING(retail.has_permission('taxes.manage')) WITH CHECK(retail.has_permission('taxes.manage'));
CREATE POLICY tax_lock ON retail.tax_profiles FOR UPDATE USING(retail.has_permission('sales.create')) WITH CHECK(false);
GRANT SELECT,INSERT,UPDATE ON retail.tax_profiles TO smartretail_app;
ALTER TABLE retail.products ADD COLUMN tax_profile_id uuid,
 ADD CONSTRAINT product_tax_tenant FOREIGN KEY(tenant_id,tax_profile_id) REFERENCES retail.tax_profiles(tenant_id,id);
CREATE INDEX product_tax_profile ON retail.products(tenant_id,tax_profile_id) WHERE tax_profile_id IS NOT NULL;
GRANT UPDATE(tax_profile_id) ON retail.products TO smartretail_app;
CREATE FUNCTION retail.guard_product_tax() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
DECLARE configured retail.tax_profiles;
BEGIN
 IF TG_OP='UPDATE' AND NEW.tax_profile_id IS NOT DISTINCT FROM OLD.tax_profile_id THEN RETURN NEW; END IF;
 IF NEW.tax_profile_id IS NOT NULL OR TG_OP='UPDATE' THEN
  IF NOT retail.has_permission('taxes.manage') THEN RAISE EXCEPTION 'Tax assignment permission denied' USING ERRCODE='42501'; END IF;
 END IF;
 IF NEW.tax_profile_id IS NOT NULL THEN
  SELECT * INTO configured FROM retail.tax_profiles WHERE tenant_id=NEW.tenant_id AND id=NEW.tax_profile_id FOR SHARE;
  IF NOT FOUND OR NOT configured.active THEN RAISE EXCEPTION 'Tax profile unavailable' USING ERRCODE='23503'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.guard_product_tax() FROM PUBLIC;
CREATE TRIGGER product_tax_guard BEFORE INSERT OR UPDATE ON retail.products FOR EACH ROW EXECUTE FUNCTION retail.guard_product_tax();
ALTER TABLE retail.promotion_audit DROP CONSTRAINT promotion_audit_operation_check;
ALTER TABLE retail.promotion_audit ADD CONSTRAINT promotion_audit_operation_check CHECK(operation IN('coupons.create','coupons.update','promotions.create','promotions.update','taxes.create','taxes.update','products.tax'));
CREATE FUNCTION retail.audit_product_tax() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
DECLARE previous uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.tax_profile_id IS NOT DISTINCT FROM OLD.tax_profile_id THEN RETURN NEW; END IF;
  previous:=OLD.tax_profile_id;
 ELSIF NEW.tax_profile_id IS NULL THEN RETURN NEW;
 END IF;
 IF NOT retail.has_permission('taxes.manage') OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'Invalid tax assignment actor' USING ERRCODE='42501'; END IF;
 INSERT INTO retail.promotion_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,metadata)
 VALUES(NEW.tenant_id,nullif(current_setting('app.user_id',true),'')::uuid,'products.tax',NEW.id,coalesce(nullif(current_setting('app.correlation_id',true),'')::uuid,gen_random_uuid()),jsonb_build_object('previousProfileId',previous,'profileId',NEW.tax_profile_id));
 RETURN NEW;
END $$;
ALTER FUNCTION retail.audit_product_tax() OWNER TO smartretail_discounts_guard;
REVOKE ALL ON FUNCTION retail.audit_product_tax() FROM PUBLIC;
CREATE TRIGGER product_tax_audit AFTER INSERT OR UPDATE ON retail.products FOR EACH ROW EXECUTE FUNCTION retail.audit_product_tax();
CREATE FUNCTION retail.audit_tax_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$
BEGIN
 IF NOT retail.has_permission('taxes.manage') OR (TG_OP='INSERT' AND NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::uuid) OR (TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at OR NEW.created_by<>OLD.created_by)) THEN RAISE EXCEPTION 'Invalid tax actor' USING ERRCODE='42501'; END IF;
 INSERT INTO retail.promotion_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,metadata)
 VALUES(NEW.tenant_id,nullif(current_setting('app.user_id',true),'')::uuid,CASE WHEN TG_OP='INSERT' THEN 'taxes.create' ELSE 'taxes.update' END,NEW.id,coalesce(nullif(current_setting('app.correlation_id',true),'')::uuid,gen_random_uuid()),jsonb_build_object('active',NEW.active,'rate',NEW.rate::text));
 RETURN NEW;
END $$;
ALTER FUNCTION retail.audit_tax_change() OWNER TO smartretail_discounts_guard;
REVOKE ALL ON FUNCTION retail.audit_tax_change() FROM PUBLIC;
CREATE TRIGGER tax_catalog_audit BEFORE INSERT OR UPDATE ON retail.tax_profiles FOR EACH ROW EXECUTE FUNCTION retail.audit_tax_change();
ALTER TABLE retail.sales ADD COLUMN tax_version integer NOT NULL DEFAULT 0 CHECK(tax_version IN(0,1));
ALTER TABLE retail.sale_lines ADD COLUMN tax_profile_id uuid,ADD COLUMN tax_profile_name text,
 ADD COLUMN tax_rate bigint,ADD COLUMN tax_base_minor_units bigint,ADD COLUMN tax_amount_minor_units bigint NOT NULL DEFAULT 0 CHECK(tax_amount_minor_units>=0),
 ADD CONSTRAINT sale_tax_tenant FOREIGN KEY(tenant_id,tax_profile_id) REFERENCES retail.tax_profiles(tenant_id,id),
 ADD CONSTRAINT sale_tax_snapshot CHECK(
 (tax_profile_id IS NULL AND tax_profile_name IS NULL AND tax_rate IS NULL AND tax_base_minor_units IS NULL AND tax_amount_minor_units=0)
 OR
 (tax_profile_id IS NOT NULL AND tax_profile_name IS NOT NULL AND length(btrim(tax_profile_name)) BETWEEN 1 AND 120
 AND tax_rate IS NOT NULL AND tax_rate BETWEEN 0 AND 1000000 AND tax_base_minor_units IS NOT NULL AND tax_base_minor_units>=0
 AND tax_amount_minor_units::numeric=div(tax_base_minor_units::numeric*tax_rate::numeric+5000,10000)
 AND tax_base_minor_units::numeric=line_total_minor_units::numeric-tax_amount_minor_units::numeric));
ALTER TABLE retail.sale_lines DROP CONSTRAINT sale_paid_line;
ALTER TABLE retail.sale_lines ADD CONSTRAINT sale_paid_line CHECK(line_total_minor_units::numeric-tax_amount_minor_units::numeric+discount_minor_units::numeric=div(unit_price_minor_units::numeric*quantity_milli_units::numeric+500,1000));
GRANT INSERT(tax_version) ON retail.sales TO smartretail_app;
ALTER TABLE retail.sale_return_lines ADD COLUMN refunded_tax_minor_units bigint NOT NULL DEFAULT 0 CHECK(refunded_tax_minor_units>=0 AND refunded_tax_minor_units<=refunded_minor_units);
CREATE FUNCTION retail.validate_sale_taxes() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
DECLARE header retail.sales;line retail.sale_lines;product retail.products;profile retail.tax_profiles;assigned integer:=0;
BEGIN
 IF TG_TABLE_NAME='sales' THEN SELECT * INTO header FROM retail.sales WHERE tenant_id=NEW.tenant_id AND id=NEW.id;
 ELSE SELECT * INTO header FROM retail.sales WHERE tenant_id=NEW.tenant_id AND id=NEW.sale_id; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tax header required' USING ERRCODE='23514'; END IF;
 FOR line IN SELECT * FROM retail.sale_lines WHERE tenant_id=header.tenant_id AND sale_id=header.id ORDER BY product_id LOOP
  SELECT * INTO product FROM retail.products WHERE tenant_id=line.tenant_id AND id=line.product_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tax product required' USING ERRCODE='23514'; END IF;
  IF product.tax_profile_id IS NULL THEN
   IF line.tax_profile_id IS NOT NULL THEN RAISE EXCEPTION 'Unassigned tax snapshot' USING ERRCODE='23514'; END IF;
  ELSE
   assigned:=assigned+1;
   SELECT * INTO profile FROM retail.tax_profiles WHERE tenant_id=header.tenant_id AND id=product.tax_profile_id FOR SHARE;
   IF NOT FOUND OR NOT profile.active THEN RAISE EXCEPTION 'Tax profile unavailable' USING ERRCODE='42501'; END IF;
   IF line.tax_profile_id IS DISTINCT FROM profile.id OR line.tax_profile_name IS DISTINCT FROM profile.name OR line.tax_rate IS DISTINCT FROM profile.rate THEN RAISE EXCEPTION 'Current tax snapshot required' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 IF header.tax_version<>(CASE WHEN assigned>0 THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'Tax version mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION retail.validate_sale_taxes() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER sale_tax_complete AFTER INSERT ON retail.sales DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.validate_sale_taxes();
CREATE CONSTRAINT TRIGGER sale_line_tax_complete AFTER INSERT ON retail.sale_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retail.validate_sale_taxes();


CREATE OR REPLACE FUNCTION retail.validate_sale_discounts() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,retail AS $$
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
   WITH weights AS(SELECT sl.product_id,CASE WHEN stage='saleAllocation' THEN (sl.line_total_minor_units::numeric-sl.tax_amount_minor_units::numeric)+(j->>'saleAllocation')::numeric+(j->>'couponAllocation')::numeric ELSE (sl.line_total_minor_units::numeric-sl.tax_amount_minor_units::numeric)+(j->>'couponAllocation')::numeric END w,(j->>stage)::numeric actual FROM retail.sale_lines sl JOIN LATERAL jsonb_array_elements(s.discount_details->'lines') j ON j->>'productId'=sl.product_id::text WHERE sl.tenant_id=s.tenant_id AND sl.sale_id=s.id),
   shares AS(SELECT *,coalesce(div(sum(actual) OVER()*w,nullif(sum(w) OVER(),0)),0) share,coalesce(mod(sum(actual) OVER()*w,nullif(sum(w) OVER(),0)),0) remainder,sum(actual) OVER() amount FROM weights),
   ordered AS(SELECT *,row_number() OVER(ORDER BY remainder DESC,product_id) rank,sum(share) OVER() allocated FROM shares)
   SELECT 1 FROM ordered WHERE actual<>share+CASE WHEN rank<=amount-allocated THEN 1 ELSE 0 END
  ) THEN RAISE EXCEPTION 'Discount allocation mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;

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
  SELECT amount_minor_units INTO paid FROM retail.sale_payments WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id AND method=NEW.method;
  SELECT coalesce(sum(amount_minor_units),0) INTO prior FROM retail.sale_return_refunds WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id AND method=NEW.method;
  IF paid IS NULL OR prior+NEW.amount_minor_units>paid THEN RAISE EXCEPTION 'Refund method exceeded' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NEW;
END $$;


REVOKE CREATE ON SCHEMA retail FROM smartretail_discounts_guard;
COMMIT;
