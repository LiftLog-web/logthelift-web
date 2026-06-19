-- Run this in the Supabase SQL editor.
-- Returns aggregate ratings for each featured program template by joining
-- synced_workouts → workout_plans → plan_templates (SECURITY DEFINER bypasses RLS).

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
    pt.name::TEXT                                                              AS plan_name,
    ROUND(AVG(NULLIF(sw.data->>'effectivenessRating', '')::numeric), 1)       AS avg_effectiveness,
    ROUND(AVG(NULLIF(sw.data->>'enjoymentRating',     '')::numeric), 1)       AS avg_enjoyment,
    ROUND(AVG(NULLIF(sw.data->>'satisfactionRating',  '')::numeric), 1)       AS avg_satisfaction,
    COUNT(*) FILTER (
      WHERE (sw.data->>'effectivenessRating') IS NOT NULL
         OR (sw.data->>'enjoymentRating')     IS NOT NULL
         OR (sw.data->>'satisfactionRating')  IS NOT NULL
    )                                                                          AS rating_count
  FROM synced_workouts sw
  JOIN workout_plans   wp ON wp.id::text = sw.data->>'planId'
  JOIN plan_templates  pt ON pt.name = wp.name
                          AND pt.practitioner_id = p_practitioner_id
                          AND pt.is_featured = true
  GROUP BY pt.name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_featured_program_ratings(UUID) TO authenticated;
