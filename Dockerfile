# ── Stage 1: build ──────────────────────────────────────────────────
FROM node:24-alpine AS builder
RUN apk --no-cache add curl python3 make gcc g++ openssl bash
RUN npm install -g pnpm@10.24.0

# Install Goose migration tool (copied to runtime stage later)
ARG GOOSE_SHA256_ARM64=dfafe0254b0058cabf016234a500df5ada1623ed034e9473cee9fe4ed07ca090
ARG GOOSE_SHA256_X86_64=8b3eee9845cd87d827ba1abddb85235fb3684f9fb1666426f647ddd12fd29efe
RUN ARCH=$(uname -m) && \
  if [ "$ARCH" = "aarch64" ]; then \
  GOOSE_URL="https://github.com/pressly/goose/releases/download/v3.26.0/goose_linux_arm64"; \
  GOOSE_SHA256="$GOOSE_SHA256_ARM64"; \
  elif [ "$ARCH" = "x86_64" ]; then \
  GOOSE_URL="https://github.com/pressly/goose/releases/download/v3.26.0/goose_linux_x86_64"; \
  GOOSE_SHA256="$GOOSE_SHA256_X86_64"; \
  else \
  echo "Unsupported architecture: $ARCH" && exit 1; \
  fi && \
  curl -fsSL "$GOOSE_URL" -o /tmp/goose && \
  echo "$GOOSE_SHA256  /tmp/goose" | sha256sum -c - || (rm -f /tmp/goose && exit 1) && \
  mv /tmp/goose /usr/local/bin/goose && \
  chmod +x /usr/local/bin/goose

WORKDIR /app

# Skip Prisma checksum verification for air-gapped builds
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
# 注意：pnpm 不识别 PNPM_CONFIG_* 前缀的环境变量，必须使用 npm_config_* 前缀才会生效。
# 使用 copy 方式导入依赖，避免硬链接/克隆在部分宿主机存储驱动（ZFS、fuse-overlayfs 等）上的兼容性问题
ENV npm_config_package_import_method=copy
# 部分宿主机内核/seccomp 配置与 libuv 的 io_uring 交互会导致异步文件写入返回 EPERM，显式禁用以提高兼容性
ENV UV_USE_IO_URING=0
# 网络健壮性加固：构建机常处于公司代理/EDR/受限网络下，pnpm 并发拉取上千个依赖时，
# 连接重置/超时会让进程持续失败（BuildKit 报 exit code 255），整条命令重试也无法恢复
# 持续性的网络抖动。提高单请求重试次数与超时、降低并发，既减少网络瞬断导致的
# 失败，也降低并行解压的峰值内存。
ENV npm_config_fetch_retries=5
ENV npm_config_fetch_retry_mintimeout=20000
ENV npm_config_fetch_retry_maxtimeout=120000
ENV npm_config_fetch_timeout=300000
ENV npm_config_network_concurrency=4

# mcp-server 是 langwatch 的 workspace 成员（见 langwatch/pnpm-workspace.yaml 的 ../mcp-server）。
# 与上游一致：整个目录拷入，由 langwatch 的 workspace 安装统一链接，并由其 `pnpm run build`
# （start:prepare:files → build:mcp-server）自动构建；无需单独 install/build。
# （单独安装会多出一个独立步骤并放大宿主机的 EPERM/网络问题，是之前 exit 255 的根源。）
COPY mcp-server ./mcp-server
COPY langevals/ts-integration/evaluators.generated.ts ./langevals/ts-integration/evaluators.generated.ts

COPY langwatch/package.json langwatch/pnpm-lock.yaml langwatch/pnpm-workspace.yaml ./langwatch/
COPY langwatch/vendor ./langwatch/vendor
# https://stackoverflow.com/questions/70154568/pnpm-equivalent-command-for-npm-ci
# 同上：失败时自动重试一次，应对宿主机环境造成的瞬时 EPERM
RUN cd langwatch && \
  { CI=true pnpm install --frozen-lockfile || \
    { echo "pnpm install 失败，重试一次..."; CI=true pnpm install --frozen-lockfile; }; }
# SDK package files needed by generate-sdk-versions.sh during build
COPY typescript-sdk/package.json ./typescript-sdk/package.json
COPY python-sdk/pyproject.toml ./python-sdk/pyproject.toml
COPY langwatch ./langwatch
RUN cd langwatch && NODE_OPTIONS=--max-old-space-size=4096 pnpm run build

# Remove dev dependencies — not needed at runtime
RUN cd langwatch && CI=true pnpm prune --prod
# Regenerate Prisma client after pruning (prisma is a prod dep, but generate needs re-run)
RUN cd langwatch && pnpm prisma generate

# ── Stage 2: runtime ───────────────────────────────────────────────
FROM node:24-alpine
RUN apk --no-cache add curl openssl bash
RUN npm install -g pnpm@10.24.0

COPY --from=builder /usr/local/bin/goose /usr/local/bin/goose

WORKDIR /app

# Copy built artifacts from builder.
# mcp-server must be copied alongside langwatch because pnpm workspace
# symlinks langwatch/node_modules/@langwatch/mcp-server -> ../../../mcp-server.
COPY --from=builder /app/langwatch ./langwatch
COPY --from=builder /app/mcp-server ./mcp-server
COPY --from=builder /app/typescript-sdk/package.json ./typescript-sdk/package.json
COPY --from=builder /app/python-sdk/pyproject.toml ./python-sdk/pyproject.toml
COPY --from=builder /app/langevals/ts-integration/evaluators.generated.ts ./langevals/ts-integration/evaluators.generated.ts

ENV NODE_ENV=production
EXPOSE 5560

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD cd langwatch && pnpm start
