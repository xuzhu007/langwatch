# 自部署 fork 升级复盘与检查清单：3.21 到 3.23.0（Docker Compose）

本文记录 2026-11-09 第一次在生产 Docker Compose 环境把 fork 从 3.21 升级到 3.23.0 时遇到的问题、根因和处理方法，并整理成下次升级可以直接照做的检查清单。升级本身的镜像、迁移和回滚说明见 [fork-upgrade-3.23.0.md](fork-upgrade-3.23.0.md)；本文只补充那份手册没有覆盖、但实际发生过的情况。

文中的库名、schema、项目 id 等都用占位符表示，执行前替换成自己环境的值：

| 占位符                         | 含义                                                                  |
| ------------------------------ | --------------------------------------------------------------------- |
| `<schema>`                     | 业务 schema，即 `DATABASE_URL` 里 `schema=` 的值                      |
| `<schema>_upgrade_ledger`      | 升级账本 schema，由程序按业务 schema 加后缀 `_upgrade_ledger` 命名    |
| `<project_id>`、`<dataset_id>` | LangWatch 项目 id、数据集 id                                          |
| `langwatch_workers_1`          | docker-compose v1 的容器名示例，以 `docker-compose ps` 的实际输出为准 |

## 1 问题速览

| #   | 现象                                                                                                                                                                                                 | 根因                                                                                                                                                                                                                           | 处理                                                                                        | 预防                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | `pnpm task upgrade status` 和 worker 日志里大量 `[ioredis] Unhandled error event: Error: connect ETIMEDOUT`，同时有 `Transient ClickHouse query error, retrying`；app、workers 的 `/readyz` 都是 503 | **redis、clickhouse 容器没有运行**（推测是维护窗口备份时被停掉）。之后用 `up -d --no-deps ... app workers` 启动应用，`--no-deps` 不会带起依赖服务；手册里检查 Redis/CK 的 `docker compose ps` 在这台机器上不存在，这一步被跳过 | `docker-compose up -d redis clickhouse`，等两者 healthy 后 `docker-compose restart workers` | 启动应用前单独启动并确认 redis、clickhouse healthy（3.3） |
| 2   | `docker compose ...` 报 `unknown shorthand flag: 'q' in -q`                                                                                                                                          | 宿主机 Docker 是 20.10，没有 compose v2 插件，只有独立的 `docker-compose`（v1，容器名形如 `langwatch_workers_1`）                                                                                                              | 所有命令改用 `docker-compose`                                                               | 升级前先确认 compose 命令的形式（3.1）                    |
| 3   | 登录后打开数据集页面，`dataset.getAll` 返回 422                                                                                                                                                      | 3 个历史数据集的 `slug` 是空字符串。列表接口逐行用 schema 校验（`slug` 至少 1 个字符），一行不合格整个列表就报错                                                                                                               | 按名称补上 slug（5.1）                                                                      | 升级前执行数据检查 SQL（3.1）                             |
| 4   | 状态显示 `Needs attention`，`Failed steps: dataset:create-first-versions`                                                                                                                            | 同问题 3：这个后台步骤读取数据集时同样校验 slug，5 次自动重试用完后被标记为 failed                                                                                                                                             | 修好数据后执行一次 `pnpm task upgrade`，预检阶段会把 failed 的后台步骤重置为 pending        | 同问题 3；后台步骤失败后，重启 worker 不会重试（3.5）     |

## 2 时间线（UTC）

1. 维护窗口：停 app、workers 并备份，redis、clickhouse 在这期间也处于停止状态（推测是备份时停掉的）。DBA 执行 PG 结构变更和迁移登记。
2. 11:18 用新镜像以 `--no-deps` 启动 nlp、langevals、app、workers，redis、clickhouse 仍然是停止状态。
3. exec 进 workers 执行 `upgrade status`，报 Redis `connect ETIMEDOUT`。先后怀疑资源争抢和 DNS，都被排除（见第 6 节）。
4. `docker stats` 里看不到 redis、clickhouse，才发现它们没在运行。启动后 worker 在 11:52 重新执行升级，阻塞步骤完成，两个 `/readyz` 都变成 200。
5. 数据集页面报 422，定位到 3 个空 slug 的数据集，按名称补上 slug。
6. 12:07 `dataset:create-first-versions` 第 5 次自动重试失败，被标记为 failed，12:14 查状态时发现。12:18 执行一次 `pnpm task upgrade` 重试，结果为 `done 595`、`Up to date`。

