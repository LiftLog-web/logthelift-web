-- Run this in the Supabase SQL editor.
--
-- Returns per-program ratings scoped to one employer's employees.
-- Called by the master practitioner account to view per-client scores.
--
-- Uses the same planId-based join pattern as get_featured_program_ratings so
-- only workouts explicitly assigned by the employer (data->>'planId' matches an
-- employer-created workout_plan) contribute to the scores. Personal workouts
-- logged during the same window are excluded.
--
-- completed_count = distinct employees who logged at least one matching workout
-- total_count     = distinct employees enrolled (assigned that workout plan)

CREATE OR REPLACE FUNCTION get_master_employer_ratings(
  p_practitioner_id UUID,
  p_employer_id     UUID
)
RETURNS TABLE(
  plan_name         TEXT,
  plan_template_id  UUID,
  avg_effectiveness NUMERIC,
  avg_enjoyment     NUMERIC,
  rating_count      BIGINT,
  completed_count   BIGINT,
  total_count       BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_practitioner_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH base AS (
    -- All employees of this employer who have a workout_plan for each featured template
    SELECT
      pt.name::TEXT AS pname,
      pt.id         AS template_id,
      wp.patient_id,
      wp.id         AS workout_plan_id
    FROM plan_templates pt
    JOIN employer_programs ep ON ep.plan_template_id = pt.id
                              AND ep.employer_id      = p_employer_id
    JOIN patient_links     pl ON pl.practitioner_id  = ep.employer_id
    JOIN workout_plans     wp ON wp.patient_id        = pl.patient_id
                              AND wp.name             = pt.name
                              AND wp.practitioner_id  = ep.employer_id
    WHERE pt.practitioner_id = p_practitioner_id
      AND pt.is_featured      = true
  ),
  totals AS (
    SELECT b.pname, b.template_id, COUNT(DISTINCT b.patient_id)::BIGINT AS total_count
    FROM base b
    GROUP BY b.pname, b.template_id
  ),
  workout_data AS (
    SELECT
      b.pname,
      b.patient_id,
      NULLIF(COALESCE(
        NULLIF((sw.data->>'effectivenessRating')::numeric, 0),
        NULLIF((sw.data->>'satisfactionRating')::numeric,  0)
      ), 0) AS eff,
      NULLIF((sw.data->>'enjoymentRating')::numeric, 0)  AS enj
    FROM base b
    JOIN synced_workouts sw ON sw.user_id            = b.patient_id
                            AND (sw.data->>'planId') = b.workout_plan_id::text
  ),
  completed AS (
    SELECT wd.pname, COUNT(DISTINCT wd.patient_id)::BIGINT AS completed_count
    FROM workout_data wd
    GROUP BY wd.pname
  )
  SELECT
    t.pname                                                                   AS plan_name,
    t.template_id                                                             AS plan_template_id,
    ROUND(AVG(wd.eff) FILTER (WHERE wd.eff IS NOT NULL), 1)                  AS avg_effectiveness,
    ROUND(AVG(wd.enj) FILTER (WHERE wd.enj IS NOT NULL), 1)                  AS avg_enjoyment,
    COUNT(*) FILTER (WHERE wd.eff IS NOT NULL OR wd.enj IS NOT NULL)         AS rating_count,
    COALESCE(c.completed_count, 0)                                           AS completed_count,
    t.total_count
  FROM totals t
  LEFT JOIN workout_data wd ON wd.pname = t.pname
  LEFT JOIN completed    c  ON  c.pname = t.pname
  GROUP BY t.pname, t.template_id, c.completed_count, t.total_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_master_employer_ratings(UUID, UUID) TO authenticated;
