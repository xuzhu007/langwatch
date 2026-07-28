import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "./securityHeaders";

describe("buildSecurityHeaders", () => {
  /** @scenario Production HTTP responses include the Permissions-Policy header */
  it("disables unused browser capabilities in production", () => {
    const headers = buildSecurityHeaders({
      dev: false,
      environment: {},
    });

    expect(headers["Permissions-Policy"]).toBe(
      "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
    );
    expect(headers["Content-Security-Policy"]).toBeDefined();
    expect(headers["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("keeps the capability restrictions on development responses", () => {
    const headers = buildSecurityHeaders({
      dev: true,
      environment: {},
    });

    expect(headers["Permissions-Policy"]).toBe(
      "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
    );
    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("allows production responses over plain HTTP when explicitly configured", () => {
    const headers = buildSecurityHeaders({
      dev: false,
      environment: {
        DISABLE_HTTPS_HEADERS: "true",
      },
    });

    expect(headers["Content-Security-Policy"]).toBeDefined();
    expect(headers["Content-Security-Policy"]).not.toContain(
      "upgrade-insecure-requests",
    );
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });
});
