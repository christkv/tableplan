PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS saved_recipe_searches (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  ingredient TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  tag_match TEXT NOT NULL DEFAULT 'all' CHECK (tag_match IN ('all', 'any')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(household_id, name)
);

CREATE INDEX IF NOT EXISTS saved_recipe_searches_household_idx
  ON saved_recipe_searches(household_id, updated_at DESC);
