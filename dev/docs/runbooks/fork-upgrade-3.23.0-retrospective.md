# 自部署 fork 升级复盘与检查清单：3.21 到 3.23.0（Docker Compose）

本文记录 2026-11-09 第一次在生产 Docker Compose 环境把 fork 从 3.21 升级到 3.23.0 时遇到的问题，以及升级后两天内暴露出来的问题，包括根因和处理方法，并整理成下次升级可以直接照做的检查清单。升级本身的镜像、迁移和回滚说明见 [fork-upgrade-3.23.0.md](fork-upgrade-3.23.0.md)；本文只补充那份手册没有覆盖、但实际发生过的情况。

文中的库名、schema、项目 id 等都用占位符表示，执行前替换成自己环境的值：

| 占位符                         | 含义                                                                  |
| ------------------------------ | --------------------------------------------------------------------- |
| `<schema>`                     | 业务 schema，即 `DATABASE_URL` 里 `schema=` 的值                      |
| `<schema>_upgrade_ledger`      | 升级账本 schema，由程序按业务 schema 加后缀 `_upgrade_ledger` 命名    |
| `<project_id>`、`<dataset_id>` | LangWatch 项目 id、数据集 id                                          |
| `<trace_id>`                   | 打开时报错的那条 trace 的 id，可以从报错请求的 URL 参数里取到         |
| `langwatch_workers_1`          | docker-compose v1 的容器名示例，以 `docker-compose ps` 的实际输出为准 |

## 1 问题速览

| #   | 现象                                                                                                                                                                                                                                                                         | 根因                                                                                                                                                                                                                                                                                        | 处理                                                                                        | 预防                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | `pnpm task upgrade status` 和 worker 日志里大量 `[ioredis] Unhandled error event: Error: connect ETIMEDOUT`，同时有 `Transient ClickHouse query error, retrying`；app、workers 的 `/readyz` 都是 503                                                                         | **redis、clickhouse 容器没有运行**（推测是维护窗口备份时被停掉）。之后用 `up -d --no-deps ... app workers` 启动应用，`--no-deps` 不会带起依赖服务；手册里检查 Redis/CK 的 `docker compose ps` 在这台机器上不存在，这一步被跳过                                                              | `docker-compose up -d redis clickhouse`，等两者 healthy 后 `docker-compose restart workers` | 启动应用前单独启动并确认 redis、clickhouse healthy（3.3）        |
| 2   | `docker compose ...` 报 `unknown shorthand flag: 'q' in -q`                                                                                                                                                                                                                  | 宿主机 Docker 是 20.10，没有 compose v2 插件，只有独立的 `docker-compose`（v1，容器名形如 `langwatch_workers_1`）                                                                                                                                                                           | 所有命令改用 `docker-compose`                                                               | 升级前先确认 compose 命令的形式（3.1）                           |
| 3   | 登录后打开数据集页面，`dataset.getAll` 返回 422                                                                                                                                                                                                                              | 3 个历史数据集的 `slug` 是空字符串。列表接口逐行用 schema 校验（`slug` 至少 1 个字符），一行不合格整个列表就报错                                                                                                                                                                            | 按名称补上 slug（5.1）                                                                      | 升级前执行数据检查 SQL（3.1）                                    |
| 4   | 状态显示 `Needs attention`，`Failed steps: dataset:create-first-versions`                                                                                                                                                                                                    | 同问题 3：这个后台步骤读取数据集时同样校验 slug，5 次自动重试用完后被标记为 failed                                                                                                                                                                                                          | 修好数据后执行一次 `pnpm task upgrade`，预检阶段会把 failed 的后台步骤重置为 pending        | 同问题 3；后台步骤失败后，重启 worker 不会重试（3.5）            |
| 5   | 升级后，部分旧 trace 从首页搜索打开时，`traces.header` 返回 500；app 日志是 `Failed to get trace summary from ClickHouse`，CK 报 `Code: 173 ... Amount of memory requested to allocate is more than allowed: (while reading column UnpricedModels) ... max_rows_to_read = 1` | **ClickHouse 25.10 延迟物化（lazy materialization）的缺陷**。`ORDER BY ... LIMIT 1` 的单行读取，碰到分片里缺失的 Array 列时，没有按 DEFAULT 补值，而是读到了垃圾长度。迁移 00109 之前写入的旧分片里没有 `UnpricedModels` 这一列                                                             | 在 CK 的 `users.d` 里加配置文件，关闭延迟物化（第 7 节）                                    | 升级前确认这个配置文件在位（3.1）；升级后抽查一条旧 trace（3.4） |
| 6   | 评估器的 Max Tokens 最大只能调到 4096，报 `The evaluator prompt takes 4671 tokens, which leaves no room for the content within the maximum of 4096 tokens`；在模型供应商里编辑自定义模型、改了 Max Tokens 再保存，值没有变化                                                 | 自定义模型没有登记 Max Tokens，滑块只能用默认上限 4096。编辑对话框的 Save 同时提交了外层的供应商表单（React 的 submit 事件会穿过 portal 冒泡），外层用编辑前的列表先保存并关闭了抽屉，新值没有发出去。修好这一处后，服务端的 tRPC 传输层又只保留 id 和名称，保存和返回时都丢掉了 Max Tokens | 部署包含修复的镜像后在界面上重新编辑（9.3、9.4）                                            | 升级后在界面上改一次自定义模型并核对接口响应（9.5）              |

