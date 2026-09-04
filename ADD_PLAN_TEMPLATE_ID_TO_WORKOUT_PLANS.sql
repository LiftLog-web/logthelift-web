-- Step 1: Add plan_template_id to workout_plans
-- Run this in the Supabase SQL editor.

ALTER TABLE public.workout_plans
ADD COLUMN IF NOT EXISTS plan_template_id UUID REFERENCES public.plan_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workout_plans_plan_template_id
  ON public.workout_plans (plan_template_id);

-- Step 2: Backfill existing employer-assigned rows.
-- Matches by name + employer, picks the most recently started employer_program
-- (most likely the one that was active when the plan was created).
-- Only backfills rows that have an end_date (practitioner-only plans have no end_date
-- and should not be linked to a featured template).
UPDATE public.workout_plans wp
SET plan_template_id = subq.template_id
FROM (
  SELECT DISTINCT ON (wp2.id)
    wp2.id                AS workout_plan_id,
    ep.plan_template_id   AS template_id
  FROM public.workout_plans wp2
  JOIN public.employer_programs ep ON ep.employer_id = wp2.practitioner_id
  JOIN public.plan_templates    pt ON pt.id          = ep.plan_template_id
                                   AND pt.name        = wp2.name
  WHERE wp2.plan_template_id IS NULL
    AND wp2.end_date IS NOT NULL
  ORDER BY wp2.id, ep.started_at DESC
) subq
WHERE wp.id = subq.workout_plan_id;

-- Step 3: Replace get_featured_program_ratings with a simpler version that
-- joins directly on plan_template_id — no date-window scoping needed.

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
      wp.patient_id,
      wp.id           AS workout_plan_id
    FROM plan_templates pt
    JOIN employer_programs ep ON ep.plan_template_id = pt.id
    JOIN patient_links     pl ON pl.practitioner_id  = ep.employer_id
    -- Direct join on plan_template_id — no name-based guessing, no date overlap
    JOIN workout_plans     wp ON wp.plan_template_id = pt.id
                              AND wp.patient_id      = pl.patient_id
                              AND wp.practitioner_id = ep.employer_id
    WHERE pt.practitioner_id = p_practitioner_id
      AND pt.is_featured      = true
  ),
  totals AS (
    SELECT b.template_id, b.pname, COUNT(DISTINCT b.patient_id)::BIGINT AS total_count
    FROM base b
    GROUP BY b.template_id, b.pname
  ),
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
    JOIN synced_workouts sw ON sw.user_id            = b.patient_id
                            AND (sw.data->>'planId') = b.workout_plan_id::text
  ),
  completed AS (
    SELECT wd.template_id, wd.pname, COUNT(DISTINCT wd.patient_id)::BIGINT AS completed_count
    FROM workout_data wd
    GROUP BY wd.template_id, wd.pname
  )
  SELECT
    t.template_id,
    t.pname,
    ROUND(AVG(wd.eff) FILTER (WHERE wd.eff IS NOT NULL), 1),
    ROUND(AVG(wd.enj) FILTER (WHERE wd.enj IS NOT NULL), 1),
    NULL::NUMERIC,
    COUNT(*) FILTER (WHERE wd.eff IS NOT NULL OR wd.enj IS NOT NULL),
    COALESCE(c.completed_count, 0),
    t.total_count
  FROM totals t
  LEFT JOIN workout_data wd ON wd.template_id = t.template_id
  LEFT JOIN completed    c  ON  c.template_id = t.template_id
  GROUP BY t.template_id, t.pname, c.completed_count, t.total_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_featured_program_ratings(UUID) TO authenticated;