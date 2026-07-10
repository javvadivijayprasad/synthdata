/**
 * synthdata-migrations.ts — schema for relational synthetic datasets.
 * Follows the data-gen-migrations.ts pattern. Register alongside it.
 */
import type Database from 'better-sqlite3';

export function runSynthdataMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS synthdata_datasets (
      id            TEXT PRIMARY KEY,               -- uuid
      user_id       TEXT NOT NULL,
      name          TEXT NOT NULL,
      ddl           TEXT NOT NULL,                  -- the CREATE TABLE input
      business_case TEXT,                           -- optional natural-language input
      plan_yaml     TEXT NOT NULL,                  -- the executed generation plan
      seed          INTEGER NOT NULL DEFAULT 42,
      mode          TEXT NOT NULL DEFAULT 'auto'    -- 'auto' | 'ai' | 'manual'
                    CHECK (mode IN ('auto','ai','manual')),
      tables_count  INTEGER NOT NULL,
      rows_count    INTEGER NOT NULL,
      file_path     TEXT,                           -- generated .db on disk
      status        TEXT NOT NULL DEFAULT 'complete'
                    CHECK (status IN ('complete','failed')),
      error         TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_synthdata_user ON synthdata_datasets(user_id, created_at DESC);
  `);
}