## 2 时间线（UTC）

1. 维护窗口：停 app、workers 并备份，redis、clickhouse 在这期间也处于停止状态（推测是备份时停掉的）。DBA 执行 PG 结构变更和迁移登记。
2. 11:18 用新镜像以 `--no-deps` 启动 nlp、langevals、app、workers，redis、clickhouse 仍然是停止状态。
3. exec 进 workers 执行 `upgrade status`，报 Redis `connect ETIMEDOUT`。先后怀疑资源争抢和 DNS，都被排除（见第 6 节）。
4. `docker stats` 里看不到 redis、clickhouse，才发现它们没在运行。启动后 worker 在 11:52 重新执行升级，阻塞步骤完成，两个 `/readyz` 都变成 200。
5. 数据集页面报 422，定位到 3 个空 slug 的数据集，按名称补上 slug。
6. 12:07 `dataset:create-first-versions` 第 5 次自动重试失败，被标记为 failed，12:14 查状态时发现。12:18 执行一次 `pnpm task upgrade` 重试，结果为 `done 595`、`Up to date`。
7. 11-11 01:53 起，部分 10 月底的 trace 打开时报 500。按日志定位到 CK 的 Code 173，再用"开、关延迟物化各跑一次同一条查询"的对比确认了根因。02:00 前后在 `users.d` 加配置关闭延迟物化，恢复正常（第 7 节）。

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

