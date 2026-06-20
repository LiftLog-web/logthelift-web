-- Run this in the Supabase SQL editor (replaces previous version).
-- Joins through employer_programs to find workout_plans created by the employer
-- (practitioner_id = employer_id), not the master practitioner account.
-- This handles the case where the employer account UUID differs from the master UUID.

CREATE OR REPLACE FUNCTION get_featured_program_ratings(p_practitioner_id UUID)
RETURNS TABLE(
  plan_name          TEXT,
  avg_effectiveness  NUMERIC,
  avg_enjoyment      NUMERIC,
  avg_satisfaction   NUMERIC,
  rating_count       BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_practitioner_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    pt.name::TEXT                                                        AS plan_name,
    ROUND(AVG(r.eff) FILTER (WHERE r.eff IS NOT NULL), 1)               AS avg_effectiveness,
    ROUND(AVG(r.enj) FILTER (WHERE r.enj IS NOT NULL), 1)               AS avg_enjoyment,
    NULL::NUMERIC                                                        AS avg_satisfaction,
    COUNT(*) FILTER (WHERE r.eff IS NOT NULL OR r.enj IS NOT NULL)      AS rating_count
  FROM plan_templates pt
  -- Find all employers running this featured template
  JOIN employer_programs ep ON ep.plan_template_id = pt.id
  -- Find employees of those employers
  JOIN patient_links     pl ON pl.practitioner_id  = ep.employer_id
  -- Find the workout_plans the employer created for those employees
  JOIN workout_plans     wp ON wp.patient_id        = pl.patient_id
                            AND wp.name             = pt.name
                            AND wp.practitioner_id  = ep.employer_id
  -- Match synced workouts via the planId UUID stored in data
  JOIN synced_workouts   sw ON sw.user_id           = wp.patient_id
                            AND (sw.data->>'planId') = wp.id::text
  CROSS JOIN LATERAL (
    SELECT
      NULLIF(COALESCE(
        NULLIF((sw.data->>'effectivenessRating')::numeric, 0),
        NULLIF((sw.data->>'satisfactionRating')::numeric,  0)
      ), 0) AS eff,
      NULLIF((sw.data->>'enjoymentRating')::numeric, 0)                 AS enj
  ) AS r
  WHERE pt.practitioner_id = p_practitioner_id
    AND pt.is_featured      = true
  GROUP BY pt.name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_featured_program_ratings(UUID) TO authenticated;
