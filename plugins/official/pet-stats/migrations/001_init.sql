-- Plugin-owned data. The kernel records this migration under official.pet-stats.
CREATE TABLE IF NOT EXISTS plugin_official_pet_stats_state (
  actor_id TEXT PRIMARY KEY,
  mood INTEGER NOT NULL,
  hunger INTEGER NOT NULL,
  energy INTEGER NOT NULL,
  affinity INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
