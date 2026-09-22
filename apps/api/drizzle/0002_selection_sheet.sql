-- Standard selections sheet: template items, tick-all-that-apply areas, default specs, and client sign-off.
ALTER TABLE selections ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE selections ADD COLUMN IF NOT EXISTS template_key text;
ALTER TABLE selections ADD COLUMN IF NOT EXISTS areas jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE selections ADD COLUMN IF NOT EXISTS chosen_areas jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE selections ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE selections ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE selections ADD COLUMN IF NOT EXISTS match_existing boolean NOT NULL DEFAULT false;
ALTER TABLE selections ADD COLUMN IF NOT EXISTS comment text NOT NULL DEFAULT '';
ALTER TABLE selections ADD COLUMN IF NOT EXISTS default_spec text NOT NULL DEFAULT '';
ALTER TABLE selections ADD COLUMN IF NOT EXISTS by_allowance boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS selections_project_template_idx ON selections (project_id, template_key);

CREATE TABLE IF NOT EXISTS selection_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  signer_name text NOT NULL,
  signature_text text,
  note text NOT NULL DEFAULT '',
  signed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  signed_by_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  decided_count integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS selection_signoffs_project_idx ON selection_signoffs (project_id, signed_at);
ALTER TABLE selection_signoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON selection_signoffs;
CREATE POLICY tenant_isolation ON selection_signoffs USING (app_current_org() IS NULL OR organization_id = app_current_org()) WITH CHECK (app_current_org() IS NULL OR organization_id = app_current_org());
-- A signed sheet is a record: never edited or removed.
DROP TRIGGER IF EXISTS selection_signoffs_immutable ON selection_signoffs;
CREATE TRIGGER selection_signoffs_immutable BEFORE UPDATE OR DELETE ON selection_signoffs FOR EACH ROW EXECUTE FUNCTION forbid_modification();