## 3 下次升级检查清单

### 3.1 升级前（可以在维护窗口前完成）

1. 确认 compose 命令的形式。哪个能用就全程只用哪个，不要中途混用 v1 和 v2：两者生成的容器名不同，混用可能导致旧容器没被识别、继续运行。下文以 `docker-compose` 为例。

   ```bash
   docker-compose version
   ```

   ```bash
   docker compose version
   ```

2. 确认新镜像是 fork 构建。输出 ≥1 表示是 fork 镜像，0 表示是官方镜像：

   ```bash
   docker run --rm --entrypoint grep <新镜像> -c "fork 定制" /app/packages/clickhouse-migrations/migrations/00058_gateway_budget_scope_totals_utc.sql
   ```

3. 数据健康检查（DBA 执行，只读），要求返回 0 行。查出来的行先按 5.1 处理再继续升级。建议把这条并入 DBA 的执行前检查脚本：

   ```sql
   SELECT "projectId", id, name, slug, "archivedAt"
   FROM <schema>."Dataset"
   WHERE coalesce(slug, '') = '' OR coalesce(name, '') = '';
   ```

4. 记录当前所有容器的状态，作为恢复时的参照：

   ```bash
   docker-compose ps
   ```

### 3.2 维护窗口

- 按手册停掉 app、workers。确认 `docker-compose ps app workers` 都是 Exit 状态后，DBA 才开始执行 SQL。
- 如果备份时停了 redis、clickhouse，要在交接记录里写明，3.3 的第 1 步必须把它们启动回来。

### 3.3 启动新版本

1. 先启动基础服务，两个都显示 `Up (healthy)` 才能继续：

   ```bash
   docker-compose up -d redis clickhouse
   ```

   ```bash
   docker-compose ps redis clickhouse
   ```

2. 再启动应用：

   ```bash
   docker-compose up -d --no-deps langwatch_nlp langevals app workers
   ```

3. 在 workers 里确认到 Redis、CK 是通的，应输出 `redis-ok` 和 `Ok.`：

   ```bash
   docker-compose exec -T workers bash -c 'timeout 5 bash -c "</dev/tcp/redis/6379" && echo redis-ok; curl -sS -m 5 http://clickhouse:8123/ping'
   ```

### 3.4 观察与判定

1. 看 worker 日志里的升级进度：

   ```bash
   docker-compose logs --no-color --tail=500 workers | grep -iE "upgrade|migrat|goose|step|lease|blocking|ETIMEDOUT|error" | tail -80
   ```

2. 看就绪状态：

   ```bash
   docker-compose exec -T workers curl -sS -w ' HTTP %{http_code}\n' http://127.0.0.1:2999/readyz
   ```

   ```bash
   docker-compose exec -T app curl -sS -w ' HTTP %{http_code}\n' http://127.0.0.1:5560/readyz
   ```

3. 看升级状态。用一次性容器执行，不要 exec 进正在升级的 worker：一次性容器有自己的 cgroup，不会和 worker 抢资源。命令本身只读。

   ```bash
   docker-compose run --rm --no-deps -w /app/apps/tasks workers pnpm task upgrade status
   ```

   需要 JSON 输出时加 `--json`，再加上 `-e LOG_LEVEL=error -e PINO_LOG_LEVEL=error` 压掉启动日志。

判定标准：

| 状态                                                    | 含义                               | 能否开始业务验收                              |
| ------------------------------------------------------- | ---------------------------------- | --------------------------------------------- |
| `Up to date`，两个 readyz 都是 200                      | 升级完成                           | 可以                                          |
| `Finishing in background`，readyz 都是 200，没有 failed | 阻塞步骤已完成，后台回填还在进行   | 可以，记录后台步骤的进度                      |
| `Needs attention`，或者 failed 大于 0                   | 有步骤失败                         | 先按 3.5 处理                                 |
| readyz 返回 503                                         | 阻塞步骤还没完成，或者升级跑不下去 | 看 worker 日志，先排查 Redis、CK、PG 的连通性 |

