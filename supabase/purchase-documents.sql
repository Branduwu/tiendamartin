-- Private originals are served only through the authenticated, purchase-scoped API.
-- Objects are immutable and uploaded only after a purchase exists; cancellation
-- before confirmation has no persistent object to clean up.
BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('purchase-documents','purchase-documents',false,4194304,ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=4194304,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','application/pdf'];
CREATE POLICY smartretail_purchase_documents_private ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
USING(bucket_id <> 'purchase-documents') WITH CHECK(bucket_id <> 'purchase-documents');
COMMIT;
