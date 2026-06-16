-- Run in Supabase SQL editor

ALTER TABLE plan_templates ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
