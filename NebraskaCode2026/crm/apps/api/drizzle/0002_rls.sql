-- Row-level security: tenant isolation enforced in the database.
--
-- The app sets `app.org_id` per transaction (see src/lib/tenant.ts). FORCE makes
-- policies apply even to the table owner (crm_user), so no code path can skip them.
--
-- Deliberately NOT under RLS: organizations, users, sessions, permissions —
-- they are read before a tenant context exists (login, session resolution).
-- The service layer filters them by organization explicitly.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'roles',
    'accounts', 'contacts',
    'leads', 'pipelines', 'pipeline_stages', 'deals', 'deal_stage_history',
    'activities', 'tasks', 'projects', 'milestones',
    'documents', 'timeline_entries', 'custom_field_definitions',
    'ai_artifacts', 'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    -- NULLIF: outside a tenant transaction the GUC reads as '', which must mean
    -- "no tenant" (zero rows), not a uuid cast error.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (organization_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) '
      || 'WITH CHECK (organization_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END;
$$;
--> statement-breakpoint
-- Join tables have no organization_id; their policies delegate to the parent row,
-- whose own RLS policy supplies the tenant check (policy composition).
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON role_permissions
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id))
  WITH CHECK (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id));
--> statement-breakpoint
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON user_roles
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id))
  WITH CHECK (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id));
--> statement-breakpoint
ALTER TABLE deal_contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE deal_contacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON deal_contacts
  USING (EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_id))
  WITH CHECK (EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_id));
--> statement-breakpoint
ALTER TABLE activity_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON activity_links
  USING (EXISTS (SELECT 1 FROM activities a WHERE a.id = activity_id))
  WITH CHECK (EXISTS (SELECT 1 FROM activities a WHERE a.id = activity_id));
--> statement-breakpoint
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE task_dependencies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON task_dependencies
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id))
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id));
