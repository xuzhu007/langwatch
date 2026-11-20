# 内网 LangWatch 从 3.23.0 升级到 3.25.0

本手册适用于 [PR #63](https://github.com/xuzhu007/langwatch/pull/63) 合并后的 fork。以生产正在运行的 3.23.0 fork 镜像摘要为演练起点，可直接升级到 3.25.0。升级任务会按发布顺序处理迁移，无需部署 3.24.0 镜像。首次切换沿用生产 PostgreSQL 16、Redis 和 ClickHouse `0.4.0`（引擎 `25.10.2.65`）。可选的 LangWatchQL 需要 ClickHouse 26.8 或更新版本。启用前单独演练引擎升级，验证数据卷、权限和恢复方式。 [官方升级说明](../../../docs/self-hosting/upgrade.mdx) · [LangWatchQL 版本要求](../../../docs/self-hosting/deployment/kubernetes-helm.mdx#external-clickhouse)

## 准备内网镜像

在能访问构建依赖的环境，用同一个已审阅的 fork 提交构建 Linux/amd64 镜像。如生产架构不同，按目标架构执行构建和演练。app 和 workers 共用主镜像。`Upgrade rehearsal` 的同一次运行产出主应用、NLP 和 LangEvals 镜像，覆盖空库、已有库升级、回滚和再升级，并在离线 Compose 作业中校验三个归档的 SHA-256 和 `SOURCE_COMMIT` 后一起启动。只从该工作流全部通过的同一次运行下载三个镜像。`Fork service images` 可独立重建和检查 NLP、LangEvals 服务镜像。

本地复现构建时在仓库根目录执行以下命令。

```bash
revision=$(git rev-parse HEAD)
docker build -f infra/docker/Dockerfile --build-arg LANGWATCH_BUILD_COMMIT="$revision" \
  -t langwatch-fork:3.25.0 .
docker build -f infra/docker/Dockerfile.go-services --target nlp \
  --build-arg VERSION="3.25.0-$revision" -t langwatch-fork-langwatch_nlp:3.25.0 .
docker build -f infra/docker/Dockerfile.langevals -t langwatch-fork-langevals:3.25.0 .
```

每个工作流产物目录都包含独立的 `SHA256SUMS` 和 `SOURCE_COMMIT`。分别在各目录校验，再导入对应镜像。将三个产物和升级日志转存到内网，备份旧镜像及其生产配置。

```bash
# 在三个产物目录分别执行，EXPECTED_SOURCE_COMMIT 为已审阅提交的完整 SHA
sha256sum -c SHA256SUMS
test "$(cat SOURCE_COMMIT)" = "$EXPECTED_SOURCE_COMMIT"
read -r archive_checksum archive < SHA256SUMS
docker load -i "$archive"
```

直接导入镜像时，用以下变量配置 Compose v2。若使用内网仓库，将已验证的镜像推入仓库，把三个镜像引用改为内网地址和发布摘要，并使用部署已有的拉取策略。新节点也需要在内网仓库或本地准备当前使用的 PostgreSQL、Redis 和 ClickHouse 镜像。

```dotenv
LANGWATCH_IMAGE=langwatch-fork:3.25.0
LANGWATCH_PULL_POLICY=never
LANGWATCH_NLP_IMAGE=langwatch-fork-langwatch_nlp:3.25.0
LANGWATCH_NLP_PULL_POLICY=never
LANGEVALS_IMAGE=langwatch-fork-langevals:3.25.0
LANGEVALS_PULL_POLICY=never
LANGWATCH_CONNECT_DISABLED=true
```

若 `LANGWATCH_CONNECT_DISABLED=true` 已是生产隔离配置，确认 app 和 workers 最终都收到该变量。使用仓库 Compose 时，通过服务的 `env_file` 或 `environment` 将它注入容器。`--env-file` 供 Compose 插值，变量只有被 Compose 配置引用时才会进入容器。用封锁公共出口、允许内网模型、所用对象存储及必要认证服务的环境验证整套应用。 [上游出站连接清单](../../../docs/self-hosting/data-and-telemetry.mdx)

在 Linux 测试宿主机准备 Docker Compose 2.24.4 或更新版本（支持 `!reset` 和 `!override`），并安装 Bash、Node.js、`jq` 和 OpenSSL。加载三个 fork 镜像以及 PostgreSQL、Redis、ClickHouse 镜像后，运行下面的冒烟检查。脚本创建仅容器间可达的新 Compose 项目和临时数据卷，用合成数据验证 API、worker、NLP、LangEvals 以及模型目录和 tokenizer 缓存。退出时会删除该测试栈并保留检查输出。升级、回滚和内网模型验收仍使用后面的流程。

```bash
bash dev/scripts/upgrade-rehearsal/compose-offline-smoke.sh --run-dir /tmp/langwatch-offline-smoke
```

## 备份与演练

- 按实际部署复刻 Compose 项目名、配置顺序、数据库 schema、镜像和内网依赖。上次生产使用 `docker-compose` v1。如果仍用 v1，继续使用生产适配的配置，并合入 NLP 的 `command: [nlpgo]` 和 `SERVER_ADDR=:5561`。在目标宿主机用实际 CLI 运行 `config` 检查。仓库版 `infra/compose.yml` 使用 Compose v2 的 `pull_policy` 和可选 `env_file` 写法。 [3.23 生产复盘](fork-upgrade-3.23.0-retrospective.md)
- 暂停 Trace 写入及定时任务，让队列排空。停止 app 和 workers 后，备份 PostgreSQL（含迁移记录、升级账本）、所有 ClickHouse 路由、Redis 和对象存储。演练从这一套备份恢复。保留 `CREDENTIALS_SECRET`、认证配置、存储路径和挂载，以及 ClickHouse `users.d` 对历史 trace 查询的配置。
- 文件存储必须由 app 和 workers 共享同一持久卷。已使用 `infra/compose.local-storage.yml` 的部署持续带上该文件。容器层仍有历史对象时，先按旧手册从两个容器提取并合并对象树（含 `.digests`），校验数据可读后再切换。S3/MinIO/Azure 部署沿用原后端。只有在浏览器访问不到 S3/Azure 时才考虑 `STORED_OBJECTS_UPLOADS=through-langwatch`。启用前核对 `BASE_HOST`，实测代理请求体限制及超时。 [3.23 对象存储配置](fork-upgrade-3.23.0.md#filesystem-object-storage) · [上游上传说明](../../../docs/self-hosting/upgrade-dataset-storage.mdx#when-browsers-cannot-reach-the-bucket)
- DBA 检查 `_prisma_migrations`、业务 schema 和 `<schema>_upgrade_ledger`。本次新增 33 个 PostgreSQL 迁移和 ClickHouse `00124`–`00131`。保留历史文件与迁移记录，检查历史数据集是否还有空名称或空 `slug`，如有则先在演练环境确认修复方式。[DBA 交接目录](dba-3.25.0/) · [迁移 ZIP](dba-3.25.0/langwatch-3.23.0-to-3.25.0-dba.zip) · [执行顺序](dba-3.25.0/EXECUTION-ORDER.tsv) · [PostgreSQL 验收 SQL](dba-3.25.0/checks/postgresql.sql) · [ClickHouse 验收 SQL](dba-3.25.0/checks/clickhouse.sql)

## 切换与验收

用固定的 Compose 项目名、env 和服务 overrides 执行所有操作。以下 Bash 片段以 Compose v2 为例。将 `compose` 数组补齐实际生产 overrides 后再运行。使用 v1 的部署以自己已验证的配置和命令为准。

```bash
compose=(docker compose --project-directory . --project-name "$PROJECT_NAME" \
  --env-file "$DEPLOY_ENV" -f infra/compose.yml)
# 文件存储部署将 -f infra/compose.local-storage.yml 加入上面的数组
"${compose[@]}" config --quiet
"${compose[@]}" config --images
```

恢复备份后的演练环境先启动 PostgreSQL、Redis、ClickHouse（外部服务则检查连接），确认容器能访问实际配置的数据库和 Redis。Compose 的 `--no-deps` 不会启动基础服务。先用新镜像的一次性容器读取计划。

```bash
"${compose[@]}" run --rm --no-deps -w /app/apps/tasks workers pnpm task upgrade plan --json
```

启动新服务前按应用账号的权限选择迁移方式。

- 应用账号没有 DDL 权限时，保持 app 和 workers 停止。由 DBA 在候选镜像的一次性容器中注入临时迁移凭据并执行 `pnpm task upgrade`，核对全部阻塞步骤与各 ClickHouse 目标，然后撤下临时凭据并用运行账号读取 `status --json`。手工应用 SQL 后也要完成这一步。若只批准执行固定 SQL，维持旧版本，待动态升级操作获批并完成演练后再切换。旧版 `SKIP_PRISMA_MIGRATE` 和 `SKIP_CLICKHOUSE_MIGRATE` 对候选镜像的自动升级入口无效。[DBA 执行步骤](dba-3.25.0/README.md#3-由-dba-运行完整升级)
- 审批明确允许应用的 worker 账号执行所需迁移时，可以在下一步启动 worker，由其自动执行升级。API 等待就绪门禁放行。

按所选方式满足启动条件后，验证服务与状态。

```bash
"${compose[@]}" up -d --no-deps langwatch_nlp langevals app workers
"${compose[@]}" run --rm --no-deps -w /app/apps/tasks workers pnpm task upgrade status --json
"${compose[@]}" exec -T app curl -fsS http://127.0.0.1:5560/readyz
"${compose[@]}" exec -T workers curl -fsS http://127.0.0.1:2999/readyz
```

阻塞步骤完成后，app 和 workers 的就绪接口应返回 HTTP 200。继续观察升级账本、队列和 ClickHouse `system.mutations`。`00126` 会物化历史 trace Analytics 列，部分 trace、span 和评测分析在旧 writer 退出后由常驻 worker 回填近 62 天。需要历史报表的用户应等对应步骤完成并完成数据对账。任何 failed 步骤都应先查明和解决原因。 [3.24 迁移清单](../../../packages/upgrade/releases/3.24.0.json) · [3.25 迁移清单](../../../packages/upgrade/releases/3.25.0.json)

用旧 trace 和新上报 trace 验证检索、标签、事件与 `NOT` 筛选、CSV 完整字段和批量标注。核对旧 trace、评测 ID 以及 Analytics 历史数据，读取已有数据集快照并新建一版。用 HTTP 内网网页完成复制，保存并回读一个自定义模型的 Max Tokens，再用内网普通模型运行一次 LLM 评测，确认凭据和 token 参数生效。若生产启用了 Instant Evals，另用受支持且内网可达的 decision model 和项目已保存的密钥单独跑一轮，核对结果及错误状态。另验证 LangEvals 和 NLP HTTP 节点。确认已接受的 span 全部落库、任务排空及无新增死信，再恢复流量。 [Instant Evals 模型要求](../../../docs/features/instant-evals/own-model.mdx)

3.25 的 Braids 功能入口默认开放，组织级开关默认关闭。保留 3.23 回滚期间，在各组织设置中维持 Braids 关闭，暂停创建或修改 braid 与签名密钥，等回滚窗口结束再按需启用。 [Braids 组织开关](../../../docs/features/braids.mdx#turn-braids-on)

## 回滚

在演练中用同一批数据跑完 3.23.0 → 3.25.0 → 3.23.0 → 3.25.0。在回滚阶段恢复实际部署的旧 app、workers、NLP 和 LangEvals 镜像，以及对应的旧 Compose 命令、镜像配置和 env。共用数据库和持久卷按原路径挂载，数据库保留已扩展的 schema。对照旧 trace、写入新 trace、验证评测和授权操作，再重新升级。如果应用回滚仍无法恢复服务，按同一备份时点恢复全部相关数据存储，评估备份后写入的补传范围。 [3.23 回滚与验收记录](https://github.com/xuzhu007/langwatch/pull/63)
