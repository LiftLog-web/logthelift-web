-- Run this in the Supabase SQL editor.
--
-- Fixes get_featured_program_ratings so each template only sees ratings from
-- workouts logged AFTER that template's employer_program.started_at, and BEFORE
-- employer_program.ends_at. This prevents workouts logged under an earlier run
-- from bleeding into a newly-launched template.
--
-- Also returns plan_template_id (missing in all previous versions) so the
-- frontend ratingMap can key correctly by template UUID.
--
-- employer_programs are pre-filtered to those whose started_at falls within the
-- template's catalog window, so historical runs from before the window are excluded.

CREATE OR REPLACE FUNCTION get_featured_program_ratings(p_practitioner_id UUID)
RETURNS TABLE(
  plan_template_id   UUID,
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
      pt.id           AS template_id,
      pt.name::TEXT   AS pname,
      ep.started_at   AS ep_start,
      ep.ends_at      AS ep_end,
      wp.patient_id,
      wp.id           AS workout_plan_id
    FROM plan_templates pt
    -- Only employer_programs whose start falls within this template's catalog window
    JOIN employer_programs ep ON ep.plan_template_id = pt.id
      AND (pt.catalog_available_from  IS NULL OR ep.started_at >= pt.catalog_available_from)
      AND (pt.catalog_available_until IS NULL OR ep.started_at <= pt.catalog_available_until)
    JOIN patient_links pl ON pl.practitioner_id = ep.employer_id
    JOIN workout_plans wp ON wp.patient_id       = pl.patient_id
                          AND wp.name            = pt.name
                          AND wp.practitioner_id = ep.employer_id
    WHERE pt.practitioner_id = p_practitioner_id
      AND pt.is_featured      = true
  ),
  totals AS (
    SELECT b.template_id, b.pname, COUNT(DISTINCT b.patient_id)::BIGINT AS total_count
    FROM base b
    GROUP BY b.template_id, b.pname
  ),
  -- Ratings scoped to each employer's own program run window (ep_start → ep_end).
  -- planId match ensures only employer-assigned workouts count.
  -- A workout logged before an employer launched this template is excluded.
  workout_data AS (
    SELECT
      b.template_id,
      b.pname,
      b.patient_id,
      NULLIF(COALESCE(
        NULLIF((sw.data->>'effectivenessRating')::numeric, 0),
        NULLIF((sw.data->>'satisfactionRating')::numeric,  0)
      ), 0) AS eff,
      NULLIF((sw.data->>'enjoymentRating')::numeric, 0) AS enj
    FROM base b
    JOIN synced_workouts sw ON sw.user_id             = b.patient_id
                            AND (sw.data->>'planId')  = b.workout_plan_id::text
                            AND sw.date::date         >= b.ep_start
                            AND sw.date::date         <= b.ep_end
  ),
  completed AS (
    SELECT wd.template_id, wd.pname, COUNT(DISTINCT wd.patient_id)::BIGINT AS completed_count
    FROM workout_data wd
    GROUP BY wd.template_id, wd.pname
  )
  SELECT
    t.template_id                                                             AS plan_template_id,
    t.pname                                                                   AS plan_name,
    ROUND(AVG(wd.eff) FILTER (WHERE wd.eff IS NOT NULL), 1)                  AS avg_effectiveness,
    ROUND(AVG(wd.enj) FILTER (WHERE wd.enj IS NOT NULL), 1)                  AS avg_enjoyment,
    NULL::NUMERIC                                                             AS avg_satisfaction,
    COUNT(*) FILTER (WHERE wd.eff IS NOT NULL OR wd.enj IS NOT NULL)         AS rating_count,
    COALESCE(c.completed_count, 0)                                           AS completed_count,
    t.total_count
  FROM totals t
  LEFT JOIN workout_data wd ON wd.template_id = t.template_id
  LEFT JOIN completed    c  ON  c.template_id = t.template_id
  GROUP BY t.template_id, t.pname, c.completed_count, t.total_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_featured_program_ratings(UUID) TO authenticated;