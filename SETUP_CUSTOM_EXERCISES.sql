-- Run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS custom_exercises (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  muscle_group TEXT NOT NULL,
  equipment TEXT NOT NULL DEFAULT 'Bodyweight',
  type TEXT NOT NULL DEFAULT 'weighted' CHECK (type IN ('weighted', 'duration', 'cardio')),
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image', 'video')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE custom_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creator full access" ON custom_exercises
  FOR ALL USING (auth.uid() = creator_id);

CREATE POLICY "Patients can read practitioner exercises" ON custom_exercises
  FOR SELECT USING (
    creator_id IN (SELECT practitioner_id FROM patient_links WHERE patient_id = auth.uid())
  );

-- Storage bucket (also create via Supabase dashboard: Storage → New Bucket, name: exercise-media, public: true)
INSERT INTO storage.buckets (id, name, public) VALUES ('exercise-media', 'exercise-media', true) ON CONFLICT DO NOTHING;

CREATE POLICY IF NOT EXISTS "Auth users upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'exercise-media');

CREATE POLICY IF NOT EXISTS "Public read exercise media" ON storage.objects
  FOR SELECT USING (bucket_id = 'exercise-media');

CREATE POLICY IF NOT EXISTS "Creator delete exercise media" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'exercise-media' AND (storage.foldername(name))[1] = auth.uid()::text
  );