5. ClickHouse 是 25.10 时，确认关闭延迟物化的配置文件还在、并且已经生效，否则旧 trace 打开会报 500（第 7 节）。第一条应列出这个文件，第二条应输出 `0` 或 `false`：

   ```bash
   ls /etc/clickhouse-server/users.d/zz-disable-lazy-materialization.xml
   ```

   ```bash
   docker-compose exec -T clickhouse sh -c 'clickhouse-client --password "$CLICKHOUSE_PASSWORD" -q "SELECT getSetting('"'"'query_plan_optimize_lazy_materialization'"'"')"'
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

4. 在界面上打开几条**升级前一两个月**的旧 trace，确认详情页能正常加载。新数据通常没问题，旧分片里的数据才会触发第 7 节的问题。如果报 500，按第 7 节排查。

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

| 输出                                                                                                                                 | 含义                                                                                                                                                                                                                                                                                                             | 是否需要处理                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Image: Development build`、`Installed: no release recorded`                                                                         | 镜像里有 3 个代码步骤（`agent:backfill-versions`、`evaluator:backfill-versions`、`dataset:create-first-versions`）没有登记在上游的 `packages/upgrade/releases/3.23.0.json` 里，程序因此把镜像判定为未发布版本（`packages/upgrade/src/gate/image-tree.ts` 的 `imageRelease`）。上游 3.23.0 的发布提交本身就是这样 | 不需要。只影响显示，升级按步骤 id 逐个记账                                                |
| `Trace has no folded summary yet (attempt N); retrying the evaluation trigger`                                                       | 积压追赶时，trace 汇总投影落后于评测触发器；最多重试 13 次，大约 27 分钟                                                                                                                                                                                                                                         | attempt 小是正常的；出现 `Skipping evaluation dispatch` 说明对应 trace 的在线评测被跳过了 |
| `Event subscriber execution is slow`、`Failed event subscriber execution was slow`                                                   | 单次执行超过 5 秒的告警阈值（`SLOW_PROJECTION_OPERATION_MS`）                                                                                                                                                                                                                                                    | 积压高峰期出现是正常的；如果持续出现，用第 6 节的 CK 查询确认 CK 自身是否变慢             |
| `PINO_LOG_LEVEL is deprecated, use LOG_LEVEL`                                                                                        | 日志级别变量改名了                                                                                                                                                                                                                                                                                               | 下次重建容器时，把 compose 里的 `PINO_LOG_LEVEL` 改成 `LOG_LEVEL`                         |
| `[ioredis] Unhandled error event`                                                                                                    | tasks 入口自己建的 Redis 连接没有挂 logger，错误直接用 console 打印（`packages/redis-client/src/connection.ts`），不会导致进程崩溃                                                                                                                                                                               | 看错误本身                                                                                |
| CK 重试日志里的 `"retryError":{}`                                                                                                    | `retryError` 字段没有注册日志序列化器，Error 被打印成了 `{}`（`packages/observability/src/logger.ts`）                                                                                                                                                                                                           | 真实原因要从其他日志或 CK 侧确认                                                          |
| CK 的 `Code: 173 ... Amount of memory requested to allocate is more than allowed: (while reading column X) ... max_rows_to_read = 1` | **不是内存不够**（内存不够是 Code 241）。意思是 CK 读到的数组长度是垃圾值，按这个长度申请内存被拒绝了。带 `max_rows_to_read = 1` 说明是单行读取路径，基本就是第 7 节的延迟物化缺陷                                                                                                                               | 按第 7 节处理                                                                             |
| app 日志的 `Failed to get trace summary from ClickHouse`、`tRPC call failed`                                                         | 前端 500 的正文是脱敏的，真实原因只在这两条日志的 `error` 字段里                                                                                                                                                                                                                                                 | 用 trace id 或这两条消息过滤 app 日志                                                     |
| 交互式 `clickhouse-client` 里粘贴多行 SQL，每一行都报 `Syntax error`                                                                 | 交互模式默认不开多行，回车就执行当前这一行                                                                                                                                                                                                                                                                       | 启动时加 `-m`，或者用 `<<'SQL'` heredoc 通过标准输入传入（第 7 节的命令都是这种写法）     |
| `docker-compose logs` 不支持 `--since`                                                                                               | v1 的限制                                                                                                                                                                                                                                                                                                        | 改用 `docker logs --since 30m <容器名>`                                                   |

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

## 7 升级后问题：部分 trace 打开报 500（ClickHouse 延迟物化缺陷）

### 7.1 现象

