-- Composer attachments: per-user private bucket.
-- Files live at attachments/{user_id}/{uuid}-{filename}; excerpts ride
-- with the submitted query, the bucket is the durable, RLS-secured store.
INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Owner-only access: first path folder must equal the caller's uid.
CREATE POLICY attachments_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY attachments_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY attachments_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
