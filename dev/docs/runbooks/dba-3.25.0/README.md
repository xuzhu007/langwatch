# LangWatch 3.23.0 → 3.25.0 DBA 交接

适用于内网 Docker Compose 部署，运行账号无 PostgreSQL DDL 权限。交接包以 3.23.0 fork `d71a11654b7316f68fadae742472808bc15dc972` 为基线，以 PR #69 候选镜像的源码 `96d896af5ac34eb7ef23458cf84dc1a884fb7829` 为目标。沿用生产 PostgreSQL、Redis 和 ClickHouse 引擎。请在恢复的生产备份上原样演练后再切换。

## 1. 核对交接包和目标库

- 在 ZIP 解压目录执行 `sha256sum -c SHA256SUMS`。核对 `BASE_COMMIT` 与生产镜像实际基线，并确认 `SOURCE_COMMIT` 对应已审阅的候选镜像构建源码。
- 应用可直接升到 3.25.0。迁移顺序是 3.24.0 的 31 个 PostgreSQL 迁移、8 个 ClickHouse Goose 迁移（`00124`–`00131`）、3.25.0 的 2 个 PostgreSQL 迁移。SQL 保留源码路径和原始内容。部署前确认 PostgreSQL 实际数据库和业务 schema，ClickHouse 共享库、各私有路由、复制拓扑与存储策略，以及 Redis 地址。核对现有 `_prisma_migrations`、`goose_db_version` 和真实对象，遇到历史缺失、失败记录或编号冲突先在恢复副本处理。[执行清单](EXECUTION-ORDER.tsv)
- 暂停写入、排空或按演练方案保存积压、停掉旧 app 和 workers，冻结旧服务的自动重启。保留 PostgreSQL（含迁移历史及升级账本）、所有 ClickHouse 库、Redis、对象存储的同一时点备份，以及回滚所需的镜像和配置。准备临时迁移身份，确认有目标对象所有权或等效的角色成员权限。首次运行需要创建 `<业务 schema>_upgrade_ledger`，如不授予数据库级 `CREATE`，由 DBA 预建并归迁移角色所有。

## 2. 可选的 DBA 预执行 SQL

通常直接运行第 3 步，由候选镜像按发布顺序处理 Prisma 和 Goose。需要 DBA 在数据库侧先执行 PostgreSQL SQL 时，用清单中原始文件及顺序，连接实际业务 schema，逐个核对执行结果与已有迁移记录。仅对已完整执行且尚未登记的迁移，用同一候选镜像、同一库和 schema 的临时迁移账号，在 `/app/apps/tasks` 下运行 `pnpm exec prisma migrate resolve --applied <完整迁移目录名>`。部分执行失败时先核对已经生效的语句和失败原因，再决定完成余下语句或修复后用 `resolve --rolled-back` 登记该失败记录以供重试。保留历史记录，通过 Prisma 登记。

ClickHouse SQL 含 Goose 的 `Up`、`Down`、`StatementBegin` 和 `ENVSUB` 指令。使用候选镜像内的 Goose 与迁移入口，按实际目标库解析 `${CLICKHOUSE_DATABASE}`、`${CLICKHOUSE_STORAGE_POLICY_SETTING}` 和复制相关设置。`Up` 用于升级，迁移版本由 Goose 记录。禁止把整个文件直接送到 `clickhouse-client`，也禁止手写 `goose_db_version`。