- 从首页搜索后打开部分 trace，浏览器控制台出现 `GET /api/trpc/traces.header?... 500 (Internal Server Error)`。页面重新获得焦点时会自动重试，所以同一个报错会反复出现。
- 只有部分 trace 出问题。这次全部是 10 月底的 trace，所在分片都写于迁移 00109 之前，之后也没有被合并重写过。
- app 日志里成对出现 `Failed to get trace summary from ClickHouse`（warn）和 `tRPC call failed`（error）。错误内容是 CK 的 `Code: 173 ... Amount of memory requested to allocate is more than allowed: (while reading column UnpricedModels) ... from mark 1 with max_rows_to_read = 1, offset = N`，每次都指向同一个分片。

### 7.2 根因

1. `traces.header` 读取 trace 汇总，用的是 `modules/trace/process/src/repositories/clickhouse/trace-summary.repository.ts` 里的 `queryByTraceId`，查询以 `ORDER BY t.TenantId ASC LIMIT 1` 结尾。
2. ClickHouse 25.10 对 LIMIT 不超过 `query_plan_max_limit_for_lazy_materialization`（默认 10）的 `ORDER BY ... LIMIT` 查询，默认开启延迟物化：先选出要返回的行，再单独去读这一行的其他列。
3. `UnpricedModels`（`Array(LowCardinality(String)) DEFAULT []`）是迁移 00109 通过 ALTER 加的列。在那之前写入、之后又没被合并重写的分片里，没有这一列的数据文件。普通读取会按 DEFAULT 补成 `[]`；但延迟物化的单行读取路径没有补值，去读了一个不存在的长度头，读到垃圾值，于是报 Code 173。
4. 证据：
   - 同一条查询，开着延迟物化报 Code 173；加上 `SETTINGS query_plan_optimize_lazy_materialization = 0` 就正常返回 `[]`；
   - 按分区整列扫描这一列，全部正常；
   - 出问题的分片在 `system.parts_columns` 里查不到这一列；
   - `system.columns` 显示这一列的 `DEFAULT []` 是存在的。所以症状虽然和迁移 00057 记录的一样，原因却不同：00057 是列缺 DEFAULT，这次是 DEFAULT 在、但单行读取路径没有用上。
5. 上游遇到过同一类问题：`span-storage.repository.ts` 读单个 span 时，已经单独关掉了延迟物化，注释里写的就是 CK 25.10 在 `max_rows_to_read=1` 时的读取缺陷。但单条 trace 汇总的读取没有做同样的处理。

### 7.3 处理：关闭延迟物化

1. 在宿主机上写配置文件。`/etc/clickhouse-server/users.d/` 已经挂载进 CK 容器：

   ```bash
   cat > /etc/clickhouse-server/users.d/zz-disable-lazy-materialization.xml <<'XML'
   <clickhouse>
     <profiles>
       <default>
         <query_plan_optimize_lazy_materialization>0</query_plan_optimize_lazy_materialization>
       </default>
     </profiles>
   </clickhouse>
   XML
   ```

2. 回到 compose 项目目录（含 `docker-compose.yml` 的目录），让 CK 重新加载配置。在其他目录执行，docker-compose 会报找不到配置文件：

   ```bash
   docker-compose exec -T clickhouse sh -c 'clickhouse-client --password "$CLICKHOUSE_PASSWORD" -q "SYSTEM RELOAD CONFIG"'
   ```

3. 确认已经生效，应输出 `0` 或 `false`。如果仍然是 `1`，说明 `default` 用户在 `users.d` 里被配成了别的 profile，要把这项设置加到那个 profile 里：

   ```bash
   docker-compose exec -T clickhouse sh -c 'clickhouse-client --password "$CLICKHOUSE_PASSWORD" -q "SELECT getSetting('"'"'query_plan_optimize_lazy_materialization'"'"')"'
   ```

4. 用 7.4 第 3 条的 A 查询复现一次，应该能正常返回；再在界面上重新打开那条 trace。

配置文件放在宿主机的挂载目录里，重建 CK 容器不会丢。迁移机器或重建 CK 配置目录时，要把它一起带上。

### 7.4 定位与验证命令

