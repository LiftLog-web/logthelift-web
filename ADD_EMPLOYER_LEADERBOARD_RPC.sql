-- Run this in the Supabase SQL editor.
-- Creates a SECURITY DEFINER function so employers can read employee workout
-- dates without hitting RLS restrictions on synced_workouts.
-- Counts ALL workouts from linked employees (any workout, not just plan-specific).

CREATE OR REPLACE FUNCTION get_employer_leaderboard_workouts(p_employer_id UUID)
RETURNS TABLE(user_id UUID, date TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT sw.user_id, sw.date
  FROM synced_workouts sw
  JOIN patient_links pl
    ON pl.patient_id = sw.user_id
    AND pl.practitioner_id = p_employer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_employer_leaderboard_workouts(UUID) TO authenticated;
