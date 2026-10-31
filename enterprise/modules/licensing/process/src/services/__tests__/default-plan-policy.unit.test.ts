import type { LicenseCryptography } from "@langwatch/enterprise-license-signing";
import { UNLIMITED_PLAN } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { LicensingEntitlementSourceService } from "../licensing-entitlement-source.service.ts";

const expected = {
  ...UNLIMITED_PLAN,
  planSource: "license",
  type: "ENTERPRISE",
  name: "Enterprise (Self-Hosted)",
  free: false,
  webhookEndpointsEnabled: true,
};

describe("fork self-hosted deployment plan", () => {
  /** @scenario "无许可证的自托管组织仍获得无限企业套餐" */
  /** @scenario "有限或过期许可证不改变自托管套餐" */
  it.each([null, "limited-license", "expired-license", "tampered-license"])(
    "keeps the unlimited enterprise plan independently of the stored license (%s)",
    async (licenseKey) => {
      const readLicense = vi.fn(async () => ({ licenseKey }));
      const source = LicensingEntitlementSourceService.forDeployment({
        licenses: { getOrganizationLicense: readLicense },
        cryptography: createApiFixture<LicenseCryptography>(
          {},
          "self-hosted never verifies a license",
        ),
        isSaas: false,
      });
      const grant = await source.resolve({ organizationId: "org-self-hosted" });
      expect(grant).toEqual({ granted: true, plan: expected });
      expect(readLicense).not.toHaveBeenCalled();
      expect(JSON.parse(JSON.stringify(grant))).toEqual(grant);
    },
  );

  it("does not read an unavailable license store on a self-hosted deployment", async () => {
    const readLicense = vi.fn(async () => {
      throw new Error("license store unavailable");
    });
    const source = LicensingEntitlementSourceService.forDeployment({
      licenses: { getOrganizationLicense: readLicense },
      cryptography: createApiFixture<LicenseCryptography>(
        {},
        "self-hosted never verifies a license",
      ),
      isSaas: false,
    });
    await expect(source.resolve({ organizationId: "org-self-hosted" })).resolves.toEqual({
      granted: true,
      plan: expected,
    });
    expect(readLicense).not.toHaveBeenCalled();
  });
});