1. 从 app 日志拿到真实错误。前端拿到的 500 正文是脱敏的：

   ```bash
   docker logs --since 3h langwatch_app_1 2>&1 | grep -E "<trace_id>|tRPC call failed|Failed to get trace summary|schema and ledger disagree" | tail -20 | cut -c1-2000
   ```

2. 看 CK 侧记录的失败查询。查询参数是绑定传入的，所以按表名和时间过滤，不按 trace id：

   ```bash
   docker-compose exec -T clickhouse sh -c 'clickhouse-client --password "$CLICKHOUSE_PASSWORD" --multiquery --format Vertical' <<'SQL'
   SELECT event_time, exception_code, substring(exception, 1, 400) AS exception
   FROM system.query_log
   WHERE type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')
     AND event_time > now() - INTERVAL 3 HOUR AND query LIKE '%trace_summaries%'
   ORDER BY event_time DESC LIMIT 20;
   SQL
   ```

3. 用 A、B 两条查询对比，确认是不是延迟物化导致的。A 和应用的写法一样；B 只多了一行关闭延迟物化的设置。A 报错、B 正常，就是这个问题。A 要单独执行，因为它报错后会中断同一批里后面的查询：

   ```bash
   docker-compose exec -T clickhouse sh -c 'clickhouse-client --password "$CLICKHOUSE_PASSWORD" --multiquery --format Vertical' <<'SQL'
   SELECT t.TraceId, t.UnpricedModels FROM langwatch.trace_summaries AS t
   WHERE t.TenantId = '<project_id>' AND t.TraceId = '<trace_id>'
   ORDER BY t.TenantId LIMIT 1;
   SQL
   ```

   ```bash
   docker-compose exec -T clickhouse sh -c 'clickhouse-client --password "$CLICKHOUSE_PASSWORD" --multiquery --format Vertical' <<'SQL'
   SELECT t.TraceId, t.UnpricedModels FROM langwatch.trace_summaries AS t
   WHERE t.TenantId = '<project_id>' AND t.TraceId = '<trace_id>'
   ORDER BY t.TenantId LIMIT 1
   SETTINGS query_plan_optimize_lazy_materialization = 0;
   SQL
   ```

4. 看列定义，以及哪些分区里有缺少这一列的分片，用来评估影响范围：

   ```bash
   docker-compose exec -T clickhouse sh -c 'clickhouse-client --password "$CLICKHOUSE_PASSWORD" --multiquery --format PrettyCompact' <<'SQL'
   SELECT table, name, type, default_kind, default_expression
   FROM system.columns
   WHERE database = 'langwatch' AND table IN ('trace_summaries', 'trace_analytics') AND name = 'UnpricedModels';

   SELECT partition_id, count() AS parts, sum(rows) AS rows
   FROM system.parts
   WHERE database = 'langwatch' AND table = 'trace_summaries' AND active
     AND name NOT IN (SELECT name FROM system.parts_columns
                      WHERE database = 'langwatch' AND table = 'trace_summaries' AND active AND column = 'UnpricedModels')
   GROUP BY partition_id ORDER BY partition_id;
   SQL
   ```

5. 列出所有表里"在部分分片中缺失"的 Array 和 Map 列。这些列都可能触发同样的问题：

   ```bash
   docker-compose exec -T clickhouse sh -c 'clickhouse-client --password "$CLICKHOUSE_PASSWORD" --multiquery --format PrettyCompact' <<'SQL'
   SELECT p.table, c.name AS column, c.type, count() AS parts_missing, sum(p.rows) AS rows
   FROM system.parts AS p
   INNER JOIN system.columns AS c ON c.database = p.database AND c.table = p.table
   WHERE p.database = 'langwatch' AND p.active AND (c.type LIKE 'Array%' OR c.type LIKE 'Map%')
     AND (p.table, p.name, c.name) NOT IN (
       SELECT table, name, column FROM system.parts_columns WHERE database = 'langwatch' AND active)
   GROUP BY p.table, c.name, c.type
   ORDER BY rows DESC;
   SQL
   ```

