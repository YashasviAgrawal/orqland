-- Duplicate-request protection for state-changing calls (§9).
-- A client sends an `Idempotency-Key` header; a retried request with the same key
-- returns the stored response instead of executing twice.
CREATE TABLE idempotency_keys (
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  key           text NOT NULL,
  user_id       text NOT NULL,
  endpoint      text NOT NULL,
  response      jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys(created_at);
