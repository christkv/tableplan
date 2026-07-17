ALTER TABLE recipes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'catalog'
  CHECK (visibility IN ('catalog', 'user_private', 'household'));
ALTER TABLE recipes ADD COLUMN owner_user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE;
ALTER TABLE recipes ADD COLUMN owner_household_id TEXT REFERENCES households(id) ON DELETE CASCADE;
ALTER TABLE recipes ADD COLUMN created_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE recipes ADD COLUMN origin TEXT NOT NULL DEFAULT 'dataset'
  CHECK (origin IN ('dataset', 'manual', 'paste', 'upload'));
ALTER TABLE recipes ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));

CREATE INDEX IF NOT EXISTS recipes_visibility_idx ON recipes(visibility, status, name);
CREATE INDEX IF NOT EXISTS recipes_owner_user_idx ON recipes(owner_user_id, status, name);
CREATE INDEX IF NOT EXISTS recipes_owner_household_idx ON recipes(owner_household_id, status, name);

ALTER TABLE saved_recipe_searches ADD COLUMN scope TEXT NOT NULL DEFAULT 'all'
  CHECK (scope IN ('all', 'catalog', 'mine', 'household'));

CREATE TABLE IF NOT EXISTS recipe_ingestions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  input_kind TEXT NOT NULL CHECK (input_kind IN ('text', 'image', 'document')),
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'paste', 'upload')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'extracting', 'review_ready', 'publishing', 'published', 'failed', 'cancelled')),
  filename TEXT,
  media_type TEXT,
  source_artifact_id TEXT,
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  progress_message TEXT NOT NULL DEFAULT 'Queued',
  error_code TEXT,
  error_message TEXT,
  extraction_provider TEXT,
  extraction_model TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS recipe_ingestions_user_idx ON recipe_ingestions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recipe_ingestions_household_idx ON recipe_ingestions(household_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recipe_source_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  ingestion_id TEXT NOT NULL UNIQUE REFERENCES recipe_ingestions(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipe_ingestion_drafts (
  ingestion_id TEXT PRIMARY KEY NOT NULL REFERENCES recipe_ingestions(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  servings REAL,
  serving_size TEXT,
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  steps_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  raw_extraction_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipe_ingestion_ingredient_reviews (
  ingestion_id TEXT NOT NULL REFERENCES recipe_ingestions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  raw_line TEXT NOT NULL,
  parsed_name TEXT NOT NULL,
  ingredient_id TEXT REFERENCES ingredients(id) ON DELETE SET NULL,
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('mapped', 'unmapped', 'confirmed')),
  mapping_confidence REAL NOT NULL DEFAULT 0 CHECK (mapping_confidence >= 0 AND mapping_confidence <= 1),
  remember_alias INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ingestion_id, position)
);

CREATE TABLE IF NOT EXISTS household_ingredient_aliases (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  alias TEXT NOT NULL COLLATE NOCASE,
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (household_id, alias)
);
CREATE INDEX IF NOT EXISTS household_ingredient_aliases_ingredient_idx
  ON household_ingredient_aliases(household_id, ingredient_id);

CREATE TABLE IF NOT EXISTS recipe_mutation_events (
  id TEXT PRIMARY KEY NOT NULL,
  recipe_id TEXT REFERENCES recipes(id) ON DELETE CASCADE,
  ingestion_id TEXT REFERENCES recipe_ingestions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'updated', 'shared', 'archived')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS recipe_mutation_events_recipe_idx ON recipe_mutation_events(recipe_id, created_at DESC);