### 7.5 关闭延迟物化对性能的影响

- 只影响 LIMIT 不超过 10 的 `ORDER BY ... LIMIT` 查询。可以用 `SELECT name, value, changed FROM system.settings WHERE name LIKE '%lazy_materialization%'` 确认阈值。这类查询基本都是按主键精确定位的单行读取，本来读的数据就很少。
- LangWatch 的列表查询读大字段时，都用 IN-tuple 两段式：先用小列选出行，再只为这些行读大字段（`dev/docs/best_practices/clickhouse-queries.md`）。翻页的 LIMIT 也大于 10。所以关掉 CK 自带的延迟物化，代价可以忽略。
- 对比方法：拿改配置前一天的同一时段做基线，按小时比较查询耗时和读取量。只看受影响的小 LIMIT 查询时，在 `WHERE` 里加上 `AND match(query, 'LIMIT\\s+([1-9]|10)\\b')`：

  ```bash
  docker-compose exec -T clickhouse sh -c 'clickhouse-client --password "$CLICKHOUSE_PASSWORD" --multiquery --format PrettyCompact' <<'SQL'
  SELECT toStartOfHour(event_time) AS hour, count() AS queries,
         round(avg(query_duration_ms)) AS avg_ms, quantile(0.95)(query_duration_ms) AS p95_ms,
         formatReadableSize(avg(read_bytes)) AS avg_read, formatReadableSize(max(memory_usage)) AS max_memory
  FROM system.query_log
  WHERE type = 'QueryFinish' AND query_kind = 'Select'
    AND event_time > now() - INTERVAL 48 HOUR AND has(databases, 'langwatch')
  GROUP BY hour ORDER BY hour;
  SQL
  ```

### 7.6 删除这个配置文件之前

要先完成下面至少一项，再用 7.4 第 3 条的 A 查询确认不再报错：

1. **代码修复（已完成）**：参照 `span-storage.repository.ts` 的做法，给单条 trace 汇总读取（`trace-summary.repository.ts` 的 `queryByTraceId`），以及 `trace_analytics` 的两条 fold 读回（`trace-metrics-analytics.repository.ts`），加上查询级的 `query_plan_optimize_lazy_materialization: "0"`。见 `modules/trace/specs/single-trace-read-lazy-materialization.feature`。部署了包含这项修复的镜像后，trace 详情页就不再依赖这个配置文件。但其他模块里还有 `ORDER BY ... LIMIT` 的单行读取没有加，所以删除配置文件之前，仍然要先确认 7.4 第 5 条查不出其他缺失的 Array 或 Map 列，或者完成第 2 项。
2. **补齐旧分片**：在业务低峰时，先 `ALTER TABLE langwatch.trace_summaries FREEZE WITH NAME '<备份名>'` 做硬链接备份，再对 7.4 第 4 条查出的分区逐个执行 `OPTIMIZE TABLE langwatch.trace_summaries PARTITION ID '<分区>' FINAL`。合并时会把缺失的列按默认值写全，ReplacingMergeTree 的多版本也会顺带去重。完成后，7.4 第 4 条的第二条查询应返回空，确认无误后再清理 `/var/lib/clickhouse/shadow/<备份名>`。第 5 条查出的其他表，也用同样的方法处理。
3. **升级 ClickHouse**：换到修复了这个缺陷的版本。具体是哪个版本，这次没有核实，需要查 CK 的发布说明。

## 8 遗留事项

