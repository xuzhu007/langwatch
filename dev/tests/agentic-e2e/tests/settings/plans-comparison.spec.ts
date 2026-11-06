import { test, expect } from "../test.ts";

/**
 * Settings Plans Comparison Page — @e2e scenario from
 * specs/features/settings-plans-comparison.feature: a member navigates to
 * /settings/plans and sees Free, Growth and Enterprise plan columns.
 */

test.describe("Settings Plans Comparison", () => {
  /** @scenario "The internal deployment keeps enterprise capabilities available" */
  test("member compares plans on the plans page", async ({ page }) => {
    // Navigate to the plans comparison page
    await page.goto("/settings/plans");

    // Verify we landed on the plans page (not redirected to auth)
    await expect(page).not.toHaveURL(/\/auth\/signin/);

    // Verify the page heading
    await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible({
      timeout: 15000,
    });

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

    // PR #62's internal deployment deliberately resolves an unlimited Enterprise plan.
    await expect(freePlan.getByText("Current")).toHaveCount(0);
    await expect(growthPlan.getByText("Current")).toHaveCount(0);
    await expect(enterprisePlan.getByText("Current")).toBeVisible();

    // Verify plan capabilities are shown side-by-side (billing toggle exists)
    await expect(page.getByTestId("billing-period-toggle")).toBeVisible();
  });
});
