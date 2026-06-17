-- Feeding preferences and history stay private to the feeding plugin.
CREATE TABLE IF NOT EXISTS plugin_official_feeding_history (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  nutrition INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
