-- Supabase Storage dependency for PROFILE-EDIT-01. NOT part of retail migrations.
-- Apply only with separate authorization in an isolated environment first.
BEGIN;
-- Fail rather than modify a bucket or policy that already exists.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('profile-photos','profile-photos',false,1572864,ARRAY['image/jpeg']);

-- Restrictive guard also defeats any broader permissive policy for this bucket.
CREATE POLICY profile_photo_boundary ON storage.objects AS RESTRICTIVE
FOR ALL TO public
USING(bucket_id <> 'profile-photos' OR (auth.uid() IS NOT NULL AND name = auth.uid()::text || '/avatar.jpg'))
WITH CHECK(bucket_id <> 'profile-photos' OR (auth.uid() IS NOT NULL AND name = auth.uid()::text || '/avatar.jpg'));
CREATE POLICY profile_photo_read ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='profile-photos' AND name=auth.uid()::text || '/avatar.jpg');
CREATE POLICY profile_photo_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='profile-photos' AND name=auth.uid()::text || '/avatar.jpg');
CREATE POLICY profile_photo_update ON storage.objects FOR UPDATE TO authenticated
USING(bucket_id='profile-photos' AND name=auth.uid()::text || '/avatar.jpg')
WITH CHECK(bucket_id='profile-photos' AND name=auth.uid()::text || '/avatar.jpg');
CREATE POLICY profile_photo_delete ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='profile-photos' AND name=auth.uid()::text || '/avatar.jpg');
COMMIT;