在 3.23.0 上，`Image: Development build` 和 `Installed: no release recorded` 是预期的显示，见第 4 节。

### 3.5 后台步骤失败的处理

1. 找原因（DBA 执行，只读）：

   ```sql
   SELECT id, status, attempt, last_error, log_tail, updated_at
   FROM <schema>_upgrade_ledger._langwatch_upgrade_step
   WHERE status NOT IN ('done', 'not-needed');
   ```

   ```sql
   SELECT step_id, status, held_reason, count(*) AS tenants, max(updated_at) AS last_update
   FROM <schema>_upgrade_ledger._langwatch_upgrade_tenant_state
   GROUP BY step_id, status, held_reason
   ORDER BY step_id, status;
   ```

   同时在 worker 日志里搜索这个步骤的报错。例如数据集版本回填的 logger 名是 `langwatch:dataset:version-backfill`，失败日志是 `A dataset got no first version`：

   ```bash
   docker logs --since 2h langwatch_workers_1 2>&1 | grep "A dataset got no first version" | tail -10 | cut -c1-600
   ```

2. 修复原因。

3. 重试，二选一：执行下面的命令；或者用平台运维账号进入 **Ops > Upgrades** 页面，对该步骤点 Retry。命令的退出码：0 表示完成，1 表示失败，3 表示租约被占用（稍后再跑一次）。

   ```bash
   docker-compose run --rm --no-deps -w /app/apps/tasks workers pnpm task upgrade
   ```

注意：

- 后台步骤失败后，worker 会自动重试 5 次，间隔从 1 分钟起逐次翻倍，最长 15 分钟；用完后标记为 failed（`packages/upgrade/src/background/background-steps.service.ts`）。
- **重启 workers 不会重试后台步骤。** worker 启动时只检查阻塞步骤，阻塞步骤都完成了就不会再执行升级。只有 `pnpm task upgrade` 的预检阶段会把 failed 的后台步骤重置为 pending（`packages/upgrade/src/runner/upgrade-runner.ts` 的 `retryFailedBackgroundSteps`）。
- 重试会从断点继续，已经完成的部分会跳过。不要手工把步骤改成 done，也不要删除账本记录。

### 3.6 验收与恢复接入

- 业务验收项见内部实施文档第五节：历史 trace、上报新 trace、用内网模型执行一次评测、CSV 导出、批量标注、NOT 筛选等。
- 恢复业务 trace 接入之前，先等停机期间积压的事件消化完。下面第一条命令统计评测触发的重试次数分布，应集中在个位数并逐渐消失；第二条统计被跳过的评测，应为 0：

  ```bash
  docker logs --since 30m langwatch_workers_1 2>&1 | grep -oE "no folded summary yet \(attempt [0-9]+\)" | sort | uniq -c
  ```

  ```bash
  docker logs --since 30m langwatch_workers_1 2>&1 | grep -c "Skipping evaluation dispatch"
  ```

- 验收通过后，再恢复业务 trace 接入和定时评测。

## 4 状态和日志解读

