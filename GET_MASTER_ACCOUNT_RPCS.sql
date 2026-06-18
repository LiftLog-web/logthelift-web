-- Run this in the Supabase SQL editor.
-- Adds two SECURITY DEFINER functions for the LiftLog master account to read
-- cross-employer data (employer_programs has employer_id = auth.uid() RLS).

-- ─── 1. Client list ─────────────────────────────────────────────────────────
-- Returns one row per employer program launched from a featured template.
CREATE OR REPLACE FUNCTION get_master_clients(p_practitioner_id UUID)
RETURNS TABLE(
  employer_id       UUID,
  employer_name     TEXT,
  company_name      TEXT,
  employee_count    BIGINT,
  program_name      TEXT,
  program_started_at DATE,
  program_ends_at   DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT
      ep.employer_id,
      p.display_name                                                       AS employer_name,
      p.company_name,
      (SELECT COUNT(*) FROM patient_links pl
       WHERE pl.practitioner_id = ep.employer_id)::BIGINT                  AS employee_count,
      ep.name                                                              AS program_name,
      ep.started_at                                                        AS program_started_at,
      ep.ends_at                                                           AS program_ends_at
    FROM employer_programs ep
    JOIN plan_templates pt ON pt.id = ep.plan_template_id
    JOIN profiles        p  ON p.id  = ep.employer_id
    WHERE pt.practitioner_id = p_practitioner_id
      AND pt.is_featured = true
    ORDER BY ep.started_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_master_clients(UUID) TO authenticated;


-- ─── 2. Programs (featured templates + employer launch count) ────────────────
CREATE OR REPLACE FUNCTION get_master_programs(p_practitioner_id UUID)
RETURNS TABLE(
  template_id            UUID,
  template_name          TEXT,
  template_description   TEXT,
  featured_duration_days INT,
  employer_count         BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT
      pt.id                                                       AS template_id,
      pt.name                                                     AS template_name,
      pt.description                                              AS template_description,
      pt.featured_duration_days,
      COUNT(DISTINCT ep.employer_id)::BIGINT                      AS employer_count
    FROM plan_templates pt
    LEFT JOIN employer_programs ep ON ep.plan_template_id = pt.id
    WHERE pt.practitioner_id = p_practitioner_id
      AND pt.is_featured = true
    GROUP BY pt.id, pt.name, pt.description, pt.featured_duration_days
    ORDER BY pt.name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_master_programs(UUID) TO authenticated;
