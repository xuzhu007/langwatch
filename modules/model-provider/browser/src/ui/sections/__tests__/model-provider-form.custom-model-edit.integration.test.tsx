/**
 * @vitest-environment jsdom
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMutateAsync,
  mockUseModelProvidersSettings,
  mockListAllForOrganizationForFrontendQuery,
  mockListAllForProjectForFrontendQuery,
  mockValidateApiKey,
} = vi.hoisted(() => ({
  mockMutateAsync: vi.fn().mockResolvedValue({}),
  mockUseModelProvidersSettings: vi.fn(),
  mockListAllForOrganizationForFrontendQuery: vi.fn(),
  mockListAllForProjectForFrontendQuery: vi.fn(),
  mockValidateApiKey: vi.fn().mockResolvedValue(true),
}));

vi.mock("@langwatch/model-provider-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useModelProvidersSettings: (...args: unknown[]) => mockUseModelProvidersSettings(...args),
}));

vi.mock("../../../behavior/model-provider-api.ts", () => {
  const modelProvider = {
    listAllForOrganizationForFrontend: { useQuery: mockListAllForOrganizationForFrontendQuery },
    listAllForProjectForFrontend: { useQuery: mockListAllForProjectForFrontendQuery },
    update: { useMutation: () => ({ mutateAsync: mockMutateAsync, isPending: false }) },
    setRoleAssignmentForScope: {
      useMutation: () => ({
        mutateAsync: vi.fn().mockResolvedValue({ ok: true }),
        isPending: false,
      }),
    },
    isManagedProvider: { useQuery: () => ({ data: { managed: false } }) },
    validateApiKey: { useMutation: () => ({ mutateAsync: mockValidateApiKey, isPending: false }) },
  };
  const useUtils = () => ({ modelProvider: { invalidate: vi.fn() } });
  return {
    modelProviderApi: { useUtils, modelProvider },
    api: { useUtils, modelProvider },
  };
});

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
}));

vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("../../../behavior/use-model-provider-api-key-validation.ts", () => ({
  useModelProviderApiKeyValidation: () => ({
    validate: mockValidateApiKey,
    validateWithCustomUrl: vi.fn().mockResolvedValue(true),
    isValidating: false,
    validationError: undefined,
    clearError: vi.fn(),
  }),
}));

import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";
import { EditModelProviderForm } from "../model-provider-form.tsx";
import { keyedRow, makePrimeQueries, Wrapper } from "./model-provider-drawer-harness.tsx";

const primeQueries = makePrimeQueries({
  providersSettingsMock: mockUseModelProvidersSettings,
  organizationListQuery: mockListAllForOrganizationForFrontendQuery,
  projectListQuery: mockListAllForProjectForFrontendQuery,
});

const MODEL_ID = "self-hosted-chat";

/** The drawer's shape: the form has no Save of its own, the footer button names it by id. */
const renderInDrawerShape = () =>
  renderWithModelProviderHost(
    <Wrapper>
      <EditModelProviderForm
        projectId="proj-1"
        organizationId="org-1"
        providerKey="openai"
        modelProviderId="row-openai"
        formId="model-provider-form"
      />
      <button type="submit" form="model-provider-form">
        Save provider
      </button>
    </Wrapper>,
    new FakeModelProviderHost(),
  );

describe("Feature: a custom model's Max Tokens ceiling is saved with its provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({});
    mockValidateApiKey.mockResolvedValue(true);
    primeQueries([
      {
        ...keyedRow({
          providerKey: "openai",
          apiKey: "OPENAI_API_KEY",
          baseUrl: "OPENAI_BASE_URL",
        }),
        customModels: [{ modelId: MODEL_ID, displayName: "Self-hosted chat", mode: "chat" }],
      },
    ]);
  });

  afterEach(cleanup);

  describe("when the model is edited and its dialog saved", () => {
    beforeEach(async () => {
      renderInDrawerShape();
      const user = userEvent.setup({ pointerEventsCheck: 0 });

      await user.click(await screen.findByRole("button", { name: `Edit ${MODEL_ID}` }));
      const dialog = await screen.findByRole("dialog", { name: /model/i });
      const maxTokens = within(dialog).getByRole("spinbutton", { name: "Max Tokens" });
      await user.clear(maxTokens);
      await user.type(maxTokens, "32768");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
    });

    /** @scenario "A custom model's new Max Tokens ceiling is saved with its provider" */
    it("does not save the provider from the model dialog", async () => {
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /model/i })).toBeNull());
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    /** @scenario "A custom model's new Max Tokens ceiling is saved with its provider" */
    it("sends the new ceiling when the provider is saved", async () => {
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /model/i })).toBeNull());
      await userEvent.setup().click(screen.getByRole("button", { name: "Save provider" }));

      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      expect(mockMutateAsync.mock.calls[0]?.[0]).toMatchObject({
        customModels: [expect.objectContaining({ modelId: MODEL_ID, maxTokens: 32768 })],
      });
    });
  });
});