`20261113180003_braids_grant_replaced_lookup` 在 `Grant` 上创建 `replacesGrantId IS NOT NULL` 的部分索引。普通建索引持有 `SHARE` 锁，表可读但写操作需等候。若线上写入不可长时间等待，可在 `20261112120000_braids_grant_replaces_grant_id` 创建 `replacesGrantId` 后，按索引迁移注释在事务外用 `CREATE INDEX CONCURRENTLY` 预建，并核对定义及 `pg_index.indisvalid`。按 DBA 流程清理失败后遗留的失效索引再重试。[新增列 SQL](https://github.com/xuzhu007/langwatch/blob/96d896af5ac34eb7ef23458cf84dc1a884fb7829/packages/prisma-client/prisma/migrations/20261112120000_braids_grant_replaces_grant_id/migration.sql) · [索引 SQL](https://github.com/xuzhu007/langwatch/blob/96d896af5ac34eb7ef23458cf84dc1a884fb7829/packages/prisma-client/prisma/migrations/20261113180003_braids_grant_replaced_lookup/migration.sql)

`00126` 以一次异步 mutation 物化 `trace_analytics` 的 9 个历史 metadata 列，旧数据 part 会重写一次。按历史数据体量预留磁盘空间和 I/O 预算，在低峰观察各副本 `system.mutations`、磁盘和查询延迟。[物化 SQL](https://github.com/xuzhu007/langwatch/blob/96d896af5ac34eb7ef23458cf84dc1a884fb7829/packages/clickhouse-migrations/migrations/00126_trace_analytics_metadata_columns.sql#L82-L97)

## 3. 由 DBA 运行完整升级

保持 app、workers 停止。启动所依赖的 PostgreSQL、ClickHouse、Redis 或确认外部服务可达。使用本次候选镜像及实际生产的 Compose 项目、配置文件和路由。由 DBA 在受控终端安全注入临时 PostgreSQL `DATABASE_URL`，包含正确的 `?schema=...`。从安全配置提供 ClickHouse 和 Redis 凭据。共享和私有 ClickHouse 路由须指向实际库，并在此任务中具备迁移权限。仅将临时凭据传给一次性任务。

以下 Bash 命令使用已配置的 Compose 命令数组 `compose`。`DBA_DATABASE_URL` 从安全渠道提供，避免在命令历史、日志或发布配置中记录凭据。

```bash
(
  export DATABASE_URL="${DBA_DATABASE_URL:?missing temporary migration URL}"
  "${compose[@]}" run --rm --no-deps -w /app/apps/tasks -e DATABASE_URL \
    workers pnpm task upgrade
)
```

任务除 Prisma 和 Goose 外，还会为实际 schema 建立或更新升级账本、登记步骤、按镜像执行阻塞代码及协调 ClickHouse TTL。启用 LWQL 时，还可能按部署配置协调 PostgreSQL 角色和视图及 ClickHouse 访问对象。这些动态 DDL 依赖目标环境，静态迁移文件不包含它们。即使预执行过静态 SQL，仍在独立迁移身份下完成此任务，保留输出并检查退出码。`0` 表示任务完成，`1` 表示失败，`3` 表示未取得升级租约。排查后用同一候选镜像和同一目标库重试，避免并行升级和手工修改应用账本。

如果 DBA 只允许执行预先审核的固定 SQL，维持 3.23.0。先在恢复副本审阅动态操作，获批并完成完整升级演练后再启动 3.25.0。[升级账本 DDL](https://github.com/xuzhu007/langwatch/blob/96d896af5ac34eb7ef23458cf84dc1a884fb7829/packages/upgrade/src/ledger-tables.ts#L81-L157) · [ClickHouse TTL 协调](https://github.com/xuzhu007/langwatch/blob/96d896af5ac34eb7ef23458cf84dc1a884fb7829/packages/upgrade/src/runner/image-upgrade.ts#L399-L416)

## 4. 验收和权限交回

1. 用实际业务 schema 作为 PostgreSQL `search_path` 执行只读检查，33 项应全部 `applied=true` 且 `unfinished=false`。在每个相关 ClickHouse 目标库执行检查，124–131 均已应用。查看相关副本 `system.mutations`，跟踪 `00126` 的物化及失败信息。已完成的记录可能被清理。[PostgreSQL 验收 SQL](checks/postgresql.sql) · [ClickHouse 验收 SQL](checks/clickhouse.sql)
2. 撤下临时凭据，确认 app 和 workers 使用普通运行账号。运行账号需要业务对象的读写权限及相应序列权限，能查询 `_prisma_migrations`，并能查询及更新升级账本和实例登记。用普通账号在候选镜像执行 `pnpm task upgrade status --json`。确认阻塞步骤已满足、无失败项、所有已配置的 ClickHouse 目标均已就绪，再启动服务。3.25.0 worker 在账本落后时会尝试自动升级，旧版 `SKIP_PRISMA_MIGRATE` 和 `SKIP_CLICKHOUSE_MIGRATE` 对它无效。私有 ClickHouse 目标未就绪时，常驻 worker 也会重试完整升级。
3. 可选的 LangWatchQL 需要 ClickHouse 26.8 或更新版本。Compose 常驻进程若不使用 LWQL，检查有效配置未注入 `LWQL_CLICKHOUSE_PASSWORD` 和 `LWQL_POSTGRES_READER_PASSWORD`。若使用 LWQL，DBA 与部署方明确持续协调所需授权并验收其运行方式。即使设置 `SKIP_LWQL_PROVISION` 跳过一次性任务中的 LWQL 配置，配置了相应凭据的 worker 仍会周期检查与修复漂移。ClickHouse 的后台索引物化和保留期操作还可能使用 `ALTER TABLE`，单独验证运行账号所需的 ClickHouse 权限。[LWQL 版本要求](https://github.com/xuzhu007/langwatch/blob/96d896af5ac34eb7ef23458cf84dc1a884fb7829/docs/self-hosting/deployment/kubernetes-helm.mdx#L500-L507) · [周期任务](https://github.com/xuzhu007/langwatch/blob/96d896af5ac34eb7ef23458cf84dc1a884fb7829/modules/analytics/process/src/eventing/analytics-lwql-reconvergence.pipeline.ts#L62-L82)
4. 确认 app `/readyz`（5560）和 workers `/readyz`（2999）均返回 HTTP 200。检查升级账本、历史查询、新增 trace、评测及队列。后台回填由常驻 worker 执行，确认相关步骤完成和数据对账后再恢复依赖历史报表的流量。保留 3.23 回滚期间维持 Braids 组织开关关闭。

## 5. 回滚和再升级

在恢复副本演练旧镜像读取扩展后 schema，同时验证回滚期间产生的新写入可在再升级后读出。应用回滚时恢复 3.23.0 app、workers、NLP、LangEvals 镜像及它们的配置，保留扩展后的 schema、迁移历史与升级账本。旧镜像若自身会自动迁移，沿用已演练的旧版开关和权限控制。若实际回滚镜像早于实例登记机制，在再次升 3.25.0 前由 DBA 从候选镜像运行 `pnpm task upgrade pre-roster-rollback` 以重新开放相关后台步骤。确需恢复数据时，使用同一备份时点恢复 PostgreSQL、ClickHouse、Redis 和对象存储，并核对备份后的补传范围。