| 输出                                                                               | 含义                                                                                                                                                                                                                                                                                                             | 是否需要处理                                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Image: Development build`、`Installed: no release recorded`                       | 镜像里有 3 个代码步骤（`agent:backfill-versions`、`evaluator:backfill-versions`、`dataset:create-first-versions`）没有登记在上游的 `packages/upgrade/releases/3.23.0.json` 里，程序因此把镜像判定为未发布版本（`packages/upgrade/src/gate/image-tree.ts` 的 `imageRelease`）。上游 3.23.0 的发布提交本身就是这样 | 不需要。只影响显示，升级按步骤 id 逐个记账                                                |
| `Trace has no folded summary yet (attempt N); retrying the evaluation trigger`     | 积压追赶时，trace 汇总投影落后于评测触发器；最多重试 13 次，大约 27 分钟                                                                                                                                                                                                                                         | attempt 小是正常的；出现 `Skipping evaluation dispatch` 说明对应 trace 的在线评测被跳过了 |
| `Event subscriber execution is slow`、`Failed event subscriber execution was slow` | 单次执行超过 5 秒的告警阈值（`SLOW_PROJECTION_OPERATION_MS`）                                                                                                                                                                                                                                                    | 积压高峰期出现是正常的；如果持续出现，用第 6 节的 CK 查询确认 CK 自身是否变慢             |
| `PINO_LOG_LEVEL is deprecated, use LOG_LEVEL`                                      | 日志级别变量改名了                                                                                                                                                                                                                                                                                               | 下次重建容器时，把 compose 里的 `PINO_LOG_LEVEL` 改成 `LOG_LEVEL`                         |
| `[ioredis] Unhandled error event`                                                  | tasks 入口自己建的 Redis 连接没有挂 logger，错误直接用 console 打印（`packages/redis-client/src/connection.ts`），不会导致进程崩溃                                                                                                                                                                               | 看错误本身                                                                                |
| CK 重试日志里的 `"retryError":{}`                                                  | `retryError` 字段没有注册日志序列化器，Error 被打印成了 `{}`（`packages/observability/src/logger.ts`）                                                                                                                                                                                                           | 真实原因要从其他日志或 CK 侧确认                                                          |
| `docker-compose logs` 不支持 `--since`                                             | v1 的限制                                                                                                                                                                                                                                                                                                        | 改用 `docker logs --since 30m <容器名>`                                                   |

## 5 数据修复参考

### 5.1 空 slug 的数据集

slug 的生成规则在 `modules/dataset/process/src/rules/dataset-selection.rules.ts` 的 `datasetSlugOf`：先做 NFKD 规范化，连续的非字母、非数字字符替换成 `-`，去掉首尾的 `-`，转小写；结果为空时用 `dataset`。中文属于字母会被保留，例如 `【全集】` 生成 `全集`。同一项目内 slug 唯一，重复时加后缀，例如 `全集-1`。3.21 和 3.23.0 都不会生成空 slug，这类数据来自更早的版本或者直接写库的脚本。

1. 确认新 slug 在项目内没被占用，应返回 0 行：

   ```sql
   SELECT id, slug, "archivedAt"
   FROM <schema>."Dataset"
   WHERE "projectId" = '<project_id>' AND slug = '<新 slug>';
   ```

2. 修复。带上 `slug = ''` 条件做保护，预期 `UPDATE 1`；不是的话执行 `ROLLBACK`：

   ```sql
   BEGIN;
   UPDATE <schema>."Dataset"
   SET slug = '<新 slug>'
   WHERE id = '<dataset_id>' AND "projectId" = '<project_id>' AND slug = '';
   COMMIT;
   ```

   数据集之间、实验和评测引用数据集都用 id；原来的 slug 是空的，也不可能被 SDK 或 URL 引用过，所以没有副作用。`updatedAt` 刻意保持不变。改完刷新页面即可，不需要重启服务。

3. 复查：重新执行 3.1 第 3 条的检查，应返回 0 行。版本回填完成后，可以确认这些数据集有了版本 1：

   ```sql
   SELECT "datasetId", version, trigger, "createdAt"
   FROM <schema>."DatasetVersion"
   WHERE "datasetId" IN ('<dataset_id_1>', '<dataset_id_2>');
   ```

### 5.2 列表接口返回 422 的通用排查方法

tRPC 接口返回 422 表示 `validation_error`：处理函数里抛出的 Zod 校验错误，会被统一转成 422（`packages/api/src/trpc/runtime.ts` 的 `handledErrors`）。如果请求参数很简单（比如只有 projectId），基本就是库里存的数据不符合 schema。下面这条 SQL 对照数据集的 schema（`modules/dataset/contract/src/dataset.ts`）一次检查名称、slug、状态和列定义：

```sql
SELECT d."projectId", d.id, d.name, d.slug, d.status, jsonb_typeof(d."columnTypes") AS column_types_kind
FROM <schema>."Dataset" d
WHERE d."archivedAt" IS NULL
  AND (
    coalesce(d.name, '') = ''
    OR coalesce(d.slug, '') = ''
    OR d.status NOT IN ('uploading', 'processing', 'ready', 'failed')
    OR jsonb_typeof(d."columnTypes") IS DISTINCT FROM 'array'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d."columnTypes") = 'array' THEN d."columnTypes" ELSE '[]'::jsonb END) c
      WHERE coalesce(c->>'name', '') = ''
         OR coalesce(c->>'type', '') NOT IN ('string','boolean','number','date','list','json','spans','rag_contexts','chat_messages','annotations','evaluations','image','file')
    )
  );
