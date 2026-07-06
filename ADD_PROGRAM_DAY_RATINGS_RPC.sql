-- Run this in the Supabase SQL editor.
-- Returns per-day average ratings for all featured programs owned by the master account.
-- Joins synced_workouts.data->>'planDayId' back to the day label/position stored
-- inside plan_templates.exercises->'days' JSONB array.

CREATE OR REPLACE FUNCTION get_featured_program_day_ratings(p_practitioner_id UUID)
RETURNS TABLE(
  plan_name         TEXT,
  day_id            TEXT,
  day_label         TEXT,
  day_order         BIGINT,
  avg_effectiveness NUMERIC,
  avg_enjoyment     NUMERIC,
  rating_count      BIGINT
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
    pt.name::TEXT                                                          AS plan_name,
    (sw.data->>'planDayId')::TEXT                                         AS day_id,
    MAX(day_info.label)::TEXT                                             AS day_label,
    MAX(day_info.ord)                                                      AS day_order,
    ROUND(AVG(r.eff) FILTER (WHERE r.eff IS NOT NULL), 1)                AS avg_effectiveness,
    ROUND(AVG(r.enj) FILTER (WHERE r.enj IS NOT NULL), 1)                AS avg_enjoyment,
    COUNT(*) FILTER (WHERE r.eff IS NOT NULL OR r.enj IS NOT NULL)       AS rating_count
  FROM plan_templates pt
  JOIN employer_programs ep ON ep.plan_template_id = pt.id
  JOIN patient_links     pl ON pl.practitioner_id  = ep.employer_id
  JOIN workout_plans     wp ON wp.patient_id        = pl.patient_id
                            AND wp.name             = pt.name
                            AND wp.practitioner_id  = ep.employer_id
  JOIN synced_workouts   sw ON sw.user_id           = wp.patient_id
                            AND (sw.data->>'planId') = wp.id::text
  -- Lateral join to extract the day label and position from the JSONB days array
  LEFT JOIN LATERAL (
    SELECT (d->>'label') AS label, ord
    FROM jsonb_array_elements(pt.exercises->'days') WITH ORDINALITY AS t(d, ord)
    WHERE d->>'id' = sw.data->>'planDayId'
    LIMIT 1
  ) AS day_info ON true
  CROSS JOIN LATERAL (
    SELECT
      NULLIF(COALESCE(
        NULLIF((sw.data->>'effectivenessRating')::numeric, 0),
        NULLIF((sw.data->>'satisfactionRating')::numeric,  0)
      ), 0) AS eff,
      NULLIF((sw.data->>'enjoymentRating')::numeric, 0) AS enj
  ) AS r
  WHERE pt.practitioner_id = p_practitioner_id
    AND pt.is_featured      = true
    AND (sw.data->>'planDayId') IS NOT NULL
  GROUP BY pt.name, (sw.data->>'planDayId')
  HAVING COUNT(*) FILTER (WHERE r.eff IS NOT NULL OR r.enj IS NOT NULL) > 0
  ORDER BY pt.name, MAX(day_info.ord);
END;
$$;

GRANT EXECUTE ON FUNCTION get_featured_program_day_ratings(UUID) TO authenticated;
