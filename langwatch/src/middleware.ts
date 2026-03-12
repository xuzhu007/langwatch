import { type NextRequest, NextResponse } from "next/server";

/**
 * Middleware that applies security headers at runtime instead of build time.
 *
 * This replaces the static `headers()` config in next.config.mjs so that
 * the DISABLE_HTTPS_HEADERS env var is read per-request rather than being
 * baked into the build manifest during `next build`.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const isProduction =
    process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test";
  const enforceHttps =
    isProduction && process.env.DISABLE_HTTPS_HEADERS !== "true";

  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.posthog.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://www.googletagmanager.com https://*.pendo.io https://client.crisp.chat https://static.hsappstatic.net https://*.google-analytics.com https://www.google.com https://*.reo.dev",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.pendo.io https://client.crisp.chat https://*.google.com https://*.reo.dev",
    "img-src 'self' blob: data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://image.crisp.chat https://www.googletagmanager.com https://*.pendo.io https://*.google-analytics.com https://www.google.com https://*.reo.dev",
    "font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://client.crisp.chat https://www.google.com https://*.reo.dev",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(enforceHttps ? ["upgrade-insecure-requests"] : []),
    "worker-src 'self' blob:",
    "connect-src 'self' https://*.posthog.com https://*.pendo.io wss://*.pendo.io wss://client.relay.crisp.chat https://client.crisp.chat https://analytics.google.com https://stats.g.doubleclick.net https://*.google-analytics.com https://www.google.com https://*.reo.dev",
    "frame-src 'self' https://*.posthog.com https://*.pendo.io https://www.youtube.com https://get.langwatch.ai https://www.googletagmanager.com https://www.google.com https://*.reo.dev",
  ];

  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Content-Security-Policy",
    cspDirectives.join("; "),
  );
  response.headers.set("X-Content-Type-Options", "nosniff");

  if (enforceHttps) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files — served directly by Next.js, headers not applied)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     *
     * Note: For _next/static assets, the browser will inherit the
     * upgrade-insecure-requests directive from the parent HTML page's CSP.
     * Since the HTML page now correctly omits that directive when
     * DISABLE_HTTPS_HEADERS is set, static asset requests will use the
     * same protocol as the page itself.
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
