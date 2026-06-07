import type { MiddlewareHandler } from "hono";

/**
 * 自部署环境不阻断 trace 用量。
 */
export const blockTraceUsageExceededMiddleware: MiddlewareHandler = async (
  _c,
  next,
) => {
  await next();
};
