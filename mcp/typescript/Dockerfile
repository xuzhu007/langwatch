FROM node:24.22.1-alpine
ENV npm_config_package_import_method=copy UV_USE_IO_URING=0 npm_config_network_concurrency=4 npm_config_fetch_retries=5 npm_config_fetch_timeout=300000

# node-pty requires native compilation tools
RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@12.6.0 --activate

WORKDIR /app

# Build from repo root: docker build -t langwatch-mcp -f mcp/typescript/Dockerfile .
#
# Since ADR-076 the repo is a SINGLE pnpm workspace, so the lockfile and
# workspace definition live at the root and the install runs from there,
# narrowed to this package and its workspace dependencies.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
# Include the workspace dependency sources, including evaluator contracts and patches.
COPY patches ./patches
COPY packages ./packages
COPY modules ./modules
COPY enterprise ./enterprise
COPY vendor ./vendor
COPY sdks/typescript ./sdks/typescript
COPY mcp/typescript ./mcp/typescript
COPY services/langevals ./services/langevals
RUN pnpm install --frozen-lockfile --filter "@langwatch/mcp-server..."

EXPOSE 3000

WORKDIR /app/mcp/typescript

# The HTTP server is network reachable, so it does not run as root. The node
# image ships this unprivileged user; everything under /app is read-only at
# runtime; node transforms the types in memory.
USER node
# The HTTP server binds loopback by default. A container has to bind every
# interface to be reachable from outside itself, so that is opted into here.
# Publish the port only to a network you trust, and pass --allowedOrigin for
# any browser origin that needs to reach it.
CMD ["node", "--experimental-transform-types", "src/index.ts", "--http", "--port", "3000", "--host", "0.0.0.0"]