- **代码缺陷未修复**：数据集列表在 `modules/dataset/process/src/repositories/prisma/prisma.dataset.repository.ts` 的 `findAll` 里逐行做 schema 校验，一行坏数据就会让整个列表返回 422，用户只能看到"未知错误"。可以改成跳过不合格的行并记录告警，需要单独排期。
- **并发参数未调整**：`GLOBAL_QUEUE_CONCURRENCY=300`、`LANGWATCH_DISPATCH_TENANT_CAP=0` 沿用了原值。在 3.23.0 里，前者是每个 worker 的并行组数（默认 100，吞吐上升时自动扩容，上限 1000，见 `packages/group-queue/src/groupQueue.ts`）；后者设为 0 会关闭每租户默认 50 的上限。Redis 只分配了 1 核，后续根据监控再评估。
- **日志变量**：compose 里的 `PINO_LOG_LEVEL` 改成 `LOG_LEVEL`。
- **评估器 Max Tokens 的双重含义**：评估器的 Max Tokens 同时是 langevals 的输入预算和发给模型的输出上限，调大输入预算会同时调大输出上限，在上下文较小的模型上容易超出 `max_model_len`。可以考虑拆开这两个含义，需要单独排期（第 9 节）。
- **延迟物化**：`zz-disable-lazy-materialization.xml` 目前是全局关闭。trace 汇总和 analytics 读回的代码修复已经完成（7.6 第 1 项）；旧分片的补齐还没有做。删除配置文件的前提见 7.6。
- **内部实施文档需要同步修订**：
  1. 全文 `docker compose` 改成实际可用的命令形式；
  2. 启动应用前先启动并确认 redis、clickhouse healthy；
  3. 在执行前检查中加入空 slug、空 name 数据集的检查；
  4. 状态检查改用一次性容器，并写明第 3.4 节的判定标准；
  5. 在异常处理中写明后台步骤失败后的重试方法；
  6. 把 CK 的 `users.d/zz-disable-lazy-materialization.xml` 写进部署配置清单，并在升级后的验收里加上"打开几条旧 trace"这一项。

## 9 升级后问题：自定义模型的 Max Tokens 改了不生效

### 9.1 现象

- 评估器（LLM 评判类）的 Max Tokens 滑块最大只能到 4096，评估报 `The evaluator prompt takes 4671 tokens, which leaves no room for the content within the maximum of 4096 tokens`。
- 在 Settings 的模型供应商里编辑自定义模型，把 Max Tokens 改大后点对话框的 Save，抽屉随即关闭，看起来保存成功了，但再打开时值没有变化。
- 抓到的 `modelProvider.update` 请求里，`customModels` 的每一项只有 `modelId`、`displayName`、`mode`，没有 `maxTokens`，顺序也和库里一致，说明编辑结果根本没有进入请求。

### 9.2 根因

1. **滑块上限**：滑块上限取模型的 `maxCompletionTokens`，没有时用默认的 4096。自定义模型的 `maxCompletionTokens` 就是它登记的 Max Tokens，旧数据里没有这个字段，所以上限是 4096。
2. **编辑不生效**：自定义模型对话框有自己的表单，打开它的供应商编辑器也是一个表单（抽屉底部的 Save 按 id 提交它）。对话框渲染在 portal 里，DOM 上不嵌套，但 React 的合成事件沿组件树冒泡，所以对话框的 submit 也触发了外层表单的保存。外层读到的还是编辑前的状态，于是用旧列表调了 `modelProvider.update`，成功后关闭抽屉。新增自定义模型也受影响。
3. **服务端丢字段**：前端修好后，请求里已经带上了 `maxTokens`，但返回的列表里仍然没有。tRPC 传输层（`model-provider.trpc.ts`）写入时用 `toCanonicalCustomModelList` 把每个模型只转成 `{id, label, type}`，返回时 `toListEntry` 也只给 `modelId`、`displayName`、`mode`，Max Tokens、支持的参数和多模态输入两头都丢了。仓储层和 REST 的返回本来就带这些字段，所以只在界面上能看到这个问题。
4. **代码修复**：
   - 设计系统的 Dialog 和 Drawer 在自己的表单提交时调用 `stopPropagation()`，不再提交外层表单。见 `packages/design-system/specs/overlay-shapes.feature`。
   - 写入和返回都保留 Max Tokens、支持的参数和多模态输入（`rules/custom-model-list.rules.ts`）。两处都见 `specs/model-providers/custom-model-max-tokens.feature`。

