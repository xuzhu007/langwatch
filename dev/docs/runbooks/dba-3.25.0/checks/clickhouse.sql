SELECT currentDatabase();

-- Run in each target database. Expect versions 124-131 and applied = 1 on every row.
SELECT version_id, argMax(is_applied, tstamp) AS applied
FROM goose_db_version
WHERE version_id BETWEEN 124 AND 131
GROUP BY version_id
ORDER BY version_id;

-- Check on each relevant replica. Completed mutations may age out of system.mutations.
SELECT mutation_id, create_time, is_done, parts_to_do, latest_fail_reason
FROM system.mutations
WHERE database = currentDatabase() AND table = 'trace_analytics'
  AND position(command, 'MATERIALIZE COLUMN MetadataOutputAction') > 0
ORDER BY create_time DESC;
