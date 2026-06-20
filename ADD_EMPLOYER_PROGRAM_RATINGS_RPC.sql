-- Run this in the Supabase SQL editor.
--
-- Returns per-template aggregate ratings scoped to a single employer's employees.
-- Employees are identified via patient_links (practitioner_id = employer_id).
-- Ratings are pulled only from synced_workouts where planId matches an
-- employer-assigned workout_plan, so personal/practitioner workouts are excluded.

CREATE OR REPLACE FUNCTION get_employer_program_ratings(p_employer_id UUID)
RETURNS TABLE(
  plan_template_id  UUID,
  avg_effectiveness NUMERIC,
  avg_enjoyment     NUMERIC,
  rating_count      BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_employer_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH base AS (
    -- Map each employer_program → the workout_plans the employer assigned to employees
    SELECT
      ep.plan_template_id,
      wp.id AS workout_plan_id
    FROM employer_programs ep
    JOIN plan_templates  pt ON pt.id                  = ep.plan_template_id
    JOIN patient_links   pl ON pl.practitioner_id     = ep.employer_id
    JOIN workout_plans   wp ON wp.patient_id          = pl.patient_id
                           AND wp.name                = pt.name
                           AND wp.practitioner_id     = ep.employer_id
    WHERE ep.employer_id = p_employer_id
  ),
  ratings AS (
    SELECT
      b.plan_template_id,
      NULLIF(COALESCE(
        NULLIF((sw.data->>'effectivenessRating')::numeric, 0),
        NULLIF((sw.data->>'satisfactionRating')::numeric,  0)
      ), 0) AS eff,
      NULLIF((sw.data->>'enjoymentRating')::numeric, 0)   AS enj
    FROM base b
    JOIN synced_workouts sw ON (sw.data->>'planId') = b.workout_plan_id::text
  )
  SELECT
    r.plan_template_id,
    ROUND(AVG(r.eff) FILTER (WHERE r.eff IS NOT NULL), 1) AS avg_effectiveness,
    ROUND(AVG(r.enj) FILTER (WHERE r.enj IS NOT NULL), 1) AS avg_enjoyment,
    COUNT(*)          FILTER (WHERE r.eff IS NOT NULL OR r.enj IS NOT NULL) AS rating_count
  FROM ratings r
  GROUP BY r.plan_template_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_employer_program_ratings(UUID) TO authenticated;
