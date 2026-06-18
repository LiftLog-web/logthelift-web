-- ADD_EMPLOYER_PROGRAMS.sql
-- Run once in the Supabase SQL editor.

-- ── 1. Featured flag on plan_templates ───────────────────────────────────────
ALTER TABLE plan_templates
  ADD COLUMN IF NOT EXISTS is_featured            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS featured_duration_days INT;

-- ── 2. Teams ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employer_teams (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE employer_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employers manage own teams" ON employer_teams
  FOR ALL USING  (employer_id = auth.uid())
  WITH CHECK     (employer_id = auth.uid());

-- ── 3. Employee-to-team assignment (nullable) ─────────────────────────────────
ALTER TABLE patient_links
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES employer_teams(id) ON DELETE SET NULL;

-- ── 4. Employer programs (launched challenges) ────────────────────────────────
CREATE TABLE IF NOT EXISTS employer_programs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_template_id UUID        NOT NULL REFERENCES plan_templates(id) ON DELETE RESTRICT,
  name             TEXT        NOT NULL,
  started_at       DATE        NOT NULL,
  ends_at          DATE        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE employer_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employers manage own programs" ON employer_programs
  FOR ALL USING  (employer_id = auth.uid())
  WITH CHECK     (employer_id = auth.uid());

-- ── 5. Allow any authenticated user to read featured templates ────────────────
-- (Featured templates belong to Jordan's master account; all employers must see them)
DROP POLICY IF EXISTS "Any authenticated user can read featured templates" ON plan_templates;
CREATE POLICY "Any authenticated user can read featured templates" ON plan_templates
  FOR SELECT USING (is_featured = true OR practitioner_id = auth.uid());

-- ── 6. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_employer_teams_employer ON employer_teams(employer_id);
CREATE INDEX IF NOT EXISTS idx_patient_links_team      ON patient_links(team_id);
CREATE INDEX IF NOT EXISTS idx_employer_programs_emp   ON employer_programs(employer_id);
