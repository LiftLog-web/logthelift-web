-- Run this in the Supabase SQL editor.
--
-- Adds catalog availability window to plan_templates so the master account can
-- schedule exactly when each program appears in the employer catalog. Employers
-- only see programs whose window is currently open (or opening within ~45 days).

ALTER TABLE plan_templates
ADD COLUMN IF NOT EXISTS catalog_available_from  DATE,
ADD COLUMN IF NOT EXISTS catalog_available_until DATE;

-- Bump get_master_programs to expose the new fields to the frontend.
CREATE OR REPLACE FUNCTION get_master_programs(p_practitioner_id UUID)
RETURNS TABLE(
  template_id             UUID,
  template_name           TEXT,
  template_description    TEXT,
  featured_duration_days  INT,
  employer_count          BIGINT,
  catalog_available_from  DATE,
  catalog_available_until DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT
      pt.id,
      pt.name::TEXT,
      pt.description::TEXT,
      pt.featured_duration_days,
      COUNT(DISTINCT ep.employer_id)::BIGINT,
      pt.catalog_available_from,
      pt.catalog_available_until
    FROM plan_templates pt
    LEFT JOIN employer_programs ep ON ep.plan_template_id = pt.id
    WHERE pt.practitioner_id = p_practitioner_id
      AND pt.is_featured = true
    GROUP BY pt.id, pt.name, pt.description, pt.featured_duration_days,
             pt.catalog_available_from, pt.catalog_available_until
    ORDER BY pt.name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_master_programs(UUID) TO authenticated;
