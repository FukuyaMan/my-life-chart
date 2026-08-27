-- Migration: Create shares table
-- Holds shortened URL data for My Life Chart

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  document_json TEXT NOT NULL,
  delete_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
