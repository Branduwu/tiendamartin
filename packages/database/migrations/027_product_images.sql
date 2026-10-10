BEGIN;
SET LOCAL ROLE smartretail_owner;
CREATE TABLE retail.product_images (
 tenant_id uuid NOT NULL, product_id uuid NOT NULL, image_id uuid NOT NULL,
 object_path text NOT NULL UNIQUE, updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,product_id), FOREIGN KEY(tenant_id,product_id) REFERENCES retail.products(tenant_id,id),
 CHECK(object_path = tenant_id::text || '/' || product_id::text || '/' || image_id::text || '.jpg')
);
ALTER TABLE retail.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.product_images FORCE ROW LEVEL SECURITY;
CREATE POLICY product_image_scope ON retail.product_images AS RESTRICTIVE USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member());
CREATE POLICY product_image_read ON retail.product_images FOR SELECT USING(retail.has_permission('products.read'));
CREATE POLICY product_image_insert ON retail.product_images FOR INSERT WITH CHECK(retail.has_permission('products.write') AND updated_by=nullif(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY product_image_update ON retail.product_images FOR UPDATE USING(retail.has_permission('products.write')) WITH CHECK(retail.has_permission('products.write') AND updated_by=nullif(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY product_image_delete ON retail.product_images FOR DELETE USING(retail.has_permission('products.write'));
GRANT SELECT,INSERT,UPDATE,DELETE ON retail.product_images TO smartretail_app;
CREATE TABLE retail.product_image_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,product_id uuid NOT NULL,actor_user_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('photo.change_attempt','photo.replace','photo.remove')),image_id uuid,correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,product_id) REFERENCES retail.products(tenant_id,id)
);
ALTER TABLE retail.product_image_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.product_image_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY product_image_audit_scope ON retail.product_image_audit AS RESTRICTIVE USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member()) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND retail.is_active_member());
CREATE POLICY product_image_audit_read ON retail.product_image_audit FOR SELECT USING(retail.has_permission('products.write'));
CREATE POLICY product_image_audit_insert ON retail.product_image_audit FOR INSERT WITH CHECK(retail.has_permission('products.write') AND actor_user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON retail.product_image_audit TO smartretail_app;
CREATE TRIGGER product_image_audit_immutable BEFORE UPDATE OR DELETE ON retail.product_image_audit FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();
CREATE INDEX product_image_audit_actor_time ON retail.product_image_audit(tenant_id,actor_user_id,created_at);
COMMIT;