```

修复 `columnTypes` 时不要改列名：列名对应每条记录里的 key，只改列名会导致数据对不上。

## 6 本次排查中排除的方向

下次遇到同样的报错，可以少走这些弯路：

| 怀疑方向                                       | 排除依据                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 容器资源争抢（exec 进程和 worker 共用 cgroup） | `docker stats` 显示 workers 的 CPU 只有 0.13%，内存占用约 1.3G/6G                                             |
| 容器内 DNS 搜索域导致解析慢                    | 容器内 `/etc/resolv.conf` 已经是 `ndots:0`，`curl -w '%{time_namelookup}'` 测得解析时间约 0.5ms               |
| `REDIS_URL` 配置错误                           | 主机名 `redis` 与服务名一致，密码中的 `#` 已编码为 `%23`；而且认证错误报的是 NOAUTH/WRONGPASS，不会是连接超时 |
| CK 查询本身慢                                  | `system.query_log` 显示只有追积压的那一两分钟 p95 约 1 秒，之后 p95 在 80~150ms                               |

**经验：Redis 和 CK 同时超时，第一步先用 `docker stats` 或 `docker-compose ps` 看容器是否在运行。** 报的是 `ETIMEDOUT` 而不是"找不到主机"，推测是容器不存在时，Docker 内置 DNS 把名字转发给上游 DNS，解析耗时超过了 ioredis 10 秒的连接超时（这个超时把 DNS 解析时间也算在内）。

CK 查询耗时的检查方法：

```bash
docker-compose exec -T clickhouse sh -c 'clickhouse-client --password "$CLICKHOUSE_PASSWORD" -q "SELECT toStartOfMinute(event_time) AS m, count() AS q, round(avg(query_duration_ms)) AS avg_ms, quantile(0.95)(query_duration_ms) AS p95_ms FROM system.query_log WHERE event_time > now() - INTERVAL 20 MINUTE AND type = '"'"'QueryFinish'"'"' GROUP BY m ORDER BY m"'
```

## 7 遗留事项

- **代码缺陷未修复**：数据集列表在 `modules/dataset/process/src/repositories/prisma/prisma.dataset.repository.ts` 的 `findAll` 里逐行做 schema 校验，一行坏数据就会让整个列表返回 422，用户只能看到"未知错误"。可以改成跳过不合格的行并记录告警，需要单独排期。
- **并发参数未调整**：`GLOBAL_QUEUE_CONCURRENCY=300`、`LANGWATCH_DISPATCH_TENANT_CAP=0` 沿用了原值。在 3.23.0 里，前者是每个 worker 的并行组数（默认 100，吞吐上升时自动扩容，上限 1000，见 `packages/group-queue/src/groupQueue.ts`）；后者设为 0 会关闭每租户默认 50 的上限。Redis 只分配了 1 核，后续根据监控再评估。
- **日志变量**：compose 里的 `PINO_LOG_LEVEL` 改成 `LOG_LEVEL`。
- **内部实施文档需要同步修订**：
  1. 全文 `docker compose` 改成实际可用的命令形式；
  2. 启动应用前先启动并确认 redis、clickhouse healthy；
  3. 在执行前检查中加入空 slug、空 name 数据集的检查；
  4. 状态检查改用一次性容器，并写明第 3.4 节的判定标准；
  5. 在异常处理中写明后台步骤失败后的重试方法。
