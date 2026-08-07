-- RLS for the AI infrastructure tables (same pattern as 0002_rls.sql).
-- ai_prompts stays outside RLS: it is global product configuration, not tenant data.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_calls', 'ai_conversations', 'ai_embeddings']
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
--> statement-breakpoint
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_messages
  USING (EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id));
