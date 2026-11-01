/** @vitest-environment jsdom */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { getEnvironment, setEnvironment } from "@langwatch/ksuid";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserManagementDrawer } from "../user-management-drawer.tsx";

afterEach(() => cleanup());
describe("manual seat selection on an HTTP self-host", () => {
  it("returns only newly added seats, including empty-email seats, with local KSUIDs", async () => {
    const previousEnvironment = getEnvironment();
    setEnvironment("local");
    const onSave = vi.fn();
    try {
      renderWithDesignSystem(
        <UserManagementDrawer
          open
          onClose={() => {}}
          users={[]}
          plannedUsers={[{ id: "planned-existing", email: "", memberType: "FullMember" }]}
          pendingInvitesWithMemberType={[]}
          seatPricePerPeriodCents={1000}
          billingPeriod="monthly"
          currency="USD"
          isLoading={false}
          onSave={onSave}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /Add Seat/i }));
      fireEvent.click(screen.getByRole("button", { name: /Done/i }));
      await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      expect(onSave.mock.calls[0]![0]).toMatchObject({
        newSeats: [{ id: expect.stringMatching(/planuser/), email: "", memberType: "FullMember" }],
        deletedSeatCount: 0,
      });
      expect(onSave.mock.calls[0]![0].newSeats).toHaveLength(1);
    } finally {
      setEnvironment(previousEnvironment);
    }
  });
});
