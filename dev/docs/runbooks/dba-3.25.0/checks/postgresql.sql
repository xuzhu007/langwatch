SELECT current_database(), current_schema();

-- Expect 33 rows with applied = true and unfinished = false, in the application schema.
WITH expected(name) AS (
  VALUES
    ('20261104120000_nurturing_organization_last_trace_at'),
    ('20261104120100_nurturing_organization_coding_first_days'),
    ('20261104120101_nurturing_organization_coding_terminal_and_repositories'),
    ('20261106120000_billing_license_renewal_claim'),
    ('20261106120001_organization_seat_requests'),
    ('20261106120002_organization_seat_lease'),
    ('20261107120000_seat_request_seat_pending'),
    ('20261107130000_billing_subscription_seats_kept'),
    ('20261107130100_organization_seat_holds'),
    ('20261107130200_billing_subscription_seat_line_quantity'),
    ('20261108120000_user_erasure'),
    ('20261112120000_braids_grant_replaces_grant_id'),
    ('20261112170000_nurturing_project_usage_view'),
    ('20261112170100_nurturing_project_trace_day'),
    ('20261112170200_nurturing_personal_and_traced_projects'),
    ('20261112170300_nurturing_organization_created'),
    ('20261112170400_nurturing_organization_member'),
    ('20261112170500_nurturing_uncopied_project'),
    ('20261112170600_nurturing_organization_created_created_at_idx'),
    ('20261112170601_organization_seat_peak'),
    ('20261113120000_subscription_max_members_developer'),
    ('20261113180001_braids_authz_organization_policy'),
    ('20261113180002_braids_signing_keys'),
    ('20261113180003_braids_grant_replaced_lookup'),
    ('20261113200000_licence_developer_seats'),
    ('20261113200001_governance_agent_registry'),
    ('20261113200002_organization_docs_playground_sessions'),
    ('20261113200003_billing_subscription_payment_recovery'),
    ('20261113200004_billing_subscription_over_plan'),
    ('20261117100000_scenario_red_team_kind'),
    ('20261117100001_simulation_suite_template'),
    ('20261118120000_braids_authz_braid_write'),
    ('20261118140000_braids_authz_organization_enabled')
)
SELECT e.name,
       coalesce(bool_or(m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL), false) AS applied,
       coalesce(bool_or(m.id IS NOT NULL AND m.finished_at IS NULL AND m.rolled_back_at IS NULL), false) AS unfinished
FROM expected e
LEFT JOIN "_prisma_migrations" m ON m.migration_name = e.name
GROUP BY e.name
ORDER BY e.name;
