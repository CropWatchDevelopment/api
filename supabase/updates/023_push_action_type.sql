-- 023_push_action_type.sql
-- Registers the Push (FCM web push) alert action type.
--
-- APPLY LAST — only after the LavinMQ-to-Alert build containing
-- PushAlertActionHandler is deployed with a firebase config block. The rules
-- UI action dropdown is data-driven off this table, so inserting this row is
-- what makes the Push option appear (and what activates the default Push
-- action on newly created rules); a Push rule firing against an older alert
-- service falls back to the logging handler (logged, never crashes), but the
-- option should not be user-visible before the handler is live.
--
-- The name string 'Push' is load-bearing across repos: the alert service's
-- AlertActionRouter and the rules-form branch both match on it exactly.
-- ids are manually assigned in this table (2 = EMail, 3 = LoRaWAN, 4 = LINE).

insert into public.cw_rule_action_types (id, name)
values (5, 'Push')
on conflict (id) do nothing;

-- If a sequence is ever attached to cw_rule_action_types.id, bump it past
-- the manual ids: select setval(pg_get_serial_sequence('public.cw_rule_action_types', 'id'), 5, true);
