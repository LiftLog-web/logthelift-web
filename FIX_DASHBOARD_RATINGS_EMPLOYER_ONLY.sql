-- Run this in the Supabase SQL editor.
--
-- Fixes get_featured_program_stats (master dashboard) to only count ratings
-- from workouts logged against an employer-assigned plan (planId must match
-- workout_plans.id). Excludes personal workouts and practitioner-assigned workouts.

CREATE OR REPLACE FUNCTION get_featured_program_stats(p_practitioner_id UUID)
RETURNS TABLE(
  avg_effectiveness     NUMERIC,
  effectiveness_count   BIGINT,
  avg_enjoyment         NUMERIC,
  enjoyment_count       BIGINT,
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
  employer_plans AS (
    -- Only workout_plans created by an employer for their employees
    SELECT wp.id AS workout_plan_id, wp.patient_id
    FROM workout_plans wp
    WHERE wp.practitioner_id IN (SELECT employer_id FROM program_employers)
  ),
  rated_workouts AS (
    -- Only workouts matched by planId to an employer-assigned plan
    SELECT
      NULLIF(COALESCE(
        NULLIF((sw.data->>'effectivenessRating')::numeric, 0),
        NULLIF((sw.data->>'satisfactionRating')::numeric,  0)
      ), 0) AS eff,
      NULLIF((sw.data->>'enjoymentRating')::numeric, 0)    AS enj
    FROM synced_workouts sw
    JOIN employer_plans ep ON ep.patient_id         = sw.user_id
                           AND ep.workout_plan_id::text = (sw.data->>'planId')
  )
  SELECT
    ROUND(AVG(eff) FILTER (WHERE eff IS NOT NULL), 2),
    COUNT(eff)    FILTER (WHERE eff IS NOT NULL),
    ROUND(AVG(enj) FILTER (WHERE enj IS NOT NULL), 2),
    COUNT(enj)    FILTER (WHERE enj IS NOT NULL),
    (SELECT COUNT(*) FROM program_employers),
    (SELECT COUNT(DISTINCT patient_id) FROM employer_plans)
  FROM rated_workouts;
END;
$$;

GRANT EXECUTE ON FUNCTION get_featured_program_stats(UUID) TO authenticated;
