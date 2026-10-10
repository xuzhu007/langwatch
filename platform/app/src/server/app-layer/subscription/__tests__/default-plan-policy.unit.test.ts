import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSaaSPlanProvider } from "../../../../../ee/billing";
import {
  FREE_PLAN,
  UNLIMITED_PLAN,
} from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";
import { PipelineRegistry } from "../../../event-sourcing/pipelineRegistry";
import { LicenseEnforcementService } from "../../../license-enforcement/license-enforcement.service";
import { getLicenseHandler } from "../../../subscriptionHandler";
import { globalForApp, resetApp } from "../../app";
import * as appConfig from "../../config";
import { createTestApp, initializeDefaultApp } from "../../presets";

vi.mock("~/env.mjs", () => ({
  env: { BASE_HOST: "http://localhost:5560" },
}));

vi.mock("../../../../../ee/billing", () => ({
  getSaaSPlanProvider: vi.fn(),
}));

vi.mock("../../../subscriptionHandler", () => ({
  getLicenseHandler: vi.fn(),
}));

vi.mock("../../../../../ee/billing/stripe/stripeClient", () => ({
  createStripeClient: vi.fn(() => ({})),
}));

const ORGANIZATION_ID = "org-self-hosted";
const USER = { id: "user-1", email: "user@example.com" };
const LIMITED_PLAN: PlanInfo = {
  ...FREE_PLAN,
  planSource: "license",
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  maxMembers: 5,
  maxMembersLite: 2,
  maxMessagesPerMonth: 1_000,
};
const EXPECTED_PLAN = {
  ...UNLIMITED_PLAN,
  planSource: "license",
  type: "ENTERPRISE",
  name: "Enterprise (Self-Hosted)",
  free: false,
  webhookEndpointsEnabled: true,
};

