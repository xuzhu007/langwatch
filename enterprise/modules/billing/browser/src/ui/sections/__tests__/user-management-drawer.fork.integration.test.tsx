/** @vitest-environment jsdom */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { getEnvironment, setEnvironment } from "@langwatch/ksuid";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserManagementDrawer } from "../user-management-drawer.tsx";

vi.mock("../../../behavior/billing-api.ts", () => {
  const useQuery = () => ({ data: undefined });
  return {
    billingApi: {
      subscription: {
        developerSeats: { useQuery },
        previewProration: { useQuery },
        previewDeveloperSeats: { useQuery },
      },
    },
  };
});

afterEach(() => cleanup());
describe("seat invitation rows with local KSUIDs", () => {
  it("keeps each added row independent and only invites remaining email addresses", async () => {
    const previousEnvironment = getEnvironment();
    setEnvironment("local");
    const onInvite = vi.fn(async () => true);
    const onUpgrade = vi.fn();
    try {
      renderWithDesignSystem(
        <UserManagementDrawer
          open
          onClose={() => {}}
          users={[]}
          pendingInvitesWithMemberType={[]}
          isLoading={false}
          mode={{ kind: "free", includedSeats: 2 }}
          inUse={0}
          developersInUse={0}
          held={{ count: 0 }}
          price={{ seatCents: 1000, currency: "USD", periodSuffix: "/mo" }}
          onInvite={onInvite}
          onUpgrade={onUpgrade}
          onCommit={vi.fn()}
          isUpgradeLoading={false}
        />,
      );

      const addPerson = screen.getByRole("button", { name: "Add person" });
      fireEvent.click(addPerson);
      fireEvent.click(addPerson);
      fireEvent.click(addPerson);
      const first = screen.getByTestId("seat-email-0");
      const second = screen.getByTestId("seat-email-1");
      fireEvent.change(first, { target: { value: "removed@example.com" } });
      fireEvent.change(second, { target: { value: "remaining@example.com" } });
      fireEvent.click(screen.getByTestId("remove-invite-0"));

      expect(screen.getByTestId("seat-email-0")).toBe(second);
      fireEvent.click(screen.getByRole("button", { name: "Invite 1 person" }));
      await waitFor(() =>
        expect(onInvite).toHaveBeenCalledExactlyOnceWith(["remaining@example.com"]),
      );
      expect(onUpgrade).not.toHaveBeenCalled();
    } finally {
      setEnvironment(previousEnvironment);
    }
  });
});
