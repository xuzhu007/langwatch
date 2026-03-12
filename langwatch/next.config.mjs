import fs from "fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import path from "path";

const bundleAnalyser =
  process.env.ANALYZE === "true"
    ? (await import("@next/bundle-analyzer")).default
    : null;

const __dirname = dirname(fileURLToPath(import.meta.url));

const aliasPath =
  process.env.DEPENDENCY_INJECTION_DIR ?? path.join("src", "injection");


const existingNodeModules = new Set(
  fs.readdirSync(path.join(__dirname, "node_modules")),
);

/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
await import("./src/env.mjs");

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  logging: false,
  distDir: process.env.NEXTJS_DIST_DIR ?? ".next",

  typescript: {
    // Typechecking here is slow, and is now handled by a dedicated CI job using tsgo!
    ignoreBuildErrors: true,
  },

  turbopack: {
    rules: {
      "*.snippet.sts": { loaders: ["raw-loader"], as: "*.js" },
      "*.snippet.go": { loaders: ["raw-loader"], as: "*.js" },
      "*.snippet.sh": { loaders: ["raw-loader"], as: "*.js" },
      "*.snippet.py": { loaders: ["raw-loader"], as: "*.js" },
      "*.snippet.yaml": { loaders: ["raw-loader"], as: "*.js" },
    },
    resolveAlias: {
      "@injected-dependencies.client": path.join(
        aliasPath,
        "injection.client.ts",
      ),
      "@injected-dependencies.server": path.join(
        aliasPath,
        "injection.server.ts",
      ),

      // read all folders from ./saas-src/node_modules and create a map like the above
      ...(fs.existsSync(path.join(__dirname, "saas-src", "node_modules"))
        ? Object.fromEntries(
            fs
              .readdirSync(path.join(__dirname, "saas-src", "node_modules"))
              .filter((key) => !existingNodeModules.has(key))
              .flatMap((key) => [
                [key, `./saas-src/node_modules/${key}`],
                [`${key}/*`, `./saas-src/node_modules/${key}/*`],
              ]),
          )
        : {}),
    },
  },

  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "pino-opentelemetry-transport",
    "thread-stream",
    "async_hooks",
    "geoip-country",
    "@aws-sdk/client-lambda",
    "@aws-sdk/client-cloudwatch-logs",
    "@aws-sdk/client-s3",
    "@aws-sdk/client-ses",
  ],

  experimental: {
		reactCompiler: true,
    scrollRestoration: true,
    optimizePackageImports: [
      "@chakra-ui/react",
      "react-feather",
      "@zag-js",
      "@mui",
    ],
  },

  // Security headers are applied at runtime by src/middleware.ts
  // so that DISABLE_HTTPS_HEADERS env var is evaluated per-request
  // rather than being baked into the build manifest.

  webpack: (config) => {
    config.resolve.alias["@injected-dependencies.client"] = path.join(
      aliasPath,
      "injection.client.ts",
    );
    config.resolve.alias["@injected-dependencies.server"] = path.join(
      aliasPath,
      "injection.server.ts",
    );

    // Ensures that only a single version of those are ever loaded
    // biome-ignore lint/complexity/useLiteralKeys: using string keys for consistency with hyphenated keys below
    config.resolve.alias["react"] = `${__dirname}/node_modules/react`;
    config.resolve.alias["react-dom"] = `${__dirname}/node_modules/react-dom`;
    // biome-ignore lint/complexity/useLiteralKeys: using string keys for consistency with hyphenated keys
    config.resolve.alias["next"] = `${__dirname}/node_modules/next`;
    config.resolve.alias["next-auth"] = `${__dirname}/node_modules/next-auth`;
    // biome-ignore lint/complexity/useLiteralKeys: using string keys for consistency with hyphenated keys
    config.resolve.alias["zod"] = `${__dirname}/node_modules/zod`;

    // Add fallback for pino logger requirements (browser-side)
    if (!config.isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        "pino-pretty": false,
        fs: false,
        stream: false,
        "node:stream": false,
        worker_threads: false,
        "node:worker_threads": false,
        async_hooks: false,
        "node:async_hooks": false,
      };
    }

    config.module.rules.push({
      test: /\.(js|jsx|ts|tsx)$/,
      use: [
        {
          loader: "string-replace-loader",
          options: {
            search: /@langwatch-oss\/node_modules\//g,
            replace: "",
            flags: "g",
          },
        },
        {
          loader: "string-replace-loader",
          options: {
            search: /@langwatch-oss\/src\//g,
            replace: "~/",
            flags: "g",
          },
        },
      ],
    });

    // Support importing files with `?snippet` to get source content for IDE-highlighted snippets
    config.module.rules.push({
      resourceQuery: /snippet/,
      type: "asset/source",
    });

    // Treat any *.snippet.* files as source assets to avoid resolution inside snippets
    config.module.rules.push({
      test: /\.snippet\.(txt|sts|ts|tsx|js|go|sh|py|yaml)$/i,
      type: "asset/source",
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return config;
  },
};

export default bundleAnalyser
  ? bundleAnalyser({ enabled: true })(config)
  : config;
