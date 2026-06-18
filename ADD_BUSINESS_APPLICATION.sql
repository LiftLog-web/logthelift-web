-- Run this in the Supabase SQL editor.
-- Adds business_type to profiles so business applicants can be identified
-- before their account is manually approved (is_employer / is_gym_owner flipped).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS business_type TEXT
  CHECK (business_type IN ('gym', 'employer'));
