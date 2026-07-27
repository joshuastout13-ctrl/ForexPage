-- Supabase Storage Bucket & RLS Policies for Admin Email Attachments
-- Run this in your Supabase SQL Editor to create a storage bucket for email attachments and uploads.

-- 1. Create the storage bucket 'email-attachments'
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'email-attachments', 
  'email-attachments', 
  true, 
  52428800, -- 50 MB max file size
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
    'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- 2. Policy: Public Read Access
CREATE POLICY "Public Read Access for email-attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'email-attachments');

-- 3. Policy: Upload Access
CREATE POLICY "Upload Access for email-attachments"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'email-attachments');

-- 4. Policy: Delete Access
CREATE POLICY "Delete Access for email-attachments"
ON storage.objects FOR DELETE
USING (bucket_id = 'email-attachments');
