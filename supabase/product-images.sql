-- Private bucket; only the authorized server API writes validated/re-encoded JPEG.
-- Browser JWTs cannot read/list/upload/replace/delete this bucket directly.
BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('product-images','product-images',false,1572864,ARRAY['image/jpeg'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=1572864,allowed_mime_types=ARRAY['image/jpeg'];
CREATE POLICY smartretail_product_images_private ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
USING(bucket_id <> 'product-images') WITH CHECK(bucket_id <> 'product-images');
COMMIT;
