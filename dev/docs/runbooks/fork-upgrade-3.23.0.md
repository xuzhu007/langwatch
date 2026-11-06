# Self-hosted fork: 3.21.0 to 3.23.0

This upgrade starts from fork PR #62 (`6834a511ec95736168c95e922f1ba14995d59209`)
and imports upstream `langwatch@v3.23.0`. Use the fork image for both API and
workers. An official image does not include this installation's customisations
or its historic PostgreSQL migration names.

## Before the upgrade

- Back up PostgreSQL, ClickHouse, Redis and the configured dataset/object store.
  Keep the previous fork image and Compose configuration for rollback.
- Keep the existing database names, schemas, volumes and all encryption and
  authentication secrets, especially `CREDENTIALS_SECRET`.
- Mirror `langwatch/clickhouse-serverless:0.4.0` into the internal registry.
  It still uses ClickHouse `25.10.2.65`; the wrapper adds custom-setting support
  used by LangWatchQL. Retain the existing ClickHouse data volume.
- Keep PostgreSQL 16 and the current Redis deployment. This release adds no
  required database service or replacement data volume.
- Check that the configured dataset/object store is durable and writable.
  Dataset versions create snapshots in that store, so include it in backups
  and capacity planning.

### Filesystem object storage

Without an S3 bucket or an explicit backend, object storage defaults to files at
`/var/lib/langwatch/objects` (or `LANGWATCH_LOCAL_STORAGE_PATH`). API and worker
containers must see the same durable directory. The base Compose file does not
mount this directory; files in a container's writable layer disappear when that
container is replaced.

For filesystem installations, `infra/compose.local-storage.yml` adds a shared
named volume. Before enabling it, stop writes, export the existing object trees
from **both** old containers and copy them into the volume, preserving paths and
the `.digests` directory. Resolve conflicting paths before replacing either
container, keep the exports with the database backup, and verify existing
dataset content can be read. Do not mount an empty volume over existing files.
Keep the same storage configuration when rolling back.

```sh
docker compose --project-directory . -f infra/compose.yml \
  -f infra/compose.local-storage.yml up -d
```

Installations already using shared S3/MinIO or Azure storage keep that backend
and do not apply the filesystem override. Its explicit `file` setting would
otherwise change their destination.

## Image and configuration

The verification workflow packages `langwatch-3.23.0.tar.gz`, `SHA256SUMS` and
`SOURCE_COMMIT`. Check that the artifact comes from the reviewed PR commit and
that **both** the `main` upgrade and `empty` install jobs passed before use.
The image artifact alone is not proof of an existing-install upgrade.

```sh
sha256sum -c SHA256SUMS
docker load -i langwatch-3.23.0.tar.gz
```

Set `LANGWATCH_IMAGE` to the imported or internally retagged fork image and
`LANGWATCH_PULL_POLICY=never` for an imported image, or `always` for a registry
image. The Compose file applies the same image to `app` and `workers`.
Retain the existing environment file location and internal model endpoints.
The companion **Fork service images** workflow packages NLP and LangEvals with
the same source commit. Load their archives too, then set
`LANGWATCH_NLP_IMAGE=langwatch-fork-langwatch_nlp:3.23.0`,
`LANGEVALS_IMAGE=langwatch-fork-langevals:3.23.0`,
`LANGWATCH_NLP_PULL_POLICY=never` and `LANGEVALS_PULL_POLICY=never` (or retag and
push them into the internal registry). The fork NLP image is needed to retain
PR #62's `host:port` allowlist matching for internal HTTP workflow nodes.

For an isolated deployment, `LANGWATCH_CONNECT_DISABLED=true` disables the
LangWatch connection; `DISABLE_USAGE_STATS=true` alone does not disable every
connection or upgrade diagnostic.

## Historical trace imports

The fork applies the existing stale-event guard before evaluation summary reads.
Previously, a month-old span could be stored successfully while its evaluation
trigger retried for about 27 minutes because the summary's storage timestamp
fell outside the event-anchored lookup window. Historical events now complete
without dispatching evaluations; recent events still wait for their summary and
retain the bounded retry behavior. This changes no trace retention or storage.

## Migrations and readiness

There are 11 additional PostgreSQL schema migrations and ClickHouse migration
123 (`coding_agent_session_events.AiUnits`, default `0`). Existing PostgreSQL
migration paths and SQL contents are retained. Never edit migration checksums,
rename historic directories or reset the upgrade ledger to make an upgrade pass.

Workers run the upgrade under the existing migration lease. Start the API and
workers with the new image and watch both readiness and the upgrade ledger;
API liveness alone does not establish migration completion. Background steps
also populate agent/evaluator versions and initial dataset versions.

```sh
docker compose --project-directory . -f infra/compose.yml up -d
docker compose --project-directory . -f infra/compose.yml exec -w /app/apps/tasks app pnpm task upgrade status
```

Verify that there are no failed or blocked upgrade steps, then check trace
collection and retrieval, Analytics filters, CSV exports, annotations and an
evaluation using the internal model provider. A ClickHouse custom-setting probe
must succeed with the configured credentials:

```sql
SELECT 1 SETTINGS custom_api_key_hash = 'upgrade-probe';
```

Dashboard REST/SDK integrations need review: the new Dashboard API owns
`/api/v1/dashboards`; legacy reports use `/api/v1/analytics/reports`. This does
not change the trace ingestion endpoint. Version labels and dataset snapshots
are available after their background steps finish.

## Rollback

Restore the previous **fork** image for API and workers together. Keep the
expanded database schema; do not run destructive down migrations. The rehearsal
runs that actual fork base against the upgraded stores, then upgrades again.
If data restoration is needed, restore the stores as a consistent backup set.
