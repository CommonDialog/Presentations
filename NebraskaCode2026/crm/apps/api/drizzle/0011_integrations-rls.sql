-- RLS for integration tables (same pattern as 0002_rls.sql).
-- api_keys is intentionally excluded: token lookup happens before the tenant
-- context exists (it is what establishes the tenant), so the table relies on
-- unique-hash lookup + org scoping in queries, like sessions.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integrations', 'webhooks', 'webhook_deliveries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (organization_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) '
      || 'WITH CHECK (organization_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END;
$$;
