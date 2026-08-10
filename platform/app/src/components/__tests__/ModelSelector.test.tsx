/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelSelector } from "../ModelSelector";

vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-id" },
  }),
}));

vi.mock("../../utils/api", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: {
            providers: [{ provider: "openai", enabled: true }],
            modelMetadata: {},
          },
          isLoading: false,
        }),
      },
    },
  },
}));

describe("ModelSelector", () => {
  it("模型默认值尚未初始化时不会崩溃", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <ModelSelector
          model={undefined}
          options={["openai/gpt-5-mini"]}
          onChange={() => undefined}
        />
      </ChakraProvider>,
    );

    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