describe("默认应用的套餐策略", () => {
  const previousApp = globalForApp.__langwatch_app;
  const license = {
    getActivePlan: vi.fn(),
    getSelfHostedPlan: vi.fn(),
  };
  const saas = { getActivePlan: vi.fn() };

  beforeEach(() => {
    globalForApp.__langwatch_app = null;
    vi.clearAllMocks();
    vi.spyOn(PipelineRegistry.prototype, "registerAll").mockReturnValue(
      createTestApp().commands,
    );
    vi.spyOn(appConfig, "createAppConfigFromEnv").mockReturnValue({
      nodeEnv: "test",
      databaseUrl: "postgresql://localhost/test",
      skipRedis: true,
      disableTokenization: true,
      isSaas: false,
    });
    vi.mocked(getLicenseHandler).mockReturnValue(
      license as unknown as ReturnType<typeof getLicenseHandler>,
    );
    vi.mocked(getSaaSPlanProvider).mockReturnValue(
      saas as unknown as ReturnType<typeof getSaaSPlanProvider>,
    );
    license.getActivePlan.mockResolvedValue(UNLIMITED_PLAN);
    license.getSelfHostedPlan.mockResolvedValue(UNLIMITED_PLAN);
    saas.getActivePlan.mockResolvedValue(FREE_PLAN);
  });

  afterEach(async () => {
    await resetApp();
    globalForApp.__langwatch_app = previousApp;
    vi.restoreAllMocks();
  });

  describe("when 使用自托管部署", () => {
    /** @scenario 无许可证的自托管组织仍获得无限企业套餐 */
    it("通过真实默认装配返回 main 的无限企业套餐", async () => {
      const app = initializeDefaultApp();
      const plan = await app.planProvider.getActivePlan({
        organizationId: ORGANIZATION_ID,
        user: USER,
      });

      expect(plan).toEqual(EXPECTED_PLAN);
      expect(plan.visibilityDays).toBeUndefined();
      expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    });

    /** @scenario 有限或过期许可证不改变自托管套餐 */
    it.each([
      "有限",
      "过期",
      "损坏",
    ])("%s许可证不会改变套餐或触发许可证查询", async (state) => {
      if (state === "损坏") {
        license.getSelfHostedPlan.mockRejectedValue(
          new Error("许可证存储不可读取"),
        );
      } else {
        license.getSelfHostedPlan.mockResolvedValue(LIMITED_PLAN);
      }

      const app = initializeDefaultApp();
      await expect(
        app.planProvider.getActivePlan({ organizationId: ORGANIZATION_ID }),
      ).resolves.toEqual(EXPECTED_PLAN);
      expect(getLicenseHandler).not.toHaveBeenCalled();
      expect(getSaaSPlanProvider).not.toHaveBeenCalled();
    });

    /** @scenario 未显式开启 SaaS 时使用自托管策略 */
    it("未设置 SaaS 模式时仍使用 main 的套餐", async () => {
      vi.mocked(appConfig.createAppConfigFromEnv).mockReturnValue({
        nodeEnv: "test",
        databaseUrl: "postgresql://localhost/test",
        skipRedis: true,
        disableTokenization: true,
      });

      const app = initializeDefaultApp();
      await expect(
        app.planProvider.getActivePlan({ organizationId: ORGANIZATION_ID }),
      ).resolves.toEqual(EXPECTED_PLAN);
    });

    /** @scenario 自托管新增成员不受套餐席位限制 */
    it("新增正式成员和轻量成员均不读取套餐席位计数", async () => {
      license.getSelfHostedPlan.mockResolvedValue(LIMITED_PLAN);
      const repository = {
        getMemberCount: vi.fn().mockResolvedValue(100_000),
        getMembersLiteCount: vi.fn().mockResolvedValue(100_000),
        getCurrentMonthCost: vi.fn(),
        getCurrentMonthCostForProjects: vi.fn(),
      };
      const app = initializeDefaultApp();
      const enforcement = new LicenseEnforcementService(
        repository,
        app.planProvider,
      );

      for (const limitType of ["members", "membersLite"] as const) {
        await expect(
          enforcement.checkLimit(ORGANIZATION_ID, limitType, USER),
        ).resolves.toMatchObject({
          allowed: true,
          max: Number.MAX_SAFE_INTEGER,
        });
      }
      expect(repository.getMemberCount).not.toHaveBeenCalled();
      expect(repository.getMembersLiteCount).not.toHaveBeenCalled();
    });
  });

  describe("when 使用 SaaS 部署", () => {
    beforeEach(() => {
      vi.mocked(appConfig.createAppConfigFromEnv).mockReturnValue({
        nodeEnv: "test",
        databaseUrl: "postgresql://localhost/test",
        skipRedis: true,
        disableTokenization: true,
        isSaas: true,
      });
    });

    /** @scenario SaaS 无有效许可证时仍使用订阅套餐 */
    it("保留订阅额度并传递组织和用户上下文", async () => {
      const app = initializeDefaultApp();
      await expect(
        app.planProvider.getActivePlan({
          organizationId: ORGANIZATION_ID,
          user: USER,
        }),
      ).resolves.toEqual(FREE_PLAN);
      expect(license.getActivePlan).toHaveBeenCalledWith(ORGANIZATION_ID);
      expect(saas.getActivePlan).toHaveBeenCalledWith(ORGANIZATION_ID, USER);
      expect(license.getSelfHostedPlan).not.toHaveBeenCalled();
    });

    /** @scenario SaaS 有效许可证仍优先于订阅 */
    it("保留有效许可证的有限额度且不读取订阅", async () => {
      license.getActivePlan.mockResolvedValue(LIMITED_PLAN);
      const app = initializeDefaultApp();
      const plan = await app.planProvider.getActivePlan({
        organizationId: ORGANIZATION_ID,
        user: USER,
      });

      expect(plan).toMatchObject({
        ...LIMITED_PLAN,
        overrideAddingLimitations: false,
        webhookEndpointsEnabled: true,
      });
      expect(saas.getActivePlan).not.toHaveBeenCalled();
      expect(license.getSelfHostedPlan).not.toHaveBeenCalled();
    });
  });
});
