ALTER TABLE household_preferences
  ADD COLUMN meal_slots_json TEXT NOT NULL DEFAULT '[{"id":"breakfast","label":"Breakfast"},{"id":"lunch","label":"Lunch"},{"id":"dinner","label":"Dinner"},{"id":"snack","label":"Snack"}]';
