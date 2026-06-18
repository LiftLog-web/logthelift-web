-- Run this in the Supabase SQL editor.
-- Creates a SECURITY DEFINER function so the LiftLog master account can read
-- aggregated ratings from employer employees without hitting RLS restrictions.

CREATE OR REPLACE FUNCTION get_featured_program_stats(p_practitioner_id UUID)
RETURNS TABLE(
  avg_effectiveness    NUMERIC,
  effectiveness_count  BIGINT,
  avg_enjoyment        NUMERIC,
  enjoyment_count      BIGINT,
  active_employer_count BIGINT,
  total_employee_count  BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH template_ids AS (
    SELECT id FROM plan_templates
    WHERE practitioner_id = p_practitioner_id AND is_featured = true
  ),
  program_employers AS (
    SELECT DISTINCT employer_id FROM employer_programs
    WHERE plan_template_id IN (SELECT id FROM template_ids)
  ),
  employee_ids AS (
    SELECT DISTINCT patient_id FROM patient_links
    WHERE practitioner_id IN (SELECT employer_id FROM program_employers)
  ),
  rated_workouts AS (
    SELECT
      NULLIF(
        COALESCE(
          NULLIF((data->>'effectivenessRating')::numeric, 0),
          NULLIF((data->>'satisfactionRating')::numeric,  0)
        ), 0
      ) AS eff,
      NULLIF((data->>'enjoymentRating')::numeric, 0) AS enj
    FROM synced_workouts
    WHERE user_id IN (SELECT patient_id FROM employee_ids)
  )
  SELECT
    ROUND(AVG(eff) FILTER (WHERE eff IS NOT NULL), 2),
    COUNT(eff)    FILTER (WHERE eff IS NOT NULL),
    ROUND(AVG(enj) FILTER (WHERE enj IS NOT NULL), 2),
    COUNT(enj)    FILTER (WHERE enj IS NOT NULL),
    (SELECT COUNT(*) FROM program_employers),
    (SELECT COUNT(*) FROM employee_ids)
  FROM rated_workouts;
END;
$$;

-- Allow any authenticated user to call this function (the body restricts by p_practitioner_id)
GRANT EXECUTE ON FUNCTION get_featured_program_stats(UUID) TO authenticated;
