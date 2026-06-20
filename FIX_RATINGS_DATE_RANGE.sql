-- Run this in the Supabase SQL editor.
--
-- Fixes get_featured_program_ratings so ratings are pulled from any workout
-- an employee logs during the employer's program date window — not filtered by
-- planId. The planId filter was blocking all ratings because planId is not yet
-- stamped on workouts in the production mobile build.
--
-- completion_count still uses planId (will populate once the mobile EAS build
-- ships the isPlanWorkout fix).

DROP FUNCTION IF EXISTS get_featured_program_ratings(uuid);

CREATE FUNCTION get_featured_program_ratings(p_practitioner_id UUID)
RETURNS TABLE(
  plan_name          TEXT,
  avg_effectiveness  NUMERIC,
  avg_enjoyment      NUMERIC,
  avg_satisfaction   NUMERIC,
  rating_count       BIGINT,
  completed_count    BIGINT,
  total_count        BIGINT
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
  WITH base AS (
    SELECT
      pt.name::TEXT   AS plan_name,
      wp.patient_id,
      wp.id           AS workout_plan_id,
      ep.started_at   AS prog_start,
      ep.ends_at      AS prog_end
    FROM plan_templates  pt
    JOIN employer_programs ep ON ep.plan_template_id = pt.id
    JOIN patient_links     pl ON pl.practitioner_id  = ep.employer_id
    JOIN workout_plans     wp ON wp.patient_id        = pl.patient_id
                               AND wp.name             = pt.name
                               AND wp.practitioner_id  = ep.employer_id
    WHERE pt.practitioner_id = p_practitioner_id
      AND pt.is_featured      = true
  ),
  totals AS (
    SELECT plan_name, COUNT(DISTINCT patient_id)::BIGINT AS total_count
    FROM base
    GROUP BY plan_name
  ),
  -- Ratings: any workout logged by the employee within the program date window.
  -- Does NOT require planId so ratings work before the mobile planId fix ships.
  workout_ratings AS (
    SELECT
      b.plan_name,
      NULLIF(COALESCE(
        NULLIF((sw.data->>'effectivenessRating')::numeric, 0),
        NULLIF((sw.data->>'satisfactionRating')::numeric,  0)
      ), 0) AS eff,
      NULLIF((sw.data->>'enjoymentRating')::numeric, 0)  AS enj
    FROM base b
    JOIN synced_workouts sw ON sw.user_id    = b.patient_id
                            AND sw.date::date >= b.prog_start
                            AND sw.date::date <= b.prog_end
  ),
  -- Completion: requires planId match (accurate once mobile fix ships).
  completed AS (
    SELECT b.plan_name, COUNT(DISTINCT b.patient_id)::BIGINT AS completed_count
    FROM base b
    JOIN synced_workouts sw ON sw.user_id              = b.patient_id
                            AND (sw.data->>'planId')   = b.workout_plan_id::text
    GROUP BY b.plan_name
  )
  SELECT
    t.plan_name,
    ROUND(AVG(wr.eff) FILTER (WHERE wr.eff IS NOT NULL), 1) AS avg_effectiveness,
    ROUND(AVG(wr.enj) FILTER (WHERE wr.enj IS NOT NULL), 1) AS avg_enjoyment,
    NULL::NUMERIC                                            AS avg_satisfaction,
    COUNT(*) FILTER (WHERE wr.eff IS NOT NULL OR wr.enj IS NOT NULL) AS rating_count,
    COALESCE(c.completed_count, 0)                           AS completed_count,
    t.total_count
  FROM totals t
  LEFT JOIN workout_ratings wr ON wr.plan_name = t.plan_name
  LEFT JOIN completed        c  ON  c.plan_name = t.plan_name
  GROUP BY t.plan_name, c.completed_count, t.total_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_featured_program_ratings(UUID) TO authenticated;
