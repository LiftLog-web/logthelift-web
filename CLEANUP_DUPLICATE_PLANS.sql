-- Step 1: Preview duplicates before deleting (run this first)
SELECT patient_id, name, COUNT(*) AS count
FROM workout_plans
GROUP BY patient_id, name
HAVING COUNT(*) > 1
ORDER BY count DESC;

-- Step 2: Delete duplicates, keeping the most recently created row
--         per (practitioner_id, patient_id, plan name).
--         Run only after confirming Step 1 output looks correct.
DELETE FROM workout_plans
WHERE id NOT IN (
  SELECT DISTINCT ON (practitioner_id, patient_id, name) id
  FROM workout_plans
  ORDER BY practitioner_id, patient_id, name, created_at DESC
);
