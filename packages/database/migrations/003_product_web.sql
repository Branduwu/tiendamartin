BEGIN;
SET LOCAL ROLE smartretail_owner;
-- Enumeration before tenant selection: only this authenticated subject's active rows.
ALTER POLICY own_membership ON retail.tenant_memberships USING (
  user_id=nullif(current_setting('app.user_id',true),'')::uuid AND status='active'
);
-- Identity and tenant cannot be changed by the application role.
GRANT UPDATE (name,sku,barcode,unit,purchase_cost,sale_price,status) ON retail.products TO smartretail_app;
CREATE POLICY product_update ON retail.products FOR UPDATE
USING (retail.has_permission('products.write'))
WITH CHECK (retail.has_permission('products.write'));
COMMIT;
