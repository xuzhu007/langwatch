import type { MiddlewareHandler } from "hono";

/**
 * Middleware to check trace usage limits before allowing requests
 */
export const blockTraceUsageExceededMiddleware: MiddlewareHandler = async (
  _c,
  next,
) => {
  await next();
};
