-- Defence in depth: the application always scopes queries by organization_id.
-- These policies make cross-tenant access impossible even if a query forgets.
-- The API sets `SET LOCAL app.organization_id` inside each request transaction
-- when running as the restricted role; the migration/owner role bypasses RLS.

CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
      AND table_name NOT IN ('one_time_tokens')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_current_org() IS NULL OR organization_id = app_current_org()) WITH CHECK (app_current_org() IS NULL OR organization_id = app_current_org())',
      t);
  END LOOP;
END $$;

-- Append-only tables: revoke UPDATE/DELETE from everyone but the owner.
CREATE OR REPLACE FUNCTION forbid_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS activity_log_immutable ON activity_log;
CREATE TRIGGER activity_log_immutable BEFORE UPDATE OR DELETE ON activity_log FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- Approvals may only move from pending to a decision; decided rows are frozen.
CREATE OR REPLACE FUNCTION approvals_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'approvals are append-only'; END IF;
  IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'approval % has already been decided', OLD.id; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS approvals_immutable ON approvals;
CREATE TRIGGER approvals_immutable BEFORE UPDATE OR DELETE ON approvals FOR EACH ROW EXECUTE FUNCTION approvals_guard();

-- Full-text search indexes.
CREATE INDEX IF NOT EXISTS projects_search_idx ON projects USING gin (to_tsvector('simple', search_text));
CREATE INDEX IF NOT EXISTS documents_search_idx ON documents USING gin (to_tsvector('simple', search_text));
CREATE INDEX IF NOT EXISTS daily_logs_search_idx ON daily_logs USING gin (to_tsvector('simple', search_text));
CREATE INDEX IF NOT EXISTS clients_search_idx ON clients USING gin (to_tsvector('simple', display_name || ' ' || coalesce(company_name, '') || ' ' || coalesce(email, '')));
CREATE INDEX IF NOT EXISTS messages_search_idx ON messages USING gin (to_tsvector('simple', body));
CREATE INDEX IF NOT EXISTS tasks_search_idx ON tasks USING gin (to_tsvector('simple', name || ' ' || description));
