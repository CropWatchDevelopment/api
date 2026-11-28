-- =============================================================================
-- 043_rule_switch_action_types.sql
-- =============================================================================
-- The three rule-switch action types. RUN THIS ONE LAST: only after the alert
-- service, the API and the app that understand them are live.
--
--   RuleActivate        "Activate another rule"    config.targetTemplateId
--   RuleDeactivate      "Deactivate another rule"  config.targetTemplateId
--   RuleDeactivateSelf  "Deactivate THIS rule"     (pauses the whole rule)
--
-- Why last:
--   * the app that is live before this release lists every action type by its
--     raw name, so these would show up in its action dropdown;
--   * the alert service before this release has no handler for them (it would
--     log "no handler" and skip the action);
--   * 042's tick matches the names case-insensitively, so until this file runs
--     no rule can carry a switch action and nothing changes.
-- Names are matched, never ids: the ids are whatever the sequence gives.
-- Re-runnable: a name that exists (any letter case) is not inserted again.
--
-- The id sequence is moved past the highest id first. On prod (2026-11-27) it
-- stood at 3 while the rows are 2, 3, 4, 5 (LINE and Push were inserted with
-- explicit ids), so the next insert would have failed on a duplicate key.
--
-- PREFLIGHT (read-only): expect EMail, LINE, LoRaWAN, Push and none of the three.
-- SELECT id, name FROM cw_rule_action_types ORDER BY id;
-- SELECT last_value FROM public.cw_rule_action_types_id_seq;
-- =============================================================================

BEGIN;

SELECT setval(pg_get_serial_sequence('public.cw_rule_action_types', 'id'),
              (SELECT COALESCE(max(id), 1) FROM public.cw_rule_action_types));

INSERT INTO public.cw_rule_action_types (name)
SELECT v.name
  FROM (VALUES (1, 'RuleActivate'), (2, 'RuleDeactivate'), (3, 'RuleDeactivateSelf')) AS v(ord, name)
 WHERE NOT EXISTS (
         SELECT 1 FROM public.cw_rule_action_types t WHERE lower(t.name) = lower(v.name))
 ORDER BY v.ord;

COMMIT;

-- OPS (read-only): the three rows, once each.
-- SELECT id, name FROM cw_rule_action_types WHERE lower(name) LIKE 'rule%' ORDER BY id;
--
-- ROLLBACK: only while no rule uses them.
-- DELETE FROM cw_rule_action_types t
--  WHERE lower(t.name) IN ('ruleactivate', 'ruledeactivate', 'ruledeactivateself')
--    AND NOT EXISTS (SELECT 1 FROM cw_rule_template_actions a WHERE a.action_type = t.id);
