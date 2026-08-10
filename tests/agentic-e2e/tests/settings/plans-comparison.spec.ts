import { test, expect } from "@playwright/test";

/**
 * Settings Plans Comparison Page
 *
 * @e2e scenario from specs/features/settings-plans-comparison.feature
 *
 * Verifies that a member can navigate to /settings/plans and see the
 * comparison layout with Free, Growth, and Enterprise plan columns.
 */

test.describe("Settings Plans Comparison", () => {
  test("member compares plans on the plans page", async ({ page }) => {
    // Navigate to the plans comparison page
    await page.goto("/settings/plans");

    // Verify we landed on the plans page (not redirected to auth)
    await expect(page).not.toHaveURL(/\/auth\/signin/);

    // Verify the page heading
    await expect(
      page.getByRole("heading", { name: "Plans" })
    ).toBeVisible({ timeout: 15000 });

    // Verify all three plan columns are present
    const freePlan = page.getByTestId("plan-column-free");
    const growthPlan = page.getByTestId("plan-column-growth");
    const enterprisePlan = page.getByTestId("plan-column-enterprise");

    await expect(freePlan).toBeVisible();
    await expect(growthPlan).toBeVisible();
    await expect(enterprisePlan).toBeVisible();

    // Verify plan names appear in the columns
    await expect(freePlan.getByText("Free")).toBeVisible();
    await expect(growthPlan.getByText("Growth")).toBeVisible();
    await expect(enterprisePlan.getByText("Enterprise")).toBeVisible();

    // 未显式配置时保持上游 Cloud 新组织的 Free 默认值。
    const expectedCurrentPlan =
      process.env.E2E_EXPECTED_CURRENT_PLAN === "enterprise"
        ? enterprisePlan
        : freePlan;
    await expect(expectedCurrentPlan.getByText("Current")).toBeVisible();

    // Verify plan capabilities are shown side-by-side (billing toggle exists)
    await expect(page.getByTestId("billing-period-toggle")).toBeVisible();
  });
});