### 9.3 取值：自定义模型和评估器的 Max Tokens

一次 LLM 评判请求里，同一个 Max Tokens 被用了两次：

| 环节               | 用法                                                                                             | 来源                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| langevals 截断内容 | 评估提示词加内容不超过这个值（预算）。litellm 不认识自定义模型的上下文窗口，所以不会再按窗口收紧 | 评估器设置里的 `max_tokens`，没有设置时按 128000 |
| 发给模型的输出上限 | `max_tokens` 参数，先按自定义模型的 Max Tokens 截断                                              | 同上，没有设置或不大于 0 时不发                  |

vLLM 要求输入加 `max_tokens` 不超过 `max_model_len`，所以：

1. **自定义模型的 Max Tokens 不超过 `max_model_len` 的一半**（32k 上下文填 16384）。评估器里切换到这个模型时，Max Tokens 默认就取这个值，滑块上限也是它。
2. **每个评估器都要有明确的 Max Tokens**，并且不超过上面的值。没有设置或为 0 时，输入预算是 128000，内容稍长就会超出上下文。界面打开评估器时会把它压到模型上限以内；执行时只截断发给模型的输出上限，langevals 的输入预算不截断。
3. 评估提示词本身约 4.7k tokens，评估器的 Max Tokens 至少要 8192 才有足够的内容空间。

### 9.4 部署后的检查

升级到包含修复的镜像后，在界面上逐个编辑自定义模型填写 Max Tokens，不需要改库。然后检查评估器和在线评估的设置：

```sql
-- 评估器：模型和 Max Tokens（评估器的 config.settings 优先于关联在线评估的 parameters）
SELECT e."projectId", e.id, e.name,
       e.config->'settings'->>'model'      AS model,
       e.config->'settings'->>'max_tokens' AS max_tokens
FROM "<schema>"."Evaluator" e
WHERE e."archivedAt" IS NULL
  AND e.config->'settings'->>'model' LIKE 'custom/%'
ORDER BY e."projectId", e.name;

-- 没有关联评估器的旧在线评估，用的是自己的 parameters
SELECT m."projectId", m.id, m.name, m.enabled,
       m.parameters->>'model' AS model, m.parameters->>'max_tokens' AS max_tokens
FROM "<schema>"."Monitor" m
WHERE m."evaluatorId" IS NULL AND m.parameters->>'model' LIKE 'custom/%';

-- 同一个项目里是否有多条 custom 供应商：界面和执行都只取其中一条
SELECT s."scopeType", s."scopeId", count(*) AS rows, string_agg(p.id, ', ') AS ids
FROM "<schema>"."ModelProvider" p
JOIN "<schema>"."ModelProviderScope" s ON s."modelProviderId" = p.id
WHERE p.provider = 'custom'
GROUP BY s."scopeType", s."scopeId"
HAVING count(*) > 1;
```

`max_tokens` 为空、为 0 或超过模型上限的评估器，在界面上打开后调整并保存。实验（Experiments）里在本地改过、没有保存回评估器的设置会覆盖评估器本身的设置；工作流里的评估器节点也带着自己的设置，这两处要分别检查。

### 9.5 验证

1. 在模型供应商里编辑一个自定义模型，改 Max Tokens，点对话框的 Save：抽屉不应关闭，列表里这个模型应显示新值。
2. 再点抽屉底部的 Save，`modelProvider.update` 的响应里这一项应带有 `maxTokens`；重新打开编辑器，输入框显示的是这个值，而不是默认的 8192。
3. 刷新页面，打开评估器，Max Tokens 滑块的上限应等于这个值；跑一次评估，不再出现 `leaves no room for the content`。
