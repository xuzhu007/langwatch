import { expect, test } from "./fixtures";
import {
  FRONT_DOOR_PASSWORD,
  generateFrontDoorEmail,
  givenARegisteredAccount,
  givenMyAccountHasAWorkspace,
  whenISignInWithPassword,
} from "./steps";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Self-hosted enterprise capabilities", () => {
  /** @scenario "The internal deployment keeps enterprise capabilities available" */
  test("shows available capabilities without an activation prompt", async ({ page }) => {
    const email = generateFrontDoorEmail("license-contrast");
    await givenARegisteredAccount(page, { email });

    // next-themes (`ColorModeProvider`, `attribute="class"`) reads its stored
    // preference from `localStorage["theme"]` before first paint. Setting it
    // via an init script — rather than clicking a theme toggle — forces light
    // mode deterministically regardless of the runner's OS-level preference.
    await page.addInitScript(() => {
      window.localStorage.setItem("theme", "light");
    });

    await whenISignInWithPassword(page, { email, password: FRONT_DOOR_PASSWORD });
    await givenMyAccountHasAWorkspace(page);
    await page.goto("/settings/security");

    const section = page.getByTestId("enterprise-capabilities");
    await expect(section).toBeVisible({ timeout: 15000 });
    await expect(section.getByText("Available", { exact: true })).toHaveCount(3);
    await expect(section.getByRole("link", { name: "Setup guide" })).toHaveCount(3);
    await expect(section.getByRole("link", { name: "Activate a license" })).toHaveCount(0);
  });
});
