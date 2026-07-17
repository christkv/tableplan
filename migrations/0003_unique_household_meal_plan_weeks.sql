PRAGMA foreign_keys = ON;

-- Preserve every planned item by moving it to one deterministic plan per week.
UPDATE meal_plan_items
SET meal_plan_id = (
  SELECT MIN(canonical.id)
  FROM meal_plans current_plan
  JOIN meal_plans canonical
    ON canonical.household_id = current_plan.household_id
    AND canonical.starts_on = current_plan.starts_on
    AND canonical.ends_on = current_plan.ends_on
  WHERE current_plan.id = meal_plan_items.meal_plan_id
)
WHERE meal_plan_id IN (
  SELECT duplicate.id
  FROM meal_plans duplicate
  WHERE duplicate.id <> (
    SELECT MIN(canonical.id)
    FROM meal_plans canonical
    WHERE canonical.household_id = duplicate.household_id
      AND canonical.starts_on = duplicate.starts_on
      AND canonical.ends_on = duplicate.ends_on
  )
);

DELETE FROM meal_plans
WHERE id <> (
  SELECT MIN(canonical.id)
  FROM meal_plans canonical
  WHERE canonical.household_id = meal_plans.household_id
    AND canonical.starts_on = meal_plans.starts_on
    AND canonical.ends_on = meal_plans.ends_on
);

CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_household_week_unique
  ON meal_plans(household_id, starts_on, ends_on);
